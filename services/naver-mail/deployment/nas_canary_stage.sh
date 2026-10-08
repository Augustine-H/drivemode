#!/bin/sh
# Fresh synthetic-only OAuth project. Run once from an interactive SSH terminal.
set -eu
umask 077
nas_canary_fail() { printf 'CANARY_STAGING_FAILED=%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] && [ -t 0 ] && [ -t 2 ] || nas_canary_fail interactive_root_terminal_required
printf '%s\n' "${NAS_CANARY_BUNDLE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}$' || nas_canary_fail trusted_bundle_hash_required
[ -n "${NAS_CANARY_ISSUER:-}" ] || nas_canary_fail issuer_required
nas_canary_release=/volume1/docker/voice-grok-naver-mail-release
nas_canary_project=/volume1/docker/voice-grok-naver-mail-canary
nas_canary_network=voice-grok-naver-canary
nas_canary_image=voice-grok-naver-mail:1.0.0
[ -d "$nas_canary_release" ] && [ ! -L "$nas_canary_release" ] || nas_canary_fail release_directory_missing
[ ! -e "$nas_canary_project" ] && [ ! -L "$nas_canary_project" ] || nas_canary_fail existing_project_preserved
[ -f "$nas_canary_release/naver-mail-oauth-canary.tar.gz" ] && [ ! -L "$nas_canary_release/naver-mail-oauth-canary.tar.gz" ] || nas_canary_fail bundle_missing
printf '%s  %s\n' "$NAS_CANARY_BUNDLE_SHA256" "$nas_canary_release/naver-mail-oauth-canary.tar.gz" | sha256sum -c -
nas_canary_docker=$(command -v docker 2>/dev/null || true)
if [ -z "$nas_canary_docker" ]; then
  for nas_canary_candidate in /usr/local/bin/docker /var/packages/ContainerManager/target/usr/bin/docker /var/packages/Docker/target/usr/bin/docker; do
    if [ -x "$nas_canary_candidate" ]; then nas_canary_docker="$nas_canary_candidate"; break; fi
  done
fi
[ -n "$nas_canary_docker" ] || nas_canary_fail docker_missing
[ "$("$nas_canary_docker" image inspect "$nas_canary_image" --format '{{.Id}}')" = sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3 ] || nas_canary_fail image_identity_mismatch
nas_canary_compose_kind=plugin
nas_canary_compose_bin=''
if ! "$nas_canary_docker" compose version >/dev/null 2>&1; then
  nas_canary_compose_kind=standalone
  nas_canary_compose_bin=$(command -v docker-compose 2>/dev/null || true)
  [ -n "$nas_canary_compose_bin" ] || nas_canary_fail compose_missing
fi
nas_canary_compose() {
  if [ "$nas_canary_compose_kind" = plugin ]; then "$nas_canary_docker" compose "$@";
  else "$nas_canary_compose_bin" "$@"; fi
}
if "$nas_canary_docker" network inspect "$nas_canary_network" >/dev/null 2>&1; then
  nas_canary_fail existing_canary_network_preserved
fi
"$nas_canary_docker" run --rm --network=host --read-only --user 10001:10001 \
  --cap-drop=ALL --security-opt=no-new-privileges:true --entrypoint python "$nas_canary_image" -c '
import socket,sys,urllib.parse
url=urllib.parse.urlsplit(sys.argv[1])
if url.scheme!="https" or url.port!=8446 or not url.hostname or url.path or url.query or url.fragment or url.username:
    raise SystemExit("Expected an HTTPS origin on candidate port 8446")
for address,port in [("127.0.0.1",13002),("0.0.0.0",8446)]:
    with socket.socket() as s: s.bind((address,port))
print("CANARY_CANDIDATE_PORTS=available")
' "$NAS_CANARY_ISSUER"
mkdir -m 0750 "$nas_canary_project"
tar -xzf "$nas_canary_release/naver-mail-oauth-canary.tar.gz" -C "$nas_canary_project"
[ -f "$nas_canary_project/compose.yaml" ] && [ -f "$nas_canary_project/setup.py" ] || nas_canary_fail unpacked_bundle_invalid
"$nas_canary_docker" network create --driver bridge --label voice-grok.synthetic-only=true "$nas_canary_network" >/dev/null
nas_canary_gateway=$("$nas_canary_docker" network inspect "$nas_canary_network" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
"$nas_canary_docker" run --rm -it --network=none --read-only --user 0:10001 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -e PYTHONPATH=/code -v "$nas_canary_project:/project" \
  -v "$nas_canary_project/code:/code:ro" \
  -v "$nas_canary_project/setup.py:/setup.py:ro" \
  --entrypoint python "$nas_canary_image" /setup.py \
  --issuer "$NAS_CANARY_ISSUER" --proxy "$nas_canary_gateway"
nas_canary_compose -p voice-grok-naver-canary -f "$nas_canary_project/compose.yaml" config --quiet
nas_canary_compose -p voice-grok-naver-canary -f "$nas_canary_project/compose.yaml" up -d --no-build canary
nas_canary_health() {
  nas_canary_attempt=0
  while [ "$nas_canary_attempt" -lt 30 ]; do
    if nas_canary_compose -p voice-grok-naver-canary -f "$nas_canary_project/compose.yaml" exec -T canary python -m integration.canary_health; then return 0; fi
    nas_canary_attempt=$((nas_canary_attempt+1))
    sleep 1
  done
  nas_canary_fail authenticated_health_failed
}
nas_canary_health
printf '%s\n' 'CANARY_HEALTH_CHECK=passed'
nas_canary_compose -p voice-grok-naver-canary -f "$nas_canary_project/compose.yaml" restart canary
nas_canary_health
printf '%s\n' 'CANARY_RESTART_RECOVERY=passed' 'CANARY_STAGING_COMPLETE=yes' \
  'CANARY_HOST_BIND=127.0.0.1:13002' 'CANDIDATE_HTTPS_PORT=8446' \
  'REAL_MAIL_ACCOUNT_CONNECTED=no' 'PUBLIC_HTTPS_CONFIGURED=no' 'GROK_WEB_VERIFIED=no'
