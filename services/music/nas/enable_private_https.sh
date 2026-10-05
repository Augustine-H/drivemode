#!/bin/sh
# Run once on this NAS after HTTPS certificate consent; no automatic schedule.
# An existing Serve configuration causes a stop, never an overwrite.
set -eu
umask 022
cd /volume1/docker/voice-grok-music/nas
exec > https-setup.log 2>&1
TS=/var/packages/Tailscale/target/bin/tailscale
test -x "$TS"
"$TS" serve status --json > serve-before.json
/usr/local/bin/docker exec -i voice-grok-music-music-service-1 python -c 'import json,sys; c=json.load(sys.stdin); assert not c, "EXISTING_SERVE_CONFIG_NOT_CHANGED"' < serve-before.json
"$TS" serve --bg --https=8443 http://127.0.0.1:8094
"$TS" serve status --json > serve-after.json
printf "VoiceGrok private HTTPS setup completed.\n"
