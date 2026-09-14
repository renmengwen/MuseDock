"""MuseDock 执行包装：编码线程兼容与进度，不改动已绑定的绘制核心。"""
from __future__ import annotations

import json
import sys
import time

import cv2
import numpy as np
import media


class LocalInkRenderer(media.RegionStreamRenderer):
    """与原逐笔段揭示等价，只扫描足以包含抗锯齿笔触的局部窗口。"""
    def _reveal_ink_segment(self, a, b, allowed):
        thickness = max(1, self.cfg.ink_reveal_radius * 2 + 1)
        padding = thickness + 2
        left, top = max(0, min(a[0], b[0]) - padding), max(0, min(a[1], b[1]) - padding)
        right, bottom = min(self.out_w, max(a[0], b[0]) + padding + 1), min(self.out_h, max(a[1], b[1]) + padding + 1)
        if right <= left or bottom <= top:
            return
        segment = np.zeros((bottom - top, right - left), dtype=np.uint8)
        cv2.line(segment, (a[0] - left, a[1] - top), (b[0] - left, b[1] - top),
                 255, thickness=thickness, lineType=cv2.LINE_AA)
        revealed = (segment > 0) & self.ink_pixels[top:bottom, left:right] & allowed[top:bottom, left:right]
        self.drawn[top:bottom, left:right][revealed] = self.ink_paint[top:bottom, left:right][revealed]


def render(data):
    threads = data.get('encoderThreads', 2)
    if isinstance(threads, bool) or not isinstance(threads, int) or not 1 <= threads <= 16:
        raise ValueError('编码线程数无效。')
    started = time.monotonic()
    original_sink = media.FFmpegFrameSink
    original_renderer = media.RegionStreamRenderer

    class ProgressSink(original_sink):
        def __init__(self, *args, **kwargs):
            kwargs['encoder_threads'] = threads
            super().__init__(*args, **kwargs)
            self._last_progress = 0.0
            self.report('preparing', force=True)

        def report(self, phase, force=False):
            now = time.monotonic()
            if not force and now - self._last_progress < 1.0:
                return
            self._last_progress = now
            print(json.dumps({'type': 'render_progress', 'phase': phase,
                'writtenFrames': self.frame_count, 'totalFrames': self.expected_frame_count,
                'elapsedMs': round((now - started) * 1000)}), flush=True)

        def write(self, frame):
            super().write(frame)
            self.report('drawing', force=self.frame_count == 1)

        def close(self):
            self.report('encoding', force=True)
            return super().close()

    # 每幕独立 Python 进程内注入执行 sink；原 renderer / 时钟 / 图像合同保持不变。
    media.FFmpegFrameSink = ProgressSink
    media.RegionStreamRenderer = LocalInkRenderer
    try:
        return {**media.render(data), 'encoderThreads': threads,
                'renderElapsedMs': round((time.monotonic() - started) * 1000)}
    finally:
        media.FFmpegFrameSink = original_sink
        media.RegionStreamRenderer = original_renderer


if __name__ == '__main__':
    try:
        result = render(json.load(sys.stdin))
        print(json.dumps({'success': True, **result}), flush=True)
    except Exception:
        print(json.dumps({'success': False, 'errorCode': 'MEDIA_FAILED',
            'message': '单幕渲染失败，请检查图像、区域编排和本地编码环境。'}, ensure_ascii=False), flush=True)
        sys.exit(1)
