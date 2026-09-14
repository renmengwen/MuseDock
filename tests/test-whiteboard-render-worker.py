"""渲染执行包装的纯替身测试；不启动编码器或生成媒体。"""
import contextlib
import io
import json
import sys
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/resources/whiteboard/python'))
import render_worker as worker
import numpy as np

seen = []
class FakeSink:
    def __init__(self, *args, **kwargs):
        seen.append(kwargs['encoder_threads'])
        self.frame_count = 0
        self.expected_frame_count = kwargs['expected_frame_count']
    def write(self, frame): self.frame_count += 1
    def close(self): assert self.frame_count == self.expected_frame_count

original_render = worker.media.render
original_sink = worker.media.FFmpegFrameSink
def fake_render(data):
    sink = worker.media.FFmpegFrameSink(expected_frame_count=3, encoder_threads=2)
    for _ in range(3): sink.write(None)
    sink.close()
    return {'frameCount': 3, 'fps': 60}

try:
    worker.media.FFmpegFrameSink = FakeSink
    worker.media.render = fake_render
    output = io.StringIO()
    with contextlib.redirect_stdout(output): result = worker.render({'encoderThreads': 1})
    events = [json.loads(line) for line in output.getvalue().splitlines()]
    assert seen == [1]
    assert result['encoderThreads'] == 1 and result['frameCount'] == 3
    assert [event['phase'] for event in events] == ['preparing', 'drawing', 'encoding']
    assert [event['writtenFrames'] for event in events] == [0, 1, 3]
    assert all(event['totalFrames'] == 3 and event['elapsedMs'] >= 0 for event in events)
    assert worker.media.FFmpegFrameSink is FakeSink
    try:
        worker.render({'encoderThreads': True})
        raise AssertionError('invalid threads accepted')
    except ValueError:
        pass
finally:
    worker.media.render = original_render
    worker.media.FFmpegFrameSink = original_sink
print('PASS 执行包装保留帧数与时钟、报告实际写帧、旧编码器线程覆盖、恢复原 sink；无媒体调用。')

# 与原整画布算法对照，覆盖抗锯齿边缘、越界线段、不同笔宽和保护掩码。
rng = np.random.default_rng(7301)
for width, height in [(200, 120), (1080, 1920)]:
    for radius in [0, 2, 5]:
        base = SimpleNamespace(out_w=width, out_h=height, cfg=SimpleNamespace(ink_reveal_radius=radius),
            ink_pixels=rng.random((height, width)) > 0.25,
            ink_paint=rng.integers(0, 256, (height, width, 3), dtype=np.uint8).astype(np.float32),
            drawn=np.zeros((height, width, 3), dtype=np.float32))
        local = SimpleNamespace(**vars(base))
        local.drawn = base.drawn.copy()
        allowed = rng.random((height, width)) > 0.3
        segments = [((0, 0), (width-1, height-1)), ((-40, 5), (40, 5)),
                    ((width-10, height-1), (width+40, height-1)), ((10, 10), (10, 10))]
        for _ in range(24):
            a = tuple(map(int, rng.integers([-50, -50], [width+50, height+50])))
            b = (a[0] + int(rng.integers(-12, 13)), a[1] + int(rng.integers(-12, 13)))
            segments.append((a, b))
        for a, b in segments:
            worker.media.RegionStreamRenderer._reveal_ink_segment(base, a, b, allowed)
            worker.LocalInkRenderer._reveal_ink_segment(local, a, b, allowed)
            assert np.array_equal(base.drawn, local.drawn), (width, height, radius, a, b)
print('PASS 局部笔段优化与原算法逐像素一致：横竖画布、抗锯齿、边界、不同笔宽与保护区。')
