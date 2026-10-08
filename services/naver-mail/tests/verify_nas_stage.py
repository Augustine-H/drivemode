"""Exercise NAS root staging and permission-error recovery on real Docker.

Only temporary cloud fixtures are mounted. No service is started, no ports are
published, and no real IMAP credentials or external model calls are used.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True, type=Path)
    args = parser.parse_args()
    script = Path(__file__).resolve().parents[1] / 'deployment/nas_stage.sh'
    image = 'voice-grok-naver-mail:1.0.0'
    plugins = json.loads(subprocess.check_output(
        ['docker', 'info', '--format', '{{json .ClientInfo.Plugins}}']))
    compose = next(p['Path'] for p in plugins if p['Name'] == 'compose')
    docker = shutil.which('docker')
    with tempfile.TemporaryDirectory(prefix='nas-stage-', dir='/workspace/.onboarding') as directory:
        root = Path(directory)
        release = root / 'release'
        release.mkdir()
        hashes = {}
        for name in ['naver-mail-source.tar.gz', 'naver-mail-image.tar.gz']:
            shutil.copyfile(args.release / name, release / name)
            with (release / name).open('rb') as handle:
                hashes[name] = hashlib.file_digest(handle, 'sha256').hexdigest()

        def run(*command):
            return subprocess.run([
                'docker', 'run', '--rm', '--network=none', '--read-only',
                '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
                '--cap-add=FOWNER', '--cap-add=DAC_OVERRIDE',
                '--security-opt=no-new-privileges:true',
                '-v', f'{root}:{root}',
                '-v', '/var/run/docker.sock:/var/run/docker.sock',
                '-v', f'{docker}:/usr/local/bin/docker:ro',
                '-v', f'{compose}:/usr/libexec/docker/cli-plugins/docker-compose:ro',
                '--entrypoint', command[0], image, *command[1:]],
                capture_output=True, text=True, timeout=180)

        def make_script(name, project, *, broken=False, resume=False):
            body = script.read_text().replace(
                '/volume1/docker/voice-grok-naver-mail-release', str(release))
            body = body.replace('/volume1/docker/voice-grok-naver-mail', str(project))
            if broken:
                body = body.replace('/token-helper.py add', '-m naver_mail.manage_tokens add')
            prefix = (
                f'NAS_RELEASE_SOURCE_SHA256={hashes["naver-mail-source.tar.gz"]}\n'
                f'NAS_RELEASE_IMAGE_SHA256={hashes["naver-mail-image.tar.gz"]}\n'
                f'NAS_STAGE_RESUME={int(resume)}\n')
            path = root / name
            path.write_text(prefix + body)
            return str(path)

        def expect(result, *, success=False, text=''):
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            assert text in result.stdout + result.stderr, result.stdout + result.stderr

        try:
            fresh = root / 'fresh'
            expect(run('sh', make_script('fresh.sh', fresh)), success=True,
                   text='STAGING_COMPLETE=yes')
            expect(run('sh', str(root / 'fresh.sh')), text='project_directory_already_exists')
            partial = root / 'partial'
            expect(run('sh', make_script('broken.sh', partial, broken=True)),
                   text="Permission denied: '/app/naver_mail/__init__.py'")
            recovery = make_script('resume.sh', partial, resume=True)
            # Modified source and preexisting private credentials must stop
            # recovery without creating tokens or overwriting the data.
            source = partial / 'services/naver-mail/naver_mail/manage_tokens.py'
            expect(run('python', '-c',
                       'import pathlib,sys;p=pathlib.Path(sys.argv[1]);'
                       'p.rename(p.with_suffix(".saved"));p.write_text("modified")',
                       str(source)), success=True)
            expect(run('sh', recovery), text='Resume source was modified')
            expect(run('python', '-c',
                       'import pathlib,sys;p=pathlib.Path(sys.argv[1]);'
                       'p.unlink();p.with_suffix(".saved").rename(p)', str(source)), success=True)
            credentials = partial / 'services/naver-mail/private/server/imap.json'
            expect(run('python', '-c',
                       'import pathlib,sys;pathlib.Path(sys.argv[1]).write_text("synthetic sentinel")',
                       str(credentials)), success=True)
            expect(run('sh', recovery), text='Resume refuses existing credentials')
            expect(run('python', '-c',
                       'import pathlib,sys;p=pathlib.Path(sys.argv[1]);'
                       'assert p.read_text()=="synthetic sentinel";'
                       'assert not p.with_name("tokens.json").exists();p.unlink()',
                       str(credentials)), success=True)
            expect(run('sh', recovery), success=True, text='STAGING_COMPLETE=yes')
            expect(run('sh', recovery), text='Resume refuses existing credentials')
            check = '''
import hashlib,json,pathlib,stat,sys
for project in sys.argv[1:]:
    service=pathlib.Path(project)/"services/naver-mail"
    server=service/"private/server"
    rows=json.loads((server/"tokens.json").read_text())["tokens"]
    assert len(rows)==3 and len({r["sha256"] for r in rows})==3
    for identifier,client,relative in [("voice-v1","voice","clients/voice-v1"),("health-v1","voice","server/health-token"),("web-v1","grok_web","clients/web-v1")]:
        token=service/"private"/relative
        row=next(r for r in rows if r["id"]==identifier)
        assert row["client"]==client and row["enabled"]
        assert row["sha256"]==hashlib.sha256(token.read_text().strip().encode()).hexdigest()
        assert stat.S_IMODE(token.stat().st_mode)==(0o440 if client=="voice" and identifier=="health-v1" else 0o600)
    for name in ["config.json","tokens.json","health-token"]:
        assert (server/name).stat().st_gid==10001
        assert stat.S_IMODE((server/name).stat().st_mode)==0o440
    assert not (server/"imap.json").exists()
    assert json.loads((server/"config.json").read_text())["web_auth_verified"] is False
    assert "127.0.0.1:13001:3001" in (service/"compose.nas.yaml").read_text()
print("STAGING_TOKEN_PERMISSIONS_AND_SEPARATION=passed")
'''
            expect(run('python', '-c', check, str(fresh), str(partial)),
                   success=True, text='STAGING_TOKEN_PERMISSIONS_AND_SEPARATION=passed')
            print(json.dumps({
                'fresh_staging': 'passed', 'original_error_reproduced': 'passed',
                'partial_staging_recovery': 'passed', 'existing_project_guard': 'passed',
                'modified_source_guard': 'passed', 'existing_credentials_guard': 'passed',
                'existing_tokens_guard': 'passed', 'token_permissions_and_separation': 'passed',
                'real_nas_imap_grok_xai': 'not_run'}, indent=2))
        finally:
            cleanup = run('python', '-c',
                          'import pathlib,shutil,sys;'
                          '[shutil.rmtree(p) for p in pathlib.Path(sys.argv[1]).iterdir() if p.is_dir()]',
                          str(root))
            assert cleanup.returncode == 0, 'Temporary root-owned fixture cleanup failed'


if __name__ == '__main__':
    main()
