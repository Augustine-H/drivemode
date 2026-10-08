"""Export only reviewed public canary files from a clean Git commit."""
import argparse
import hashlib
import io
import subprocess
import tarfile
from pathlib import Path

FILES = {
    'code/integration/__init__.py':'integration/__init__.py',
    'code/integration/canary_common.py':'integration/canary_common.py',
    'code/integration/https_canary.py':'integration/https_canary.py',
    'code/integration/oauth_canary.py':'integration/oauth_canary.py',
    'code/integration/canary_health.py':'integration/canary_health.py',
    'setup.py':'deployment/canary_setup.py',
    'compose.yaml':'deployment/compose.canary.yaml',
}


def archive(path, contents):
    with tarfile.open(path,'w:gz') as output:
        for name in ['code','code/integration']:
            entry=tarfile.TarInfo(name);entry.type=tarfile.DIRTYPE;entry.mode=0o755
            output.addfile(entry)
        for name,data in contents.items():
            entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644
            output.addfile(entry,io.BytesIO(data))
    Path(path).chmod(0o644)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    def git(*arguments):
        return subprocess.check_output(['git',*arguments],cwd=repo)
    if git('status','--porcelain').strip() or args.output.exists():
        raise SystemExit('Clean commit and new output path required')
    commit=git('rev-parse','HEAD').decode().strip()
    data={target:git('show',f'HEAD:services/naver-mail/{source}') for target,source in FILES.items()}
    data['SOURCE_COMMIT.txt']=(commit+'\n').encode()
    archive(args.output,data)
    print('CANARY_SOURCE_COMMIT='+commit)
    print('CANARY_BUNDLE_SHA256='+hashlib.sha256(args.output.read_bytes()).hexdigest())
    print('PRIVATE_FILES_INCLUDED=no')
    print('REAL_GROK_WEB_VERIFIED=no')


if __name__=='__main__':
    main()
