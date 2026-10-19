"""Isolated, offline IndexTTS 2.5 CPU worker. The caller owns alignment and recovery."""
import hashlib
import json
import os
from pathlib import Path
import random
import sys


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    config = request["config"]
    root = Path(config["rootPath"]).resolve()
    repo = root / "repo"
    for name, relative in {
        "HF_HOME": "huggingface", "MODELSCOPE_CACHE": "modelscope", "TORCH_HOME": "torch",
        "MPLCONFIGDIR": "matplotlib", "NLTK_DATA": "nltk", "XDG_CACHE_HOME": "xdg",
    }.items():
        os.environ[name] = str(root / "cache" / relative)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", USE_MODELSCOPE="false")
    os.chdir(repo)
    sys.path.insert(0, str(repo))
    import numpy as np
    import soundfile as sf
    import torch
    from indextts.infer_v2_5 import IndexTTS2

    torch.set_num_threads(config["threads"])
    torch.set_num_interop_threads(1)
    torch.manual_seed(1234)
    np.random.seed(1234)
    random.seed(1234)
    reference = Path(config["referenceAudio"])
    if hashlib.sha256(reference.read_bytes()).hexdigest() != config["referenceSha256"]:
        raise ValueError("参考音频已改变，请重新确认声音设置")
    output = Path(request["output"])
    if output.exists():
        raise ValueError("音频已存在，拒绝覆盖")
    model = IndexTTS2(cfg_path=str(Path(config["modelDir"]) / "config.yaml"), model_dir=config["modelDir"],
                      device="cpu", use_bf16=False, use_cuda_kernel=False, use_deepspeed=False,
                      use_accel=False, use_torch_compile=False, use_qwen_emo=False)
    model.infer(spk_audio_prompt=str(reference), text=request["text"], lang=request["language"],
                output_path=str(output), use_emo_text=False, use_random=False,
                duration_factor=config["durationFactor"], max_text_tokens_per_segment=config["maxTextTokens"],
                do_sample=True, temperature=.8, top_p=.8, top_k=30, num_beams=3,
                repetition_penalty=10., length_penalty=0., max_mel_tokens=1500, verbose=False)
    audio, rate = sf.read(output, always_2d=True)
    if not len(audio) or not np.isfinite(audio).all() or np.sqrt(np.mean(audio * audio)) < 1e-5:
        raise ValueError("合成音频为空、无效或静音")
    receipt = {"schemaVersion": 1, "audioSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "durationMs": round(len(audio) * 1000 / rate), "sampleRate": rate,
               "requestIdentity": request["identity"], "referenceSha256": config["referenceSha256"]}
    target = Path(request["receipt"])
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(target)


if __name__ == "__main__":
    main()
