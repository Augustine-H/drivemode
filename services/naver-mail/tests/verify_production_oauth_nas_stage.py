"""Full persistent OAuth staging script on isolated real Docker root/TTY fixtures."""
import base64
import hashlib
import re
import urllib.request
import urllib.error
from urllib.parse import urlencode,urlsplit,parse_qs
from http.cookies import SimpleCookie
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
    spec=importlib.util.spec_from_file_location('bundle',service.parents[1]/'scripts/build-naver-oauth-release.py')
    bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)
    project_name='persistent-oauth-fixture-'+secrets.token_hex(4)
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
        contents['compose.yaml']=contents['compose.yaml'].replace(b'voice-grok-naver-oauth',project_name.encode()).replace(b'13003',str(port).encode())
        tar=release/'naver-mail-oauth-runtime.tar.gz';bundle.archive(tar,contents)
        script=(service/'deployment/nas_oauth_stage.sh').read_text()
        script=script.replace('/volume1/docker/voice-grok-naver-mail-release',str(release))
        script=script.replace('/volume1/docker/voice-grok-naver-mail-oauth',str(project))
        script=script.replace('voice-grok-naver-oauth',project_name).replace('13003',str(port))
        prefix=f'NAS_OAUTH_BUNDLE_SHA256={hashlib.sha256(tar.read_bytes()).hexdigest()}\nNAS_OAUTH_ISSUER=https://canary.example.test:8446\n'
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
            prompts=[b'New MAIL access approval passphrase (16+ characters, hidden): ',b'Confirm MAIL approval passphrase (hidden): ']
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
                assert status==0 and b'OAUTH_STAGING_COMPLETE=yes' in output,output.decode(errors='replace')[-2000:]
                assert phrase not in output,'Synthetic phrase echoed in nested TTY'
            finally:os.close(fd)
            inspect=json.loads(subprocess.check_output(['docker','inspect',project_name+'-mail-oauth-1']))[0]
            assert inspect['Config']['User']=='10001:10001' and inspect['HostConfig']['ReadonlyRootfs']
            assert inspect['NetworkSettings']['Ports']['3001/tcp']==[{'HostIp':'127.0.0.1','HostPort':str(port)}]
            assert all(m['RW']==(m['Destination']=='/oauth-state') for m in inspect['Mounts'])
            assert all(m['Destination']!='/run/mail-private' for m in inspect['Mounts'])
            issuer='https://canary.example.test:8446'
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self,*args,**kwargs):return None
            opener=urllib.request.build_opener(NoRedirect())
            def request(path,data=None,extra=None):
                headers={'Host':'canary.example.test:8446','X-Forwarded-Proto':'https',**(extra or {})}
                body=None
                if isinstance(data,dict):body=urlencode(data).encode();headers['Content-Type']='application/x-www-form-urlencoded'
                elif data is not None:body=data
                req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=body,headers=headers)
                try:
                    with opener.open(req,timeout=10) as r:return r.status,r.headers,r.read(65536)
                except urllib.error.HTTPError as r:return r.code,r.headers,r.read(65536)
            status,_,_=request('/.well-known/oauth-authorization-server');assert status==200
            status,_,_=request('/mcp');assert status==401
            registration={'redirect_uris':['https://grok.com/oauth/callback'],'scope':'mail.read',
                'grant_types':['authorization_code','refresh_token'],'response_types':['code'],'token_endpoint_auth_method':'none'}
            status,_,raw=request('/register',json.dumps(registration).encode(),{'Content-Type':'application/json'})
            assert status==201;client=json.loads(raw)['client_id']
            verifier='synthetic-docker-verifier-'+'v'*43
            challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
            query=urlencode({'client_id':client,'response_type':'code','redirect_uri':registration['redirect_uris'][0],
                'scope':'mail.read','resource':issuer+'/mcp','code_challenge':challenge,'code_challenge_method':'S256'})
            status,headers,_=request('/authorize?'+query);assert status==302
            consent_path=urlsplit(headers['Location']).path+'?'+urlsplit(headers['Location']).query
            status,headers,raw=request(consent_path);assert status==200
            csrf=re.search(rb'name="csrf" type="hidden" value="([^"]+)"',raw)[1].decode()
            cookie=SimpleCookie();cookie.load(headers['Set-Cookie'])
            status,headers,_=request(consent_path,{'csrf':csrf,'phrase':phrase.decode()},
                {'Origin':issuer,'Cookie':'naver_mail_consent='+cookie['naver_mail_consent'].value})
            assert status==303
            code=parse_qs(urlsplit(headers['Location']).query)['code'][0]
            status,_,raw=request('/token',{'grant_type':'authorization_code','client_id':client,'code':code,
                'code_verifier':verifier,'redirect_uri':registration['redirect_uris'][0]})
            assert status==200;tokens=json.loads(raw)
            payload=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call',
                'params':{'name':'mail_get_message','arguments':{'folder':'INBOX','uid':1,'uidvalidity':77}}}).encode()
            headers={'Authorization':'Bearer '+tokens['access_token'],'Accept':'application/json, text/event-stream','Content-Type':'application/json'}
            status,_,raw=request('/mcp',payload,headers)
            assert status==200 and json.loads(raw)['result']['structuredContent']['canary'] is True
            subprocess.run(['docker','exec',project_name+'-mail-oauth-1','python','-c',
                'import os; s=os.stat("/oauth-state/oauth.db"); assert s.st_uid==10001 and s.st_mode&0o777==0o600'],
                capture_output=True,check=True,timeout=10)
            # Restart just this fixture; the access token and registration survive.
            subprocess.run(['docker','restart',project_name+'-mail-oauth-1'],capture_output=True,check=True,timeout=30)
            ready=False
            for _ in range(30):
                try:
                    status,_,raw=request('/mcp',payload,headers)
                    if status==200:ready=True;break
                except Exception:pass
                time.sleep(.2)
            assert ready,'Durable OAuth token failed after Docker restart'
            status,_,raw=request('/token',{'grant_type':'refresh_token','client_id':client,'refresh_token':tokens['refresh_token']})
            assert status==200;rotated=json.loads(raw)
            status,_,_=request('/mcp',payload,headers);assert status==401
            status,_,_=request('/token',{'grant_type':'refresh_token','client_id':client,'refresh_token':tokens['refresh_token']});assert status==400
            status,_,_=request('/mcp',payload,{**headers,'Authorization':'Bearer '+rotated['access_token']});assert status==401
            # Root-only publication accepts only a private audit + explicit data-policy acknowledgement.
            # This is a synthetic receipt; no real credentials or IMAP are used here.
            report=project/'fixture-audit.json'
            checks=['uidvalidity_unchanged','seen_flag_unchanged','all_flags_unchanged',
                    'safe_text_returned','response_size_bounded','attachment_metadata_only']
            receipt={'status':'passed','checked_at':int(time.time()),'checks':{name:True for name in checks},
                'mail_values_printed':False,'credential_values_printed':False}
            write=root_command('python','-c','import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.write_text(sys.argv[2]);p.chmod(0o440)',str(report),json.dumps(receipt))
            write.remove('-it');subprocess.run(write,capture_output=True,check=True,timeout=20)
            def publish(*args):
                cmd=root_command('python',str(project/'enable-real.py'),*args)
                cmd.remove('-it');cmd[cmd.index('--user')+1]='0:10001'
                # Standalone helper requires the fixed /project management mount.
                at=cmd.index('--entrypoint');cmd[at:at]=['-v',f'{project}:/project']
                return subprocess.run(cmd,capture_output=True,timeout=20)
            rejected=publish('--audit-report',str(report));assert rejected.returncode!=0
            enabled=publish('--audit-report',str(report),'--acknowledge-xai-policy');assert enabled.returncode==0
            rollback=publish('--rollback-validation');assert rollback.returncode==0
            subprocess.run(['docker','exec',project_name+'-mail-oauth-1','python','-c',
                'import json; assert json.load(open("/oauth-private/config.json"))["mode"]=="validation"'],capture_output=True,check=True,timeout=10)
            print(json.dumps({'full_root_staging_script':'passed','nested_interactive_input_hidden':'passed',
                'compose_start_and_restart':'passed','non_root_readonly_code_and_private':'passed','isolated_writable_oauth_state':'passed','real_mail_private_not_mounted':'passed',
                'loopback_only_published_port':'passed','sdk_oauth_actual_docker_http':'passed','token_survives_docker_restart':'passed','refresh_rotation_and_replay':'passed','root_mode_publication_and_rollback':'passed','missing_policy_acknowledgement_rejected':'passed','real_nas_https_grok':'not_run'},indent=2))
        finally:
            subprocess.run(['docker','rm','-f',project_name+'-mail-oauth-1'],capture_output=True,timeout=30)
            subprocess.run(['docker','network','rm',project_name],capture_output=True,timeout=30)
            cleanup=root_command('python','-c','import pathlib,shutil,sys;p=pathlib.Path(sys.argv[1]);shutil.rmtree(p) if p.exists() else None',str(project))
            # Cleanup needs no interactive input; omit the Docker -it flags.
            cleanup.remove('-it')
            result=subprocess.run(cleanup,capture_output=True,timeout=30)
            assert result.returncode==0,'Root fixture cleanup failed'


if __name__=='__main__':
    main()
