"""MuseDock's optional, standalone FunASR HTTP bridge.

Uses native Paraformer sentence_info only; never fabricates subtitle timestamps.
Run with an existing FunASR Python environment or install requirements.txt.
"""

import argparse
import math
import os
import re
import secrets
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool


MAX_AUDIO_BYTES = 25 * 1024 * 1024


def native_sentences(result, duration):
    sentences = result.get("sentence_info") or []
    if not sentences:
        raise ValueError("未返回原生句级时间戳，请确认 Paraformer、VAD 和标点模型可用。")
    output = []
    previous_end = 0
    for sentence in sentences:
        start = sentence.get("start")
        end = sentence.get("end")
        text = re.sub(r"<\|[^|]*\|>", "", str(sentence.get("text", ""))).strip()
        if (not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end)
                or start < previous_end or end <= start or end > duration * 1000 + 1000 or not text):
            raise ValueError("FunASR 返回的句级文字或时间戳无效。")
        output.append({"start": float(start), "end": float(end), "text": text})
        previous_end = end
    return output


def create_app(device="cpu", model_cache=None):
    if model_cache:
        os.environ["MODELSCOPE_CACHE"] = str(Path(model_cache).expanduser().resolve())
    inference_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        from funasr import AutoModel

        app.state.model = AutoModel(
            model="paraformer-zh", vad_model="fsmn-vad", punc_model="ct-punc",
            device=device, disable_update=True,
        )
        yield
        app.state.model = None

    app = FastAPI(title="MuseDock FunASR", lifespan=lifespan)

    @app.get("/health")
    def health():
        return {"status": "ready", "model": "paraformer", "timing_source": "funasr_sentence_info"}

    @app.get("/v1/models")
    def models():
        return {"object": "list", "data": [{"id": "paraformer", "object": "model"}]}

    def infer(audio):
        with tempfile.TemporaryDirectory(prefix="musedock-funasr-") as directory:
            filename = Path(directory) / "audio.wav"
            filename.write_bytes(audio)
            duration = float(sf.info(str(filename)).duration)
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("音频时长无效。")
            with inference_lock:
                result = app.state.model.generate(input=str(filename), batch_size=1, sentence_timestamp=True)
            if not result or not isinstance(result[0], dict):
                raise ValueError("FunASR 没有返回转写结果。")
            sentences = native_sentences(result[0], duration)
            return {
                "task": "transcribe", "language": "zh", "duration": duration,
                "text": result[0].get("text") or "".join(item["text"] for item in sentences),
                "timing_source": "funasr_sentence_info", "sentence_info": sentences,
                "segments": [{"id": index, "start": item["start"] / 1000,
                              "end": item["end"] / 1000, "text": item["text"]}
                             for index, item in enumerate(sentences)],
            }

    @app.post("/v1/audio/transcriptions")
    async def transcribe(file: UploadFile = File(...), model: str = Form("paraformer"),
                         response_format: str = Form("verbose_json"), authorization: str = Header("")):
        key = os.environ.get("FUNASR_API_KEY", "")
        if key and not secrets.compare_digest(authorization, f"Bearer {key}"):
            raise HTTPException(401, "FunASR 鉴权失败。")
        if model not in ("paraformer", "paraformer-zh"):
            raise HTTPException(400, "此服务的模型 ID 为 paraformer。")
        if response_format != "verbose_json":
            raise HTTPException(400, "请使用 verbose_json 以保留句级时间戳。")
        try:
            audio = await file.read(MAX_AUDIO_BYTES + 1)
        finally:
            await file.close()
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "音频为空或超过 25 MiB 上限。")
        try:
            return await run_in_threadpool(infer, audio)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        except Exception:
            raise HTTPException(500, "FunASR 推理失败，请检查模型与音频环境。") from None

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MuseDock 独立 FunASR 句级转写服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--model-cache", default=None, help="已有 ModelScope 缓存目录；省略时使用默认缓存")
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(create_app(args.device, args.model_cache), host=args.host, port=args.port)
