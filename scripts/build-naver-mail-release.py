"""Export a tracked NAS source bundle and verified amd64 image, without private files."""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAG = 'voice-grok-naver-mail:1.0.0'


def command(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('release_command_failed')
    return result.stdout


def build(output, image):
    if command('git', 'status', '--porcelain').strip():
        raise ValueError('commit_changes_before_packaging')
    commit = command('git', 'rev-parse', 'HEAD').decode().strip()
    info = json.loads(command('docker', 'image', 'inspect', image))[0]
    if (info['Architecture'], info['Os'], info['Config']['User']) != ('amd64', 'linux', '10001:10001'):
        raise ValueError('unexpected_image_platform_or_user')
    files = [*sorted((ROOT/'services/naver-mail/naver_mail').glob('*.py')),
             ROOT/'services/naver-mail/requirements.txt']
    source_hashes = {str(path.relative_to(ROOT/'services/naver-mail')):
                     hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    code = ('import pathlib,hashlib,json; paths=list(pathlib.Path("/app/naver_mail").glob("*.py")); '
            'print(json.dumps({str(p.relative_to("/app")):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}))')
    image_hashes = json.loads(command('docker', 'run', '--rm', '--network=none', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--entrypoint', 'python', image, '-c', code))
    # Build-time lock can be root-owned 0600, runtime files owned 10001/0600.
    # Read each as its owner; neither inspection has network/mounts/capabilities.
    lock_code = ('import pathlib,hashlib,json; '
                 'print(json.dumps({"requirements.txt":hashlib.sha256(pathlib.Path("/app/requirements.txt").read_bytes()).hexdigest()}))')
    image_hashes.update(json.loads(command('docker', 'run', '--rm', '--user=0:0', '--network=none', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--entrypoint', 'python', image, '-c', lock_code)))
    if source_hashes != image_hashes:
        raise ValueError('image_does_not_match_tracked_runtime_source')
    # A pre-existing different release tag is never overwritten.
    existing = subprocess.run(['docker', 'image', 'inspect', TAG], capture_output=True, cwd=ROOT)
    if existing.returncode == 0 and json.loads(existing.stdout)[0]['Id'] != info['Id']:
        raise ValueError('release_tag_already_points_to_different_image')
    if existing.returncode:
        command('docker', 'tag', image, TAG)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = command('git', '-c', 'tar.umask=0022', 'archive', '--format=tar', 'HEAD', 'services/naver-mail',
                     'docs/naver-mail-architecture.md', 'docs/naver-mail-validation.md',
                     'scripts/build-naver-mail-release.py')
    import tarfile
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        for member in archive:
            path = Path(member.name)
            if (path.is_absolute() or '..' in path.parts or 'private' in path.parts
                    or (path.name.startswith('.env') and path.name != '.env.example')
                    or member.issym() or member.islnk()):
                raise ValueError('unsafe_source_archive_member')
    with (output/'naver-mail-source.tar.gz').open('wb') as handle:
        with gzip.GzipFile(filename='', mode='wb', fileobj=handle, mtime=0) as compressed:
            compressed.write(source)
    with (output/'naver-mail-image.tar.gz').open('wb') as handle:
        with gzip.GzipFile(filename='', mode='wb', fileobj=handle, mtime=0) as compressed:
            process = subprocess.Popen(['docker', 'image', 'save', TAG], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                while chunk := process.stdout.read(1024*1024):
                    compressed.write(chunk)
                if process.wait(timeout=60):
                    raise RuntimeError('image_export_failed')
            finally:
                if process.poll() is None:
                    process.kill(); process.wait(timeout=10)
    manifest = {'source_commit': commit, 'image_tag': TAG, 'image_id': info['Id'],
                'platform': 'linux/amd64', 'runtime_source_sha256': source_hashes,
                'private_files_included': False, 'nas_deployed': False,
                'real_imap_verified': False, 'grok_web_verified': False, 'xai_verified': False}
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    checksums = []
    for path in sorted(output.iterdir()):
        digest = hashlib.sha256()
        with path.open('rb') as handle:
            while chunk := handle.read(1024*1024): digest.update(chunk)
        checksums.append(f'{digest.hexdigest()}  {path.name}')
    (output/'SHA256SUMS').write_text('\n'.join(checksums)+'\n')
    print(json.dumps({'status': 'prepared', 'source_commit': commit, 'image_id': info['Id'],
                      'platform': 'linux/amd64', 'private_files_included': False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--image', default='voice-grok-naver-mail:test')
    args = parser.parse_args()
    try:
        build(args.output, args.image)
    except Exception:
        raise SystemExit('Release packaging failed; check clean commit, matching image and new output directory. No private details printed.') from None


if __name__ == '__main__':
    main()
