#!/bin/sh
# Read-only staging verification; preserve all tokens and never start MCP.
set -eu
nas_verify_service=/volume1/docker/voice-grok-naver-mail/services/naver-mail
nas_verify_image=voice-grok-naver-mail:1.0.0
nas_verify_docker=$(command -v docker 2>/dev/null || true)
if [ -z "$nas_verify_docker" ]; then
  for nas_verify_candidate in /usr/local/bin/docker /var/packages/ContainerManager/target/usr/bin/docker /var/packages/Docker/target/usr/bin/docker; do
    if [ -x "$nas_verify_candidate" ]; then nas_verify_docker="$nas_verify_candidate"; break; fi
  done
fi
[ "$(id -u)" = 0 ] && [ -n "$nas_verify_docker" ] || exit 1
[ "$("$nas_verify_docker" image inspect "$nas_verify_image" --format '{{.Id}}')" = sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3 ] || exit 1
"$nas_verify_docker" run --rm -i --network=none --read-only --user 0:0 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -v "$nas_verify_service:/project:ro" --entrypoint python "$nas_verify_image" - <<'PY'
import hashlib,json,pathlib,re,stat
def check():
    root=pathlib.Path('/project')
    private=root/'private'
    def require(value):
        if not value: raise ValueError('invalid_staging')
    def metadata(path,mode,gid=None):
        info=path.lstat()
        require(not path.is_symlink() and stat.S_IMODE(info.st_mode)==mode and info.st_uid==0)
        require(stat.S_ISDIR(info.st_mode) if path.name in {'private','server','clients'} else stat.S_ISREG(info.st_mode))
        require(gid is None or info.st_gid==gid)
    def read(path):
        require(path.stat().st_size<=16384)
        return path.read_text()
    metadata(private,0o700)
    metadata(private/'clients',0o700)
    metadata(private/'server',0o750,10001)
    for name in ['config.json','tokens.json','health-token']:
        metadata(private/'server'/name,0o440,10001)
    template=read(root/'compose.yaml')
    mapping='127.0.0.1:${NAVER_MAIL_HOST_PORT:-3001}:3001'
    require(template.count(mapping)==1 and read(root/'compose.nas.yaml')==template.replace(mapping,'127.0.0.1:13001:3001'))
    config=json.loads(read(root/'config.example.json'))
    config.update(allowed_hosts=['127.0.0.1:3001','localhost:3001','127.0.0.1:13001'],trusted_proxies=[],web_auth_verified=False)
    require(json.loads(read(private/'server/config.json'))==config)
    rows=json.loads(read(private/'server/tokens.json'))['tokens']
    require(len(rows)==3 and {r['id'] for r in rows}=={'voice-v1','health-v1','web-v1'})
    require(len({r['sha256'] for r in rows})==3)
    for identifier,role,path in [('voice-v1','voice',private/'clients/voice-v1'),('health-v1','voice',private/'server/health-token'),('web-v1','grok_web',private/'clients/web-v1')]:
        metadata(path,0o440 if identifier=='health-v1' else 0o600,10001 if identifier=='health-v1' else None)
        value=read(path).strip()
        require(re.fullmatch(r'[A-Za-z0-9_-]{32,256}',value))
        row=next(r for r in rows if r['id']==identifier)
        require(row['client']==role and row.get('enabled') is True and row['sha256']==hashlib.sha256(value.encode()).hexdigest())
try:
    check()
except Exception:
    print('STAGING_FILES_CHECK=failed; private details suppressed')
    raise SystemExit(1) from None
print('STAGING_FILES_CHECK=passed')
PY
# Use the production UID to check real private-mount read access.
"$nas_verify_docker" run --rm -i --network=none --read-only --user 10001:10001 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -v "$nas_verify_service/private/server:/run/secrets:ro" \
  --entrypoint python "$nas_verify_image" - <<'PY'
import json,pathlib
try:
    root=pathlib.Path('/run/secrets')
    for name in ['config.json','tokens.json']: json.loads((root/name).read_text())
    if not (root/'health-token').read_text().strip(): raise ValueError()
except Exception:
    print('RUNTIME_PRIVATE_READ_CHECK=failed; private details suppressed')
    raise SystemExit(1) from None
print('RUNTIME_PRIVATE_READ_CHECK=passed')
PY
if "$nas_verify_docker" compose version >/dev/null 2>&1; then
  "$nas_verify_docker" compose -p voice-grok-naver-mail -f "$nas_verify_service/compose.nas.yaml" config --quiet
else
  docker-compose -p voice-grok-naver-mail -f "$nas_verify_service/compose.nas.yaml" config --quiet
fi
printf '%s\n' 'COMPOSE_CONFIG_CHECK=passed' 'STAGING_VERIFIED=yes' \
  'FILES_CHANGED=no' 'SERVICE_START_PERFORMED=no' 'IMAP_AUTHENTICATION_TESTED=no' \
  'TOKEN_VALUES_PRINTED=no'
