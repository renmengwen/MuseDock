"""Offline contract checks; no ASR model is loaded or downloaded."""
import importlib.util
import io
import queue
from pathlib import Path
import subprocess
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / "server" / "resources" / "funasr" / "server.py"
spec = importlib.util.spec_from_file_location("musedock_funasr_bridge", script)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class SentenceEvidenceTests(unittest.TestCase):
    def test_managed_service_exits_when_parent_pipe_closes(self):
        with patch.object(bridge.os, "name", "posix"), \
                patch.object(bridge.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b""))), \
                patch.object(bridge.os, "_exit") as exit_process:
            bridge.exit_when_parent_closes()
        exit_process.assert_called_once_with(0)

    @unittest.skipUnless(importlib.util.find_spec("scipy"), "需 FunASR 环境中的 SciPy")
    def test_parent_monitor_allows_native_imports_and_exits_on_eof(self):
        source = (
            "import importlib.util, threading, time\n"
            f"spec = importlib.util.spec_from_file_location('bridge', {str(script)!r})\n"
            "bridge = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(bridge)\n"
            "threading.Thread(target=bridge.exit_when_parent_closes, daemon=True).start()\n"
            "import scipy.special\n"
            "print('native-imports-ready', flush=True)\n"
            "time.sleep(30)\n"
        )
        with subprocess.Popen([bridge.sys.executable, "-B", "-c", source], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)) as child:
            readiness = queue.Queue()
            threading.Thread(target=lambda: readiness.put(child.stdout.readline()), daemon=True).start()
            try:
                self.assertEqual(readiness.get(timeout=20).rstrip(b"\r\n"), b"native-imports-ready")
            finally:
                child.stdin.close()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            self.assertEqual(child.returncode, 0)

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
