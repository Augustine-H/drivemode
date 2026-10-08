#!/bin/sh
# New validation-only project. Interactive root SSH, never DSM scheduler.
set -eu
umask 077
fail() { printf 'OAUTH_STAGING_FAILED=%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] && [ -t 0 ] && [ -t 2 ] || fail interactive_root_terminal_required
printf '%s\n' "${NAS_OAUTH_BUNDLE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}$' || fail pinned_hash_required
[ -n "${NAS_OAUTH_ISSUER:-}" ] || fail issuer_required
oauth_release=/volume1/docker/voice-grok-naver-mail-release
oauth_project=/volume1/docker/voice-grok-naver-mail-oauth
oauth_network=voice-grok-naver-oauth
oauth_image=voice-grok-naver-mail:1.0.0
[ -d "$oauth_release" ] && [ ! -L "$oauth_release" ] || fail release_directory_missing
[ ! -e "$oauth_project" ] && [ ! -L "$oauth_project" ] || fail existing_project_preserved
[ -f "$oauth_release/naver-mail-oauth-runtime.tar.gz" ] && [ ! -L "$oauth_release/naver-mail-oauth-runtime.tar.gz" ] || fail bundle_missing
printf '%s  %s\n' "$NAS_OAUTH_BUNDLE_SHA256" "$oauth_release/naver-mail-oauth-runtime.tar.gz" | sha256sum -c -
oauth_docker=$(command -v docker 2>/dev/null || true)
if [ -z "$oauth_docker" ]; then
  for candidate in /usr/local/bin/docker /var/packages/ContainerManager/target/usr/bin/docker /var/packages/Docker/target/usr/bin/docker; do
    if [ -x "$candidate" ]; then oauth_docker="$candidate"; break; fi
  done
fi
[ -n "$oauth_docker" ] || fail docker_missing
[ "$("$oauth_docker" image inspect "$oauth_image" --format '{{.Id}}')" = sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3 ] || fail image_identity_mismatch
oauth_compose_kind=plugin
oauth_compose_bin=''
if ! "$oauth_docker" compose version >/dev/null 2>&1; then
  oauth_compose_kind=standalone
  oauth_compose_bin=$(command -v docker-compose 2>/dev/null || true)
  [ -n "$oauth_compose_bin" ] || fail compose_missing
fi
compose() {
  if [ "$oauth_compose_kind" = plugin ]; then "$oauth_docker" compose "$@";
  else "$oauth_compose_bin" "$@"; fi
}
if "$oauth_docker" network inspect "$oauth_network" >/dev/null 2>&1; then fail existing_network_preserved; fi
"$oauth_docker" run --rm --network=host --read-only --user 10001:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges:true --entrypoint python "$oauth_image" -c '
import socket,sys,urllib.parse
p=urllib.parse.urlsplit(sys.argv[1])
if p.scheme!="https" or not p.hostname or p.username or p.password or p.path or p.query or p.fragment:
    raise SystemExit("Expected a public HTTPS origin")
with socket.socket() as s:s.bind(("127.0.0.1",13003))
print("OAUTH_HOST_PORT=available")
' "$NAS_OAUTH_ISSUER"
mkdir -m 0750 "$oauth_project"
tar -xzf "$oauth_release/naver-mail-oauth-runtime.tar.gz" -C "$oauth_project"
[ -f "$oauth_project/compose.yaml" ] && [ -f "$oauth_project/setup.py" ] || fail public_bundle_invalid
mkdir -m 0700 "$oauth_project/state"
chown 10001:10001 "$oauth_project/state"
"$oauth_docker" network create --driver bridge --label voice-grok.mail-oauth=true "$oauth_network" >/dev/null
oauth_gateway=$("$oauth_docker" network inspect "$oauth_network" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
"$oauth_docker" run --rm -it --network=none --read-only --user 0:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges:true -v "$oauth_project:/project" -v "$oauth_project/setup.py:/setup.py:ro" \
  --entrypoint python "$oauth_image" /setup.py --issuer "$NAS_OAUTH_ISSUER" --proxy "$oauth_gateway"
compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" config --quiet
compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" up -d --no-build mail-oauth
health() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" exec -T mail-oauth python -m naver_mail.oauth_health; then return 0; fi
    attempt=$((attempt+1)); sleep 1
  done
  fail authenticated_health_failed
}
health
printf '%s\n' 'OAUTH_HEALTH_CHECK=passed'
compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" restart mail-oauth
health
printf '%s\n' 'OAUTH_RESTART_RECOVERY=passed' 'OAUTH_STAGING_COMPLETE=yes' 'MODE=validation' \
  'OAUTH_HOST_BIND=127.0.0.1:13003' 'REAL_MAIL_ACCOUNT_CONNECTED=no' 'PROXY_CUTOVER_PERFORMED=no'
