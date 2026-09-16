"""白底手写图解适配器：保留原色与字形，复用仓库内的区域绘制核心。

仅在冻结方案包含 whiteboard-handwritten-render-v1 时调用；旧模板继续使用
media.py / render_worker.py，其文件、默认参数与产物身份不变。
"""
from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import media
import stream_primitives as sr
from region_renderer import RegionStreamRenderer, _scaled_rect


def ink_mask(image):
    # 归一、覆盖统计与绘制采用同一标准，浅色彩笔也不能被当作空白。
    return (image.min(axis=2) < 235) | (np.ptp(image, axis=2) > 10)


def rendering_config(snapshot, base=None):
    if not isinstance(snapshot, dict) or snapshot.get('contractVersion') != 'whiteboard-handwritten-render-v1' \
            or snapshot.get('canvasHex') != '#FFFFFF' or snapshot.get('inkMode') != 'source-color' \
            or snapshot.get('matchBackground') is not False:
        raise ValueError('白底手写图解的冻结绘制参数缺失或不受支持。')
    values = {}
    for field, name, lower, upper in [
        ('ink_weight', 'inkWeight', 1, 10), ('color_weight', 'colorWeight', 1, 10),
        ('ink_reveal_radius', 'inkRevealRadius', 1, 16),
        ('skeleton_min_points', 'skeletonMinPoints', 2, 32),
        ('skeleton_resample_spacing', 'skeletonResampleSpacing', 0.5, 8),
    ]:
        value = snapshot.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lower <= value <= upper:
            raise ValueError('白底手写图解的笔迹参数无效。')
        if name != 'skeletonResampleSpacing' and not isinstance(value, int):
            raise ValueError('白底手写图解的笔迹参数必须为整数。')
        values[field] = value
    return replace(base or sr.Config(), canvas_hex=snapshot['canvasHex'], match_bg=False,
                   ink_path_mode='skeleton', pause_mode='off', **values)


