#!/bin/sh
# One-time NAS staging only: import verified image, unpack source, make tokens.
# No container/service start, IMAP connection, proxy or existing service changes.
set -eu
umask 077
fail() { printf 'STAGING_FAILED=%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail requires_root
for nas_stage_digest in "${NAS_RELEASE_SOURCE_SHA256:-}" "${NAS_RELEASE_IMAGE_SHA256:-}"; do
  printf '%s\n' "$nas_stage_digest" | grep -Eq '^[a-f0-9]{64}$' || fail trusted_archive_hashes_required
done
nas_stage_release=/volume1/docker/voice-grok-naver-mail-release
nas_stage_project=/volume1/docker/voice-grok-naver-mail
nas_stage_image=voice-grok-naver-mail:1.0.0
nas_stage_expected_id=sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3
[ -d "$nas_stage_release" ] && [ ! -L "$nas_stage_release" ] || fail release_directory_missing
[ ! -e "$nas_stage_project" ] && [ ! -L "$nas_stage_project" ] || fail project_directory_already_exists
cd "$nas_stage_release"
for nas_stage_archive in naver-mail-source.tar.gz naver-mail-image.tar.gz; do
  [ -f "$nas_stage_archive" ] && [ ! -L "$nas_stage_archive" ] || fail archive_missing
done
printf '%s  %s\n' "$NAS_RELEASE_SOURCE_SHA256" naver-mail-source.tar.gz | sha256sum -c -
printf '%s  %s\n' "$NAS_RELEASE_IMAGE_SHA256" naver-mail-image.tar.gz | sha256sum -c -
nas_stage_docker=$(command -v docker 2>/dev/null || true)
if [ -z "$nas_stage_docker" ]; then
  for nas_stage_candidate in /usr/local/bin/docker /var/packages/ContainerManager/target/usr/bin/docker /var/packages/Docker/target/usr/bin/docker; do
    if [ -x "$nas_stage_candidate" ]; then nas_stage_docker="$nas_stage_candidate"; break; fi
  done
fi
[ -n "$nas_stage_docker" ] || fail docker_cli_missing
"$nas_stage_docker" info --format '{{.ServerVersion}}' >/dev/null 2>&1 || fail docker_server_unavailable
nas_stage_compose_kind=plugin
nas_stage_compose_bin=''
if ! "$nas_stage_docker" compose version >/dev/null 2>&1; then
  nas_stage_compose_kind=standalone
  nas_stage_compose_bin=$(command -v docker-compose 2>/dev/null || true)
  [ -n "$nas_stage_compose_bin" ] || fail compose_missing
  "$nas_stage_compose_bin" version >/dev/null 2>&1 || fail compose_unavailable
fi
nas_stage_compose() {
  if [ "$nas_stage_compose_kind" = plugin ]; then "$nas_stage_docker" compose "$@";
  else "$nas_stage_compose_bin" "$@"; fi
}
nas_stage_existing_id=$("$nas_stage_docker" image inspect "$nas_stage_image" --format '{{.Id}}' 2>/dev/null || true)
[ -z "$nas_stage_existing_id" ] || [ "$nas_stage_existing_id" = "$nas_stage_expected_id" ] || fail conflicting_image_tag
"$nas_stage_docker" load -i naver-mail-image.tar.gz
[ "$("$nas_stage_docker" image inspect "$nas_stage_image" --format '{{.Id}}')" = "$nas_stage_expected_id" ] || fail image_identity_mismatch
mkdir -m 0750 "$nas_stage_project"
tar -xzf naver-mail-source.tar.gz -C "$nas_stage_project"
nas_stage_service="$nas_stage_project/services/naver-mail"
[ -f "$nas_stage_service/compose.yaml" ] || fail unpacked_source_missing
mkdir -m 0700 "$nas_stage_service/private"
mkdir -m 0750 "$nas_stage_service/private/server"
mkdir -m 0700 "$nas_stage_service/private/clients"
# Only public configuration is written here. IMAP credentials stay absent.
"$nas_stage_docker" run --rm --network=none --read-only --user 0:0 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -v "$nas_stage_service:/project" --entrypoint python "$nas_stage_image" -c '
import json,pathlib
root=pathlib.Path("/project")
source=(root/"compose.yaml").read_text()
mapping="127.0.0.1:${NAVER_MAIL_HOST_PORT:-3001}:3001"
if source.count(mapping)!=1: raise SystemExit("Unexpected Compose template")
(root/"compose.nas.yaml").write_text(source.replace(mapping,"127.0.0.1:13001:3001"))
config=json.loads((root/"config.example.json").read_text())
config["allowed_hosts"]=["127.0.0.1:3001","localhost:3001","127.0.0.1:13001"]
config["trusted_proxies"]=[]
config["web_auth_verified"]=False
(root/"private/server/config.json").write_text(json.dumps(config,indent=2)+"\n")
'
nas_stage_make_token() {
  "$nas_stage_docker" run --rm --network=none --read-only --user 0:0 \
    --cap-drop=ALL --security-opt=no-new-privileges:true \
    -v "$nas_stage_service/private:/private" --entrypoint python "$nas_stage_image" \
    -m naver_mail.manage_tokens add --registry /private/server/tokens.json \
    --id "$1" --client "$2" --output "$3"
}
nas_stage_make_token voice-v1 voice /private/clients/voice-v1
nas_stage_make_token health-v1 voice /private/server/health-token
nas_stage_make_token web-v1 grok_web /private/clients/web-v1
chgrp 10001 "$nas_stage_service/private/server" "$nas_stage_service/private/server/config.json" \
  "$nas_stage_service/private/server/tokens.json" "$nas_stage_service/private/server/health-token"
chmod 0750 "$nas_stage_service/private/server"
chmod 0440 "$nas_stage_service/private/server/config.json" "$nas_stage_service/private/server/tokens.json" \
  "$nas_stage_service/private/server/health-token"
nas_stage_compose -p voice-grok-naver-mail -f "$nas_stage_service/compose.nas.yaml" config --quiet
printf '%s\n' 'STAGING_COMPLETE=yes' 'MCP_HOST_BIND=127.0.0.1:13001' \
  'MCP_CONTAINER_PORT=3001' 'SERVICE_STARTED=no' 'IMAP_CREDENTIALS_CONFIGURED=no' \
  'WEB_AUTH_VERIFIED=false' 'TOKEN_VALUES_PRINTED=no'
