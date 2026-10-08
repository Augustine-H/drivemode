"""Real Docker canary setup TTY/privacy and isolated startup/restart checks."""
import json
import os
import pathlib
import pty
import secrets
import select
import shutil
import subprocess
import tempfile
import time


def main():
    service=pathlib.Path(__file__).resolve().parents[1]
    image='voice-grok-naver-mail:1.0.0'
    name='oauth-canary-fixture-'+secrets.token_hex(4)
    phrase=b'synthetic-hidden-canary-approval-phrase'
    with tempfile.TemporaryDirectory(dir='/workspace/.onboarding',prefix='oauth-canary-') as td:
        root=pathlib.Path(td);root.chmod(0o755)
        project=root/'project';project.mkdir();project.chmod(0o750)
        code=project/'code/integration';code.mkdir(parents=True)
        for directory in [project/'code',code]: directory.chmod(0o755)
        for filename in ['__init__.py','canary_common.py','https_canary.py','oauth_canary.py','canary_health.py']:
            shutil.copyfile(service/'integration'/filename,code/filename);(code/filename).chmod(0o644)
        shutil.copyfile(service/'deployment/canary_setup.py',project/'setup.py');(project/'setup.py').chmod(0o644)
        def docker(*args):
            result=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=45)
            if result.returncode:
                raise RuntimeError('Docker canary fixture operation failed; private output suppressed')
            return result.stdout.strip()
        def admin(statement):
            return docker('run','--rm','--network=none','--read-only','--user','0:0',
                '--cap-drop=ALL','--cap-add=CHOWN','--cap-add=DAC_OVERRIDE','--cap-add=FOWNER',
                '-v',f'{project}:/project','--entrypoint','python',image,'-c',statement)
        try:
            admin('import os;os.chown("/project",0,0)')
            command=['docker','run','--rm','-it','--network=none','--read-only','--user','0:10001',
                '--cap-drop=ALL','--security-opt=no-new-privileges:true','-e','PYTHONPATH=/code',
                '-v',f'{project}:/project','-v',f'{project}/code:/code:ro',
                '-v',f'{project}/setup.py:/setup.py:ro','--entrypoint','python',image,'/setup.py',
                '--issuer','https://canary.example.test:8446','--proxy','172.18.0.1']
            pid,fd=pty.fork()
            if pid==0:
                os.execvp(command[0],command)
            output=b'';index=0;status=None
            prompts=[b'New CANARY-only approval passphrase (16+ characters, hidden): ',
                     b'Confirm CANARY-only passphrase (hidden): ']
            try:
                deadline=time.monotonic()+50
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
                    if child:
                        status=child_status;break
                if status is None:
                    child,status=os.waitpid(pid,os.WNOHANG)
                    if not child:
                        os.kill(pid,15);os.waitpid(pid,0)
                        raise AssertionError('Interactive canary fixture timed out')
                assert status==0 and index==2 and b'CANARY_OWNER_SETUP=passed' in output
                assert phrase not in output,'Synthetic approval phrase was echoed'
            finally:
                os.close(fd)
            admin('''import pathlib,json,stat,hashlib
p=pathlib.Path('/project/private');assert p.stat().st_uid==0 and p.stat().st_gid==10001 and stat.S_IMODE(p.stat().st_mode)==0o750
assert {f.name for f in p.iterdir()}=={'owner.json','config.json','health-token'}
for f in p.iterdir():assert f.stat().st_uid==0 and f.stat().st_gid==10001 and stat.S_IMODE(f.stat().st_mode)==0o440
j=json.loads((p/'owner.json').read_text());assert j['hash']==hashlib.scrypt(b'synthetic-hidden-canary-approval-phrase',salt=bytes.fromhex(j['salt']),n=16384,r=8,p=1).hex()
assert b'synthetic-hidden-canary-approval-phrase' not in (p/'owner.json').read_bytes()
''')
            docker('run','-d','--name',name,'--network=none','--read-only','--user','10001:10001',
                '--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory=384m',
                '--pids-limit=64','-e','PYTHONPATH=/code:/app',
                '-v',f'{project}/code:/code:ro','-v',f'{project}/private:/canary-private:ro',
                '--entrypoint','python',image,'-m','integration.oauth_canary','--directory','/canary-private')
            def health():
                deadline=time.monotonic()+20
                while time.monotonic()<deadline:
                    result=subprocess.run(['docker','exec',name,'python','-m','integration.canary_health'],capture_output=True,timeout=10)
                    if result.returncode==0:return
                    time.sleep(0.3)
                raise AssertionError('Canary health failed; private logs suppressed')
            health()
            docker('exec',name,'python','-c','''import urllib.request,urllib.error,json,pathlib
try:urllib.request.urlopen('http://127.0.0.1:3001/mcp');raise AssertionError()
except urllib.error.HTTPError as e:assert e.code==403
try:urllib.request.urlopen('http://127.0.0.1:3001/health');raise AssertionError()
except urllib.error.HTTPError as e:assert e.code==401
token=pathlib.Path('/canary-private/health-token').read_text().strip()
r=urllib.request.Request('http://127.0.0.1:3001/diagnostic',headers={'Authorization':'Bearer '+token})
with urllib.request.urlopen(r) as response:j=json.load(response)
assert j['registered_clients']==0 and j['real_mail_account_connected'] is False
''')
            info=json.loads(docker('inspect',name))[0]
            assert info['Config']['User']=='10001:10001' and info['HostConfig']['ReadonlyRootfs']
            assert all(m['Destination'] not in {'/run/secrets','/private'} and not m['RW'] for m in info['Mounts'])
            docker('restart',name);health()
            print(json.dumps({'interactive_owner_setup':'passed','approval_phrase_not_echoed':'passed',
                'hash_only_owner_storage_and_permissions':'passed','non_root_readonly_start':'passed',
                'authenticated_health':'passed','unauthenticated_health_401':'passed',
                'plain_http_mcp_403':'passed','restart':'passed',
                'real_account_mount':'absent','real_grok_web':'not_run'},indent=2))
        finally:
            subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=30)
            admin('import pathlib,shutil,os;p=pathlib.Path("/project/private");shutil.rmtree(p) if p.exists() else None;os.chown("/project",1000,1000)')


if __name__=='__main__':
    main()
