"""Whitelist-export the optional dual OAuth runtime from a clean Git commit."""
import argparse
import hashlib
import io
import subprocess
import tarfile
from pathlib import Path

MODULES=('__init__','auth','health','mail','manage_tokens','server','oauth_store','oauth_provider',
         'oauth_http','oauth_consent','oauth_server','oauth_health','oauth_admin','read_only_audit','validation_mail')
FILES={f'code/naver_mail/{name}.py':f'naver_mail/{name}.py' for name in MODULES}
FILES.update({'setup.py':'deployment/oauth_setup.py','compose.yaml':'deployment/compose.oauth.yaml',
              'compose.real-mail.yaml':'deployment/compose.oauth.real.yaml','enable-real.py':'deployment/oauth_enable_real.py'})


def archive(path,contents):
    with tarfile.open(path,'w:gz') as output:
        for name in ['code','code/naver_mail']:
            entry=tarfile.TarInfo(name);entry.type=tarfile.DIRTYPE;entry.mode=0o755;output.addfile(entry)
        for name,data in contents.items():
            entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644;output.addfile(entry,io.BytesIO(data))
    Path(path).chmod(0o644)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();repo=Path(__file__).resolve().parents[1]
    def git(*args):return subprocess.check_output(['git',*args],cwd=repo)
    if args.output.exists() or git('status','--porcelain').strip():raise SystemExit('Clean commit and new output path required')
    commit=git('rev-parse','HEAD').decode().strip()
    data={target:git('show',f'HEAD:services/naver-mail/{source}') for target,source in FILES.items()}
    data['SOURCE_COMMIT.txt']=(commit+'\n').encode();archive(args.output,data)
    print('OAUTH_SOURCE_COMMIT='+commit)
    print('OAUTH_BUNDLE_SHA256='+hashlib.sha256(args.output.read_bytes()).hexdigest())
    print('PRIVATE_FILES_INCLUDED=no; DEFAULT_MODE=validation')


if __name__=='__main__':main()
