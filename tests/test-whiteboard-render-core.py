"""Offline pixel checks for the absorbed continuous-ink and region-mask core."""
import sys
from pathlib import Path
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'server/resources/whiteboard/python'))
from region_renderer import RegionStreamRenderer
from stream_primitives import Config, _hex_to_bgr

paper = _hex_to_bgr('#F5EBD7')
source = np.full((100, 200, 3), paper, dtype=np.uint8)
cv2.rectangle(source, (12, 25), (78, 74), (20, 20, 20), 3)
cv2.circle(source, (150, 50), 27, (10, 10, 10), 3)
annotation = {'canvas': {'width': 200, 'height': 100}, 'elements': [
    {'region': {'x': 0, 'y': 0, 'width': 200, 'height': 100}, 'reveal': {'startMs': 0, 'durationMs': 1500, 'protectedRegions': [], 'direction': 'left-to-right'}},
    {'region': {'x': 105, 'y': 0, 'width': 95, 'height': 100}, 'reveal': {'startMs': 1800, 'durationMs': 1700, 'protectedRegions': [], 'direction': 'top-to-bottom'}},
]}
frames = []
class Sink:
    def __init__(self, *args, **kwargs): self.expected = kwargs['expected_frame_count']
    def write(self, frame): frames.append(frame.copy())
    def close(self): assert len(frames) == self.expected
    def abort(self): raise AssertionError('unexpected renderer abort')

renderer = RegionStreamRenderer(source, annotation, Config(fps=20, ink_path_mode='skeleton', pause_mode='off'), None, True, output_size=(200, 100))
renderer.render_to(Path('unused.mp4'), 4000, target_frame_count=80, sink_factory=Sink)
assert np.all(frames[0] == paper), 'first frame must be clean paper'
assert all(np.all(frame[:, 105:] == paper) for frame in frames[:36]), 'future region leaked before its local clock'
assert np.array_equal(frames[32][:, :100], frames[60][:, :100]), 'completed region did not persist'
assert np.array_equal(frames[-1], renderer.color_img), 'final image incomplete'
assert all(np.array_equal(frame, frames[-1]) for frame in frames[-10:]), 'last 0.5s must hold'
# A later large rectangle must not steal an earlier subject in its own protected hole.
later = {'region': {'x': 0, 'y': 0, 'width': 200, 'height': 100}, 'reveal': {'protectedRegions': [{'x': 0, 'y': 0, 'width': 100, 'height': 100}]}}
allowed = renderer._allowed_mask(annotation['elements'][0], [later])
assert allowed[:, :100].all() and not allowed[:, 100:].any(), 'protected hole ownership was lost'
assert len(frames) == 80
print('连续落墨核心：首帧纸底、后续区域遮罩、共享画布、保护区归属、完整终帧和半秒停留通过。')

# Independent visual groups must finish one by one, including their color, rather than
# drawing every group's outlines first and washing the complete image afterwards.
three_group_source = np.full((100, 300, 3), paper, dtype=np.uint8)
for index, color in enumerate([(40, 80, 180), (150, 80, 30), (60, 140, 80)]):
    cv2.circle(three_group_source, (50 + index * 100, 50), 25, color, -1)
    cv2.circle(three_group_source, (50 + index * 100, 50), 25, (20, 20, 20), 2)
three_groups = {'canvas': {'width': 300, 'height': 100}, 'elements': [
    {'region': {'x': index * 100, 'y': 0, 'width': 100, 'height': 100},
     'reveal': {'startMs': index * 1000, 'durationMs': 1000, 'protectedRegions': [], 'direction': 'left-to-right'}}
    for index in range(3)
]}
frames.clear()
group_renderer = RegionStreamRenderer(three_group_source, three_groups,
    Config(fps=20, ink_path_mode='skeleton', pause_mode='off'), None, True, output_size=(300, 100))
group_renderer.render_to(Path('unused-three-groups.mp4'), 3500, target_frame_count=70, sink_factory=Sink)
assert all(np.all(frame[:, 100:] == paper) for frame in frames[:20]), 'second or third group appeared before the first finished'
assert all(np.all(frame[:, 200:] == paper) for frame in frames[:40]), 'third group appeared before its own start'
assert np.array_equal(frames[19][:, :100], group_renderer.color_img[:, :100]), 'first group was not fully colored before the second started'
assert np.array_equal(frames[39][:, :200], group_renderer.color_img[:, :200]), 'second group was not fully colored before the third started'
assert np.array_equal(frames[-1], group_renderer.color_img), 'three-group final image was incomplete'
assert all(np.array_equal(frame, frames[-1]) for frame in frames[-10:]), 'three-group ending lost the half-second hold'
print('三分区逐帧检查通过：前一区描线添彩完成后才开始下一区，未开始区域完全隐藏。')

portrait_source = np.transpose(three_group_source, (1, 0, 2)).copy()
portrait_groups = {'canvas': {'width': 100, 'height': 300}, 'elements': [
    {'region': {'x': 0, 'y': index * 100, 'width': 100, 'height': 100},
     'reveal': {'startMs': index * 1000, 'durationMs': 1000, 'protectedRegions': [], 'direction': 'top-to-bottom'}}
    for index in range(3)
]}
frames.clear()
portrait_renderer = RegionStreamRenderer(portrait_source, portrait_groups,
    Config(fps=20, ink_path_mode='skeleton', pause_mode='off'), None, True, output_size=(100, 300))
portrait_renderer.render_to(Path('unused-portrait.mp4'), 3500, target_frame_count=70, sink_factory=Sink)
assert all(np.all(frame[100:] == paper) for frame in frames[:20]), 'portrait future groups leaked'
assert all(np.all(frame[200:] == paper) for frame in frames[:40]), 'portrait third group leaked'
assert np.array_equal(frames[19][:100], portrait_renderer.color_img[:100]), 'portrait first group did not finish before second'
assert np.array_equal(frames[-1], portrait_renderer.color_img), 'portrait final image was stretched or incomplete'
assert all(np.array_equal(frame, frames[-1]) for frame in frames[-10:]), 'portrait ending lost its hold'
print('竖屏纵向三分区逐帧检查通过：上下区域依次揭示、画幅正确、末尾完整停留。')
