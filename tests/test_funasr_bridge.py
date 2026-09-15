"""Offline contract checks; no ASR model is loaded or downloaded."""
import importlib.util
from pathlib import Path
import unittest

script = Path(__file__).resolve().parents[1] / "server" / "resources" / "funasr" / "server.py"
spec = importlib.util.spec_from_file_location("musedock_funasr_bridge", script)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class SentenceEvidenceTests(unittest.TestCase):
    def test_native_millisecond_timeline_is_preserved(self):
        result = bridge.native_sentences({"sentence_info": [
            {"start": 100, "end": 500, "text": "家乡。"},
            {"start": 600, "end": 1000, "text": "月光。"},
        ]}, 1.2)
        self.assertEqual(result[0], {"start": 100.0, "end": 500.0, "text": "家乡。"})

    def test_text_only_never_becomes_estimated_subtitles(self):
        with self.assertRaises(ValueError):
            bridge.native_sentences({"text": "只有文字。"}, 1)

    def test_invalid_or_overlapping_timing_is_rejected(self):
        for sentences in [
            [{"start": float("nan"), "end": 1000, "text": "字。"}],
            [{"start": 0, "end": float("inf"), "text": "字。"}],
            [{"start": 0, "end": 500, "text": "一。"}, {"start": 400, "end": 900, "text": "二。"}],
        ]:
            with self.subTest(sentences=sentences), self.assertRaises(ValueError):
                bridge.native_sentences({"sentence_info": sentences}, 1)


if __name__ == "__main__":
    unittest.main()
