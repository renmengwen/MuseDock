"""定向像素验证：原色首笔、多边形归属、纯白补边和旧核心兼容。"""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile

import cv2
import numpy as np

resources = Path(__file__).resolve().parent.parent / 'server/resources/whiteboard'
sys.path.insert(0, str(resources / 'python'))
import handwritten_media as handwritten
from stream_primitives import Config, _imread_any

snapshot = next(item for item in json.loads((resources / 'visual-presets.json').read_text(encoding='utf-8'))['presets']
                if item['id'] == 'whiteboard-handwritten-explainer-v1')['rendering']
source = np.full((120, 200, 3), 255, np.uint8)
cv2.line(source, (15, 35), (118, 35), (25, 30, 220), 5, cv2.LINE_AA)
cv2.line(source, (20, 65), (95, 65), (20, 20, 20), 3)
cv2.polylines(source, [np.array([[133, 18], [183, 18], [183, 75], [126, 96], [134, 74]])], True, (220, 110, 20), 3, cv2.LINE_AA)
annotation = {'canvas': {'width': 200, 'height': 120}, 'rendering': snapshot, 'elements': [
    {'id': 'red', 'label': '红色词组', 'region': {'x': 0, 'y': 0, 'width': 200, 'height': 120},
     'reveal': {'startMs': 0, 'durationMs': 1000, 'direction': 'top-to-bottom', 'protectedRegions': []}},
    {'id': 'bubble', 'label': '蓝色气泡', 'region': {'x': 110, 'y': 5, 'width': 90, 'height': 110},
     'polygon': [[125, 5], [195, 5], [195, 90], [115, 110], [120, 90], [125, 85]],
     'reveal': {'startMs': 1000, 'durationMs': 1000, 'direction': 'left-to-right', 'protectedRegions': []}},
]}
frames = []


class Sink:
    def __init__(self, *args, **kwargs): self.expected = kwargs['expected_frame_count']
    def write(self, frame): frames.append(frame.copy())
    def close(self): assert len(frames) == self.expected
    def abort(self): pass


renderer = handwritten.HandwrittenRegionRenderer(source, annotation, Config(fps=20), None, True, output_size=(200, 120))
allowed = renderer._allowed_mask(annotation['elements'][0], annotation['elements'][1:])
assert allowed[35, 118], '后续气泡矩形不能偷走多边形之外的红色文字'
assert not allowed[35, 140], '后续气泡不能提前揭示'
renderer.render_to(Path('unused-handwritten.mp4'), 2500, target_frame_count=50, sink_factory=Sink)
assert np.all(frames[0] == 255), '第 0 帧必须为纯白'
red = (source[:, :, 2] > 150) & (source[:, :, 0] < 80)
assert any(np.any(np.all(frame[red] == source[red], axis=1)) for frame in frames[1:10]), '描线阶段没有出现原始红色'
for frame in frames[:20]:
    assert np.all(np.all(frame[red] == 255, axis=1) | np.all(frame[red] == source[red], axis=1)), '红字被临时画成黑色'
    assert np.all(frame[renderer.element_masks['bubble']] == 255), '气泡在计划前提前出现'
assert np.array_equal(frames[-1], source), '完整末帧必须保留源图笔迹与颜色'
assert all(np.array_equal(frame, frames[-1]) for frame in frames[-10:]), '末尾必须保留半秒停留'

protected = copy.deepcopy(annotation)
protected['elements'][1]['reveal']['protectedRegions'] = [{'x': 125, 'y': 20, 'width': 15, 'height': 30}]
protected_renderer = handwritten.HandwrittenRegionRenderer(source, protected, Config(), None, True, output_size=(200, 120))
assert protected_renderer._allowed_mask(protected['elements'][0], protected['elements'][1:])[30, 130], '后续保护洞应允许先前区域绘制'

partial = copy.deepcopy(annotation)
partial['elements'] = [annotation['elements'][1]]
frames.clear()
partial_renderer = handwritten.HandwrittenRegionRenderer(source, partial, Config(fps=20), None, True, output_size=(200, 120))
partial_renderer.render_to(Path('unused-partial.mp4'), 2500, target_frame_count=50, sink_factory=Sink)
assert np.all(frames[-1][red] == 255), '未归属文字不能在片尾补显'

with tempfile.TemporaryDirectory(prefix='musedock-handwritten-pixels-') as folder:
    directory = Path(folder)
    image = np.full((350, 700, 3), 255, np.uint8)
    cv2.rectangle(image, (2, 2), (697, 347), (20, 180, 245), 3)
    handwritten.media.save_image(directory / 'input.png', image)
    normalized = handwritten.normalize_image({'input': str(directory / 'input.png'), 'output': str(directory / 'output.png'),
        'canvas': {'width': 1440, 'height': 1080}, 'rendering': snapshot})
    result = _imread_any(directory / 'output.png')
    assert result.shape == (1080, 1440, 3)
    assert normalized['contentRect'] == {'x': 0, 'y': 180, 'width': 1440, 'height': 720}
    assert np.all(result[:180] == 255) and np.all(result[900:] == 255), '补边必须为纯白'
    expected = cv2.resize(image, (1440, 720), interpolation=cv2.INTER_AREA)
    ink = expected.min(axis=2) < 235
    assert np.array_equal(result[180:900][ink], expected[ink]), '靠近边缘的彩色笔迹不得被裁切或暖纸算法擦除'
    # 深色主体之外的浅红色词组也必须纳入覆盖率，不能报告 100% 后静默丢弃。
    faint = np.full((1080, 1440, 3), 255, np.uint8)
    cv2.rectangle(faint, (80, 90), (300, 250), (20, 20, 20), 5)
    cv2.rectangle(faint, (800, 90), (1100, 250), (240, 240, 255), 5)
    handwritten.media.save_image(directory / 'faint.png', faint)
    partial = {'canvas': {'width': 1440, 'height': 1080}, 'rendering': snapshot, 'elements': [
        {'id': 'dark', 'label': '深色主体', 'region': {'x': 50, 'y': 50, 'width': 350, 'height': 250},
         'reveal': {'startMs': 0, 'durationMs': 500, 'direction': 'left-to-right', 'protectedRegions': []}},
    ]}
    font = os.environ.get('MUSEDOCK_WHITEBOARD_FONT') or (str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/msyh.ttc')
        if os.name == 'nt' else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
    try:
        handwritten.annotation_preview({'image': str(directory / 'faint.png'), 'annotation': partial, 'font': font,
            'output': str(directory / 'faint-preview.png'), 'resultOutput': str(directory / 'faint-result.png')})
        raise AssertionError('遗漏浅色词组时不能通过覆盖检查')
    except handwritten.media.CoverageError as error:
        assert error.coverage_ratio < 0.97
        assert error.coverage['totalInkPixels'] > error.coverage['coveredInkPixels']
print('白底手写像素验证通过：纯白首帧、原色起笔、多边形气泡、后续保护洞、未标注不补显、完整末帧及等比补白。')
