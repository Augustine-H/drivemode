"""Download the official model and bundled text encoder before timed loading."""
from datetime import datetime, timezone
from pathlib import Path
import time

from credentials import configure_huggingface
from diagnostics import safe_error
from provider import atomic_json


def main():
    configure_huggingface()
    from huggingface_hub import snapshot_download
    report_path = Path(".music-runtime/model-download.json")
    report = {"model": "stabilityai/stable-audio-3-small-music", "state": "DOWNLOADING",
              "startedAt": datetime.now(timezone.utc).isoformat()}
    atomic_json(report_path, report)
    started = time.perf_counter()
    try:
        folder = Path(snapshot_download(
            report["model"], revision="main", max_workers=2,
            allow_patterns=["model_config.json", "model.safetensors", "t5gemma-b-b-ul2/*",
                            "LICENSE.md", "LICENSE_GEMMA.md", "NOTICE"],
        ))
        report.update(state="COMPLETED", revision=folder.name, snapshot=str(folder),
                      seconds=round(time.perf_counter() - started, 3),
                      files=[{"name": p.relative_to(folder).as_posix(), "bytes": p.stat().st_size}
                             for p in folder.rglob("*") if p.is_file()])
        print(f"Model downloaded. Revision: {folder.name}; {report['seconds']} seconds.")
    except Exception as error:
        report.update(state="FAILED", seconds=round(time.perf_counter() - started, 3), error=safe_error(error))
        print(f"Download failed: {report['error']['type']}: {report['error']['message']}")
    atomic_json(report_path, report)
    return 0 if report["state"] == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
