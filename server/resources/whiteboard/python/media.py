"""MuseDock deterministic media adapter. No providers, state or approvals."""
from __future__ import annotations

import functools
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import stream_primitives as sr
from region_renderer import RegionStreamRenderer
from ffmpeg_frame_sink import FFmpegFrameSink


# 画幅白名单与 server/services/creative/whiteboard/contracts.js 共用同一份 canvas-formats.json。
@functools.lru_cache(maxsize=1)
def supported_canvases():
    path = Path(__file__).resolve().parent.parent / 'canvas-formats.json'
    with path.open(encoding='utf-8') as stream:
        formats = json.load(stream)
    if not isinstance(formats, list) or not formats:
        raise ValueError('canvas-formats.json 缺少可用画幅。')
    names = '、'.join(f"{item['width']}×{item['height']}" for item in formats)
    return formats, {(item['width'], item['height']) for item in formats}, names


def canvas_size(canvas=None):
    formats, allowed, names = supported_canvases()
    if canvas is None:
        default = next((item for item in formats if item['id'] == '16:9'), formats[0])
        return default['width'], default['height']
    if not isinstance(canvas, dict) or not isinstance(canvas.get('width'), int) or not isinstance(canvas.get('height'), int) \
            or (canvas['width'], canvas['height']) not in allowed:
        raise ValueError(f'白板画幅仅支持 {names}。')
    return canvas['width'], canvas['height']


class CoverageError(ValueError):
    """覆盖率不足仍会先产出预览图，交由上层人工确认是否接受。"""
    code = 'ANNOTATION_COVERAGE_LOW'

    def __init__(self, message, coverage):
        super().__init__(message)
        self.coverage = coverage
        self.coverage_ratio = coverage['coverageRatio']


def save_image(destination, image):
    ok, encoded = cv2.imencode('.png', image)
    if not ok:
        raise ValueError('图片编码失败。')
    with Path(destination).open('xb') as stream:
        stream.write(encoded.tobytes())


