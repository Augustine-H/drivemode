"""Read-only environment and gated-model access checks; never prints credentials."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess

from provider import atomic_json

MODEL_REPO = "stabilityai/stable-audio-3-small-music"


def inspect_environment() -> dict:
    from credentials import configure_huggingface
    configure_huggingface()
    import torch
    from huggingface_hub import HfApi, get_token
    from huggingface_hub.errors import HfHubHTTPError
    import imageio_ffmpeg
    import psutil

    result = {
        "python": platform.python_version(), "platform": platform.platform(),
        "ramGiB": round(psutil.virtual_memory().total / 2**30, 2),
        "torch": torch.__version__, "cudaBuild": torch.version.cuda,
        "cudaAvailable": torch.cuda.is_available(),
        "packages": {name: importlib.metadata.version(name) for name in
                     ("stable-audio-3", "torch", "torchaudio", "transformers", "huggingface-hub")},
        "model": MODEL_REPO,
        "modelAccess": "unchecked",
        "hfCredentialPresent": bool(get_token()),
        "inferenceVerified": False,
    }
    if result["cudaAvailable"]:
        device = torch.cuda.get_device_properties(0)
        # Exercise a GPU kernel and transfer; driver detection alone is insufficient.
        probe = torch.tensor([2.0, 3.0], device="cuda").square().sum().item()
        result.update(gpu=device.name, vramMiB=round(device.total_memory / 2**20),
                      cudaKernelVerified=probe == 13.0)
    executable = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=15)
    result["ffmpeg"] = ffmpeg.stdout.splitlines()[0] if ffmpeg.returncode == 0 else "unavailable"
    try:
        HfApi().auth_check(repo_id=MODEL_REPO, repo_type="model")
        result["modelAccess"] = "granted"
    except HfHubHTTPError as error:
        code = error.response.status_code if error.response is not None else None
        result["modelAccess"] = "needs-account-terms-and-read-token" if code in (401, 403) else "unavailable"
        result["modelAccessHttpStatus"] = code
    result["readyForBenchmark"] = bool(
        result.get("cudaKernelVerified") and result["modelAccess"] == "granted"
        and result["ffmpeg"] != "unavailable"
    )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(".music-runtime/preflight.json"))
    args = parser.parse_args()
    result = inspect_environment()
    atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["readyForBenchmark"] else 2)
