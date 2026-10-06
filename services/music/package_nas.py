"""Build an explicit, secret-free deployment archive for Synology Container Manager."""
import argparse
import hashlib
from pathlib import Path
import zipfile

FILES = ["api_common.py", "recognition_languages.py", "transcription_providers.py", "job_store.py", "provider.py", "nas_store.py", "nas_api.py",
         ".dockerignore", "nas/Dockerfile", "nas/requirements.txt", "nas/requirements.lock", "nas/compose.yaml", "nas/initialize.py"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(".music-runtime/nas-deployment/voice-grok-music-nas.zip"))
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".partial.zip")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative in FILES:
            archive.write(source / relative, arcname="voice-grok-music/" + relative)
    temporary.replace(args.output)
    print(f"Archive: {args.output}; files: {len(FILES)}; sha256: {hashlib.sha256(args.output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