def normalize_image(data):
    config = rendering_config(data.get('rendering'))
    source = sr._imread_any(data['input'])
    if source is None or min(source.shape[:2]) < 128 or source.size > 80_000_000:
        raise ValueError('图片无法解码、尺寸过小或超过像素限制。')
    height, width = source.shape[:2]
    out_w, out_h = media.canvas_size(data.get('canvas'))
    scale = min(out_w / width, out_h / height)
    resized = cv2.resize(source, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    # 只清理近白中性纸面，不使用旧纸色算法的边缘带过滤，保留边缘文字和彩色细线。
    paper = ~ink_mask(resized)
    resized[paper] = sr._hex_to_bgr(config.canvas_hex)
    target = np.full((out_h, out_w, 3), sr._hex_to_bgr(config.canvas_hex), dtype=np.uint8)
    h, w = resized.shape[:2]
    x, y = (out_w - w) // 2, (out_h - h) // 2
    target[y:y+h, x:x+w] = resized
    if np.count_nonzero(ink_mask(target)) < 100:
        raise ValueError('生成图片缺少可绘制的有效笔迹。')
    media.save_image(data['output'], target)
    return {'width': out_w, 'height': out_h, 'sourceWidth': width, 'sourceHeight': height,
            'contentRect': {'x': x, 'y': y, 'width': w, 'height': h}, 'canvasHex': config.canvas_hex}


class HandwrittenRegionRenderer(RegionStreamRenderer):
    def __init__(self, image_bgr, annotation, cfg, hand_png, bare_tip, **kwargs):
        config = rendering_config(annotation.get('rendering'), cfg)
        super().__init__(image_bgr, annotation, config, hand_png, bare_tip, **kwargs)
        self.ink_pixels = ink_mask(self.color_img)
        self.ink_paint = self.color_img.astype(np.float32)
        self.thresh_map = np.where(self.ink_pixels, 0, 255).astype(np.uint8)
        self.grid_blocks = sr._to_grid_blocks(self.thresh_map, config.grid_edge)
        self.active_all = sr._active_mask(self.thresh_map, config.grid_edge, config.ink_threshold)
        self.stroke_radius = cv2.distanceTransform(self.ink_pixels.astype(np.uint8), cv2.DIST_L2, 3)
        self.element_masks = {item['id']: self._element_mask(item) for item in annotation['elements']}

    def _element_mask(self, element):
        mask = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        x0, y0, x1, y1 = _scaled_rect(element['region'], self.sx, self.sy, self.out_w, self.out_h)
        if element.get('polygon'):
            points = np.rint(np.asarray(element['polygon'], dtype=np.float64) * [self.sx, self.sy]).astype(np.int32)
            cv2.fillPoly(mask, [points], 1)
            mask[:y0] = 0
            mask[y1:] = 0
            mask[:, :x0] = 0
            mask[:, x1:] = 0
        else:
            mask[y0:y1, x0:x1] = 1
        for protected in element.get('reveal', {}).get('protectedRegions', []):
            px0, py0, px1, py1 = _scaled_rect(protected, self.sx, self.sy, self.out_w, self.out_h)
            mask[py0:py1, px0:px1] = 0
        return mask.astype(bool)

    def _allowed_mask(self, element, later_elements):
        mask = self.element_masks[element['id']].copy()
        for later in later_elements:
            mask &= ~self.element_masks[later['id']]
        return mask

    def _region_skeleton_strokes(self, allowed, direction):
        region = self.ink_pixels & allowed
        ys, xs = np.where(region)
        if not len(xs):
            return []
        x0, x1 = max(0, int(xs.min()) - 2), min(self.out_w, int(xs.max()) + 3)
        y0, y1 = max(0, int(ys.min()) - 2), min(self.out_h, int(ys.max()) + 3)
        skeleton = sr._zhang_suen_skeleton(region[y0:y1, x0:x1], max_iterations=160)
        strokes = []
        for raw in sr.trace_8connected(skeleton, min_points=self.cfg.skeleton_min_points):
            points = [(float(x + x0), float(y + y0)) for x, y in raw]
            points = sr._resample_stroke_points(points, self.cfg.skeleton_resample_spacing)
            points = sr._chaikin_smooth(points, iterations=1)
            points = sr._resample_stroke_points(points, self.cfg.skeleton_resample_spacing)
            if len(points) >= 2:
                strokes.append([(round(x), round(y)) for x, y in points])
        return sr._order_skeleton_strokes(strokes, direction=direction)

    def _reveal_ink_segment(self, a, b, allowed):
        radius = max(self.cfg.ink_reveal_radius, min(16, round(max(
            self.stroke_radius[a[1], a[0]], self.stroke_radius[b[1], b[0]])) + 2))
        x0, x1 = max(0, min(a[0], b[0]) - radius - 2), min(self.out_w, max(a[0], b[0]) + radius + 3)
        y0, y1 = max(0, min(a[1], b[1]) - radius - 2), min(self.out_h, max(a[1], b[1]) + radius + 3)
        mark = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
        cv2.line(mark, (a[0] - x0, a[1] - y0), (b[0] - x0, b[1] - y0), 255, radius * 2 + 1, cv2.LINE_AA)
        reveal = (mark > 0) & allowed[y0:y1, x0:x1]
        self.drawn[y0:y1, x0:x1][reveal] = self.color_img[y0:y1, x0:x1][reveal]


def annotation_preview(data):
    image = sr._imread_any(data['image'])
    annotation = data['annotation']
    width, height = media.canvas_size(annotation.get('canvas'))
    if image is None or image.shape[:2] != (height, width):
        raise ValueError('线稿尺寸与落墨标注画幅不一致。')
    renderer = HandwrittenRegionRenderer(image, annotation, sr.Config(), None, True, output_size=(width, height))
    elements = sorted(annotation['elements'], key=lambda element: element['reveal']['startMs'])
    covered = np.zeros((height, width), dtype=bool)
    for index, element in enumerate(elements):
        allowed = renderer._allowed_mask(element, elements[index+1:])
        if np.count_nonzero(renderer.ink_pixels & allowed) < 10:
            raise ValueError('标注中存在没有有效笔迹的区域，请合并或重新编排。')
        covered |= allowed
    total = int(np.count_nonzero(renderer.ink_pixels))
    covered_ink = int(np.count_nonzero(renderer.ink_pixels & covered))
    coverage = {'coverageRatio': covered_ink / max(1, total), 'regions': len(elements),
                'coveredInkPixels': covered_ink, 'totalInkPixels': total}
    if data.get('resultOutput'):
        result = np.full_like(image, renderer.canvas_bgr)
        result[covered] = renderer.color_img[covered]
        media.save_image(data['resultOutput'], result)
    preview = renderer.color_img.copy()
    missing = renderer.ink_pixels & ~covered
    halo = cv2.dilate(missing.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    red = sr._hex_to_bgr('#DC2626')
    preview[halo] = (preview[halo].astype(np.float32) * 0.35 + red * 0.65).astype(np.uint8)
    preview[missing] = red
    board = Image.fromarray(cv2.cvtColor(preview, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype(data['font'], 28)
    for index, element in enumerate(elements):
        rect = element['region']
        x, y, w, h = [rect[key] for key in ('x', 'y', 'width', 'height')]
        color = ['#D94A35', '#167D9A', '#74713B'][index % 3]
        if element.get('polygon'):
            draw.polygon([tuple(point) for point in element['polygon']], outline=color, width=4)
        else:
            draw.rectangle([x, y, x+w-1, y+h-1], outline=color, width=4)
        draw.text((x+8, max(4, y+6)), f"{index+1}. {element['label']}", font=font, fill=color,
                  stroke_width=2, stroke_fill='#FFFFFF')
        for protected in element['reveal'].get('protectedRegions', []):
            px, py, pw, ph = [protected[key] for key in ('x', 'y', 'width', 'height')]
            draw.rectangle([px, py, px+pw-1, py+ph-1], outline='#6B7280', width=3)
    with Path(data['output']).open('xb') as stream:
        board.save(stream, format='PNG')
    if coverage['coverageRatio'] < 0.97:
        raise media.CoverageError(f"标注未完整覆盖笔迹（覆盖率 {coverage['coverageRatio']:.1%}），请检查遗漏预览；未标注内容不会在片尾补显。", coverage)
    return coverage


def render(data):
    image = sr._imread_any(data['image'])
    annotation = data['annotation']
    width, height = media.canvas_size(annotation.get('canvas'))
    if image is None or image.shape[:2] != (height, width):
        raise ValueError('线稿尺寸与当前落墨画幅不一致，不能拉伸或裁切后继续渲染。')
    threads = data.get('encoderThreads', 2)
    if isinstance(threads, bool) or not isinstance(threads, int) or not 1 <= threads <= 16:
        raise ValueError('编码线程数无效。')
    hand = Path(__file__).resolve().parent.parent / 'assets/drawing-hand.png'
    if data['showHand'] and not hand.is_file():
        raise ValueError('画笔素材缺失。')
    started = time.monotonic()
    renderer = HandwrittenRegionRenderer(image, annotation, sr.Config(fps=60),
        hand if data['showHand'] else None, not data['showHand'], output_size=(width, height))

    class ProgressSink(media.FFmpegFrameSink):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, ffmpeg_executable=data['ffmpeg'], preset='fast',
                             encoder_threads=threads, popen_factory=media.hidden_popen, **kwargs)
            self.last_progress = 0.0
            self.report('preparing', force=True)

        def report(self, phase, force=False):
            now = time.monotonic()
            if force or now - self.last_progress >= 1:
                self.last_progress = now
                print(json.dumps({'type': 'render_progress', 'phase': phase,
                    'writtenFrames': self.frame_count, 'totalFrames': self.expected_frame_count,
                    'elapsedMs': round((now - started) * 1000)}), flush=True)

        def write(self, frame):
            super().write(frame)
            self.report('drawing', force=self.frame_count == 1)

        def close(self):
            self.report('encoding', force=True)
            return super().close()

    renderer.render_to(Path(data['output']), data['durationMs'], target_frame_count=data['frameCount'],
        scene_start_ms=data['startMs'], scene_start_frame=data['startFrame'], sink_factory=ProgressSink)
    return {'width': width, 'height': height, 'fps': 60, 'frameCount': data['frameCount'],
            'encoderThreads': threads, 'renderElapsedMs': round((time.monotonic() - started) * 1000)}


if __name__ == '__main__':
    try:
        data = json.load(sys.stdin)
        commands = {'normalize-image': normalize_image, 'annotation-preview': annotation_preview, 'render': render}
        print(json.dumps({'success': True, **commands[data['command']](data)}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({'success': False, 'errorCode': getattr(exc, 'code', 'MEDIA_FAILED'),
            'message': str(exc) if isinstance(exc, ValueError) else '白底手写图解媒体处理失败，请检查当前图像、分区与运行环境。',
            'coverageRatio': getattr(exc, 'coverage_ratio', None), 'coverage': getattr(exc, 'coverage', None)},
            ensure_ascii=False), flush=True)
        sys.exit(1)
