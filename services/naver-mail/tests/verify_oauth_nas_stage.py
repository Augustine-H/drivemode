"""Full NAS canary staging script on isolated real Docker root/TTY fixtures."""
import hashlib
import importlib.util
import json
import os
import pathlib
import pty
import secrets
import select
import shutil
import socket
import subprocess
import tempfile
import time


def main():
    service=pathlib.Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('bundle',service.parents[1]/'scripts/build-naver-canary-release.py')
    bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)
    project_name='oauth-stage-fixture-'+secrets.token_hex(4)
    plugins=json.loads(subprocess.check_output(['docker','info','--format','{{json .ClientInfo.Plugins}}']))
    plugin=next(p['Path'] for p in plugins if p['Name']=='compose')
    image='voice-grok-naver-mail:1.0.0'
    phrase=b'synthetic-hidden-nested-canary-phrase'
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1',0));port=candidate.getsockname()[1]
    with tempfile.TemporaryDirectory(dir='/workspace/.onboarding',prefix='oauth-nas-stage-') as td:
        root=pathlib.Path(td);root.chmod(0o755)
        release=root/'release';release.mkdir();release.chmod(0o755)
        project=root/'project'
        contents={target:(service/source).read_bytes() for target,source in bundle.FILES.items()}
        contents['compose.yaml']=contents['compose.yaml'].replace(b'voice-grok-naver-canary',project_name.encode()).replace(b'13002',str(port).encode())
        tar=release/'naver-mail-oauth-canary.tar.gz';bundle.archive(tar,contents)
        script=(service/'deployment/nas_canary_stage.sh').read_text()
        script=script.replace('/volume1/docker/voice-grok-naver-mail-release',str(release))
        script=script.replace('/volume1/docker/voice-grok-naver-mail-canary',str(project))
        script=script.replace('voice-grok-naver-canary',project_name).replace('13002',str(port))
        prefix=f'NAS_CANARY_BUNDLE_SHA256={hashlib.sha256(tar.read_bytes()).hexdigest()}\nNAS_CANARY_ISSUER=https://canary.example.test:8446\n'
        path=root/'stage.sh';path.write_text(prefix+script);path.chmod(0o644)
        def root_command(*command):
            return ['docker','run','--rm','-it','--network=none','--read-only','--user','0:0',
                '--cap-drop=ALL','--cap-add=CHOWN','--cap-add=FOWNER','--cap-add=DAC_OVERRIDE',
                '--security-opt=no-new-privileges:true','-v',f'{root}:{root}',
                '-v','/var/run/docker.sock:/var/run/docker.sock',
                '-v',f'{shutil.which("docker")}:/usr/local/bin/docker:ro',
                '-v',f'{plugin}:/usr/libexec/docker/cli-plugins/docker-compose:ro',
                '--entrypoint',command[0],image,*command[1:]]
        try:
            cmd=root_command('sh',str(path))
            pid,fd=pty.fork()
            if pid==0:os.execvp(cmd[0],cmd)
            output=b'';index=0;status=None
            prompts=[b'New CANARY-only approval passphrase (16+ characters, hidden): ',b'Confirm CANARY-only passphrase (hidden): ']
            try:
                deadline=time.monotonic()+150
                while time.monotonic()<deadline:
                    ready,_,_=select.select([fd],[],[],0.2)
                    if ready:
                        try:chunk=os.read(fd,65536)
                        except OSError:break
                        if not chunk:break
                        output+=chunk
                        if index<2 and prompts[index] in output:
                            time.sleep(0.05);os.write(fd,phrase+b'\n');index+=1
                    child,child_status=os.waitpid(pid,os.WNOHANG)
                    if child:status=child_status;break
                if status is None:
                    child,status=os.waitpid(pid,os.WNOHANG)
                    if not child:
                        os.kill(pid,15);os.waitpid(pid,0)
                        raise AssertionError('Full staging fixture timed out')
                assert status==0 and b'CANARY_STAGING_COMPLETE=yes' in output,output.decode(errors='replace')[-2000:]
                assert phrase not in output,'Synthetic phrase echoed in nested TTY'
            finally:os.close(fd)
            inspect=json.loads(subprocess.check_output(['docker','inspect',project_name+'-canary-1']))[0]
            assert inspect['Config']['User']=='10001:10001' and inspect['HostConfig']['ReadonlyRootfs']
            assert inspect['NetworkSettings']['Ports']['3001/tcp']==[{'HostIp':'127.0.0.1','HostPort':str(port)}]
            assert all(not m['RW'] and m['Destination'] not in {'/run/secrets','/private'} for m in inspect['Mounts'])
            print(json.dumps({'full_root_staging_script':'passed','nested_interactive_input_hidden':'passed',
                'compose_start_and_restart':'passed','non_root_readonly_mounts':'passed',
                'loopback_only_published_port':'passed','real_nas_https_grok':'not_run'},indent=2))
        finally:
            subprocess.run(['docker','rm','-f',project_name+'-canary-1'],capture_output=True,timeout=30)
            subprocess.run(['docker','network','rm',project_name],capture_output=True,timeout=30)
            cleanup=root_command('python','-c','import pathlib,shutil,sys;p=pathlib.Path(sys.argv[1]);shutil.rmtree(p) if p.exists() else None',str(project))
            # Cleanup needs no interactive input; omit the Docker -it flags.
            cleanup.remove('-it')
            result=subprocess.run(cleanup,capture_output=True,timeout=30)
            assert result.returncode==0,'Root fixture cleanup failed'


if __name__=='__main__':
    main()
