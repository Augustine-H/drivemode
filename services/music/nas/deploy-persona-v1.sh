#!/bin/sh
# One-time DSM task. Preserve the existing compose, secrets, and data.
set -eu
umask 077
cd /volume1/docker/voice-grok-music
exec > persona-v1-deploy.log 2>&1
archive=/volume1/docker/voice-grok-music-persona-v1.zip
expected=a335995baa9e5423bc61bf99eb93ef5052feaeae964dff269358d5fd89b49c7a
test -f "$archive"
test "$(sha256sum "$archive" | awk '{print $1}')" = "$expected"
test -f nas/compose.yaml
stage=$(mktemp -d /volume1/docker/voice-grok-music/persona-stage.XXXXXX)
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$archive" -d "$stage"
else
  7z x -y "-o$stage" "$archive"
fi
backup=persona-backup-$(date +%Y%m%d-%H%M%S)
mkdir "$backup"
for name in api_common.py nas_store.py nas_api.py; do
  test -f "$name"
  test -f "$stage/voice-grok-music/$name"
  cp -p "$name" "$backup/$name"
done
cp -p nas/compose.yaml "$backup/compose.yaml"
for name in api_common.py nas_store.py nas_api.py; do
  cp "$stage/voice-grok-music/$name" "$name"
done
DOCKER=/usr/local/bin/docker
compose() {
  if "$DOCKER" compose version >/dev/null 2>&1; then
    "$DOCKER" compose -p voice-grok-music -f nas/compose.yaml "$@"
  else
    /var/packages/ContainerManager/target/usr/bin/docker-compose -p voice-grok-music -f nas/compose.yaml "$@"
  fi
}
compose build music-service
compose up -d --no-deps --force-recreate music-service
"$DOCKER" ps --filter label=com.docker.compose.project=voice-grok-music --format '{{.Names}} {{.Image}} {{.Status}}'
printf 'PERSONA_API_DEPLOY_APPLIED backup=%s\n' "$backup"
