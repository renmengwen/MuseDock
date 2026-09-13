"""Real local image evidence for the low-coverage review, without provider calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import cv2
import numpy as np

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'server/resources/whiteboard/python'))
from media import CoverageError, annotation_preview, save_image
from region_renderer import RegionStreamRenderer
from stream_primitives import Config, _hex_to_bgr

parent = root / '.codex-runtime'
parent.mkdir(exist_ok=True)
output = Path(tempfile.mkdtemp(prefix='whiteboard-coverage-preview-', dir=parent))
font = os.environ.get('MUSEDOCK_WHITEBOARD_FONT') or (
    str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/msyh.ttc') if os.name == 'nt'
    else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
paper = _hex_to_bgr('#F5EBD7')

for portrait in (False, True):
    width, height = (1080, 1920) if portrait else (1920, 1080)
    prefix = 'portrait' if portrait else 'landscape'
    source = np.full((height, width, 3), paper, dtype=np.uint8)
    if portrait:
        cv2.circle(source, (540, 440), 220, (35, 70, 160), -1)
        cv2.circle(source, (540, 440), 220, (20, 20, 20), 8)
        cv2.rectangle(source, (310, 1050), (770, 1500), (130, 85, 30), -1)
        cv2.rectangle(source, (310, 1050), (770, 1500), (20, 20, 20), 8)
        region = {'x': 260, 'y': 160, 'width': 560, 'height': 560}
    else:
        cv2.circle(source, (540, 510), 220, (35, 70, 160), -1)
        cv2.circle(source, (540, 510), 220, (20, 20, 20), 8)
        cv2.rectangle(source, (1080, 285), (1540, 735), (130, 85, 30), -1)
        cv2.rectangle(source, (1080, 285), (1540, 735), (20, 20, 20), 8)
        region = {'x': 260, 'y': 230, 'width': 560, 'height': 560}
    source_file = output / f'{prefix}-source.png'
    save_image(source_file, source)
    annotation = {'canvas': {'width': width, 'height': height}, 'elements': [
        {'label': '圆形', 'region': region,
         'reveal': {'startMs': 0, 'durationMs': 500, 'protectedRegions': []}},
    ]}
    preview_file = output / f'{prefix}-annotation.png'
    result_file = output / f'{prefix}-result.png'
    data = {'image': str(source_file), 'annotation': annotation, 'font': font,
            'output': str(preview_file), 'resultOutput': str(result_file)}
    try:
        annotation_preview(data)
        raise AssertionError('partial annotation must require a user decision')
    except CoverageError as error:
        details = error.coverage
        assert 0 < details['coverageRatio'] < 0.97
        assert details['regions'] == 1
        assert abs(details['coverageRatio'] - details['coveredInkPixels'] / details['totalInkPixels']) < 0.00001
    assert preview_file.is_file() and result_file.is_file(), 'both previews must exist before the error is reported'
    renderer = RegionStreamRenderer(source, annotation, Config(), None, True, output_size=(width, height))
    allowed = renderer._allowed_mask(annotation['elements'][0], [])
    result = cv2.imdecode(np.fromfile(result_file, dtype=np.uint8), cv2.IMREAD_COLOR)
    preview = cv2.imdecode(np.fromfile(preview_file, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert np.array_equal(result[allowed], renderer.color_img[allowed])
    assert np.all(result[~allowed] == paper), 'uncovered content must not be included in the final-effect preview'
    missing = renderer.ink_pixels & ~allowed
    assert np.all(preview[missing] == _hex_to_bgr('#DC2626')), 'missing ink must be highlighted on the original'
    (output / f'{prefix}-coverage.json').write_text(json.dumps(details), encoding='utf-8')

    # Exercise the actual Python/Node process contract, including a nonzero exit.
    process_data = {**data, 'command': 'annotation-preview',
                    'output': str(output / f'{prefix}-cli-annotation.png'),
                    'resultOutput': str(output / f'{prefix}-cli-result.png')}
    process = subprocess.run([sys.executable, str(root / 'server/resources/whiteboard/python/media.py')],
        input=json.dumps(process_data), capture_output=True, text=True, encoding='utf-8',
        env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'})
    assert process.returncode == 1
    response = json.loads(process.stdout.strip().splitlines()[-1])
    assert response['errorCode'] == 'ANNOTATION_COVERAGE_LOW'
    assert response['coverage'] == details

print(f'横竖屏低覆盖率实图检查通过：先保存对照图、覆盖像素统计、遗漏红色标记、CLI 错误证据。产物目录：{output}')