def normalize_image(data):
    source = sr._imread_any(data['input'])
    if source is None or min(source.shape[:2]) < 128 or source.size > 80_000_000:
        raise ValueError('图片无法解码、尺寸过小或超过像素限制。')
    height, width = source.shape[:2]
    out_w, out_h = canvas_size(data.get('canvas'))
    scale = min(out_w / width, out_h / height)
    target = np.full((out_h, out_w, 3), (215, 235, 245), dtype=np.uint8)
    resized = cv2.resize(source, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    h, w = resized.shape[:2]
    x, y = (out_w - w) // 2, (out_h - h) // 2
    target[y:y+h, x:x+w] = resized
    target = sr.normalize_paper_background(target, sr._hex_to_bgr('#F5EBD7'), sr.Config())
    if np.count_nonzero(cv2.cvtColor(target, cv2.COLOR_BGR2GRAY) < 150) < 100:
        raise ValueError('生成图片缺少可绘制的有效线稿。')
    save_image(data['output'], target)
    return {'width': out_w, 'height': out_h, 'sourceWidth': width, 'sourceHeight': height}


def annotation_preview(data):
    image = sr._imread_any(data['image'])
    annotation = data['annotation']
    out_w, out_h = canvas_size(annotation.get('canvas'))
    if image is None or image.shape[:2] != (out_h, out_w):
        raise ValueError('线稿尺寸与落墨标注画幅不一致，请重新检查当前线稿。')
    renderer = RegionStreamRenderer(image, annotation, sr.Config(), None, True, output_size=(out_w, out_h))
    elements = sorted(annotation['elements'], key=lambda element: element['reveal']['startMs'])
    covered = np.zeros((out_h, out_w), dtype=bool)
    for index, element in enumerate(elements):
        allowed = renderer._allowed_mask(element, elements[index+1:])
        if np.count_nonzero(renderer.ink_pixels & allowed) < 10:
            raise ValueError('标注中存在没有有效墨迹的区域，请重新规划区域。')
        covered |= allowed
    total = int(np.count_nonzero(renderer.ink_pixels))
    covered_ink = int(np.count_nonzero(renderer.ink_pixels & covered))
    coverage = covered_ink / max(total, 1)
    # 保留原始比值，避免将略低于 97% 的失败结果四舍五入成 0.97。
    details = {'coverageRatio': coverage, 'regions': len(elements),
               'coveredInkPixels': covered_ink, 'totalInkPixels': total}
    # 与渲染器使用同一 allowed mask，展示仅保留已标注部分的最终画面。
    if data.get('resultOutput'):
        result = np.full_like(renderer.color_img, renderer.canvas_bgr)
        result[covered] = renderer.color_img[covered]
        save_image(data['resultOutput'], result)
    preview = renderer.color_img.copy()
    missing = renderer.ink_pixels & ~covered
    if missing.any():
        halo = cv2.dilate(missing.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        red = sr._hex_to_bgr('#DC2626')
        preview[halo] = (preview[halo].astype(np.float32) * 0.35 + red * 0.65).astype(np.uint8)
        preview[missing] = red
    canvas = Image.fromarray(cv2.cvtColor(preview, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(data['font'], 28)
    colors = ['#D94A35', '#167D9A', '#74713B']
    for index, element in enumerate(elements):
        rect = element['region']
        x, y, w, h = [rect[key] for key in ('x', 'y', 'width', 'height')]
        color = colors[index % len(colors)]
        draw.rectangle([x, y, x+w-1, y+h-1], outline=color, width=4)
        label = f"{index+1}. {element.get('label', '')}"
        draw.text((x+8, max(4, y+6)), label, font=font, fill=color, stroke_width=2, stroke_fill='#F5EBD7')
        for protected in element['reveal'].get('protectedRegions', []):
            px, py, pw, ph = [protected[key] for key in ('x', 'y', 'width', 'height')]
            draw.rectangle([px, py, px+pw-1, py+ph-1], outline='#6B7280', width=3)
    with Path(data['output']).open('xb') as stream:
        canvas.save(stream, format='PNG')
    if coverage < 0.97:
        raise CoverageError(f'标注未完整覆盖线稿（覆盖率 {coverage:.1%}）。预览图已生成，请查看后决定接受当前已标注内容或重新编排；遗漏内容不会在末尾突然显示。', details)
    return details


def hidden_popen(*args, **kwargs):
    if os.name == 'nt':
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    return subprocess.Popen(*args, **kwargs)


def render(data):
    image = sr._imread_any(data['image'])
    if image is None:
        raise ValueError('当前线稿无法读取。')
    annotation = data['annotation']
    out_w, out_h = canvas_size(annotation.get('canvas'))
    if image.shape[:2] != (out_h, out_w):
        raise ValueError('线稿尺寸与当前落墨画幅不一致，不能拉伸或裁切后继续渲染。')
    hand = Path(__file__).resolve().parent.parent / 'assets/drawing-hand.png'
    if data['showHand'] and not hand.is_file():
        raise ValueError('画笔素材缺失。')
    config = sr.Config(fps=60, cap_long_edge=1920, ink_path_mode='skeleton', pause_mode='off')
    renderer = RegionStreamRenderer(image, annotation, config, hand if data['showHand'] else None,
                                    not data['showHand'], output_size=(out_w, out_h))
    sink = functools.partial(FFmpegFrameSink, ffmpeg_executable=data['ffmpeg'], preset='fast',
                             encoder_threads=2, popen_factory=hidden_popen)
    renderer.render_to(Path(data['output']), data['durationMs'], target_frame_count=data['frameCount'],
                       scene_start_ms=data['startMs'], scene_start_frame=data['startFrame'], sink_factory=sink)
    return {'width': out_w, 'height': out_h, 'fps': 60, 'frameCount': data['frameCount']}


def caption_line(text, font, max_width=1728):
    # 显示层只允许一行；先清理 ASS 特殊字符，再测量实际显示宽度。
    text = ' '.join(text.split()).replace('\\', '＼').replace('{', '｛').replace('}', '｝')
    if not text or font.getlength(text) > max_width:
        raise ValueError('单条字幕超出单行宽度或内容为空，请重新生成短句字幕。')
    return text


def ass_time(ms, ceil=False):
    ticks = math.ceil(ms / 10) if ceil else math.floor(ms / 10)
    return f'{ticks // 360000}:{ticks // 6000 % 60:02}:{ticks // 100 % 60:02}.{ticks % 100:02}'


def compile_subtitles(data):
    width, height = canvas_size(data.get('canvas'))
    style = data.get('subtitleStyle')
    if style is None:
        style = {}
    if not isinstance(style, dict):
        raise ValueError('字幕样式格式无效。')
    font_size = style.get('fontSize', 52 if height > width else 48)
    color = style.get('color', '#FFFFFF')
    if type(font_size) is not int or not 24 <= font_size <= 96:
        raise ValueError('字幕字号需为 24–96 像素的整数。')
    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
        raise ValueError('字幕颜色需为六位十六进制颜色，例如 #FFFFFF。')
    color = color.upper()
    ass_color = f'&H00{color[5:7]}{color[3:5]}{color[1:3]}'
    side_margin = round(width * 0.05)
    bottom_margin = round(height * (0.10 if height > width else 0.05))
    font = ImageFont.truetype(data['font'], font_size)
    header = f'[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n'
    header += '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    header += f'Style: Default,{font.getname()[0]},{font_size},{ass_color},{ass_color},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,{side_margin},{side_margin},{bottom_margin},1\n\n'
    header += '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    previous_end = 0
    for cue in data['cues']:
        start, end = cue['startMs'], cue['endMs']
        if not isinstance(start, int) or not isinstance(end, int) or start < previous_end or end <= start:
            raise ValueError('字幕时间存在重叠或无效片段，请重新检查字幕时间轴。')
        if math.ceil(end / 10) <= math.ceil(start / 10):
            raise ValueError('单条字幕显示时间不足，请合并短句或增加时长。')
        previous_end = end
        text = caption_line(cue['text'], font, width - 2 * side_margin - 6)
        # 起止边界使用相同的百分之一秒量化，避免相邻两句短暂同时出现。
        header += f"Dialogue: 0,{ass_time(start, True)},{ass_time(end, True)},Default,,0,0,0,,{text}\n"
    with Path(data['output']).open('x', encoding='utf-8') as stream:
        stream.write(header)
    return {'cueCount': len(data['cues']), 'fontFamily': font.getname()[0], 'width': width, 'height': height,
            'fontSize': font_size, 'color': color, 'marginV': bottom_margin}


def main():
    data = json.load(sys.stdin)
    commands = {'normalize-image': normalize_image, 'annotation-preview': annotation_preview,
                'render': render, 'subtitles': compile_subtitles}
    if data['command'] == 'doctor':
        result = {'opencv': cv2.__version__, 'numpy': np.__version__, 'python': sys.version.split()[0]}
    else:
        result = commands[data['command']](data)
    print(json.dumps({'success': True, **result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else '白板本地媒体处理失败，请检查运行环境与当前产物。'
        print(json.dumps({'success': False, 'message': message, 'errorType': type(exc).__name__,
                          'errorCode': getattr(exc, 'code', ''), 'coverageRatio': getattr(exc, 'coverage_ratio', None),
                          'coverage': getattr(exc, 'coverage', None)},
                         ensure_ascii=False))
        sys.exit(1)
