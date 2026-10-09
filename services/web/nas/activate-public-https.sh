#!/bin/sh
# One-time operator-approved activation; no firewall, router, or TLS changes.
set -eu
umask 077
DOCKER=/usr/local/bin/docker
cd /volume1/docker/voice-grok-web
test -f prepare-public-config.mjs
test -f private/runtime.json
test -f /volume1/docker/voice-grok-music/nas/secrets/client_token
test ! -e private/runtime.pre-public-20261009.json
test ! -e private/runtime.public-candidate.json
test ! -e private/pairing-code.txt
"$DOCKER" run --rm --network none --read-only --cap-drop ALL \
  -v /volume1/docker/voice-grok-web:/deployment:ro \
  -v /volume1/docker/voice-grok-web/private:/private \
  -v /volume1/docker/voice-grok-music/nas/secrets:/music:ro \
  node:24-bookworm-slim node /deployment/prepare-public-config.mjs \
  /private/runtime.json https://imhmh.synology.me /music/client_token /private
cp -p private/runtime.json private/runtime.pre-public-20261009.json
cp private/runtime.public-candidate.json private/runtime.json
chmod 600 private/runtime.json private/runtime.public-candidate.json private/pairing-code.txt
if "$DOCKER" compose run --rm config-init && "$DOCKER" compose restart web; then
  echo 'Public authentication configuration installed; private runtime backup retained.'
else
  cp private/runtime.pre-public-20261009.json private/runtime.json
  "$DOCKER" compose run --rm config-init
  "$DOCKER" compose restart web
  echo 'Activation failed; restored previous private configuration.' >&2
  exit 1
fi
echo 'Firewall, router forwarding, certificates, music/TTS data and Tailscale configuration were not changed.'
