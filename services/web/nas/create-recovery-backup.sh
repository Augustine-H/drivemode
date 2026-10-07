#!/bin/sh
# Run once as DSM root. Services remain running. No credentials enter logs.
set -eu
umask 077
BASE=/volume1/docker/voice-grok-web/private/recovery
CODE=/volume1/docker/voice-grok-web
DOCKER=/usr/local/bin/docker
WEB=$($DOCKER ps -q --filter label=com.docker.compose.project=voice-grok-web --filter label=com.docker.compose.service=web)
test -n "$WEB"
test "$(printf '%s\n' "$WEB" | wc -l | tr -d ' ')" = 1
KEY=$BASE/recovery-key.txt
test -s "$KEY"
mkdir -p "$BASE"
chmod 700 "$BASE"
chmod 600 "$KEY"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d "$BASE/.snapshot.XXXXXX")
SNAP=/data/voice-grok-recovery-$STAMP.sqlite
SUCCESS=0
cleanup() {
  case "$WORK" in "$BASE"/.snapshot.*) rm -rf -- "$WORK" ;; esac
  "$DOCKER" exec voice-grok-tts-tts-1 node -e 'const f=require("node:fs");const p=process.argv[1];if(/^\/data\/voice-grok-recovery-\d{8}T\d{6}Z\.sqlite$/.test(p))for(const s of ["","-wal","-shm"])f.rmSync(p+s,{force:true});' "$SNAP" || true
  if test "$SUCCESS" = 1; then rm -f -- "$KEY"; fi
}
trap cleanup EXIT HUP INT TERM
mkdir "$WORK/web" "$WORK/tts" "$WORK/network"
"$DOCKER" exec voice-grok-tts-tts-1 node -e 'const{DatabaseSync,backup}=require("node:sqlite");const f=require("node:fs");const p=process.argv[1];if(f.existsSync(p))throw Error("Snapshot already exists");const db=new DatabaseSync("/data/usage.sqlite",{readOnly:true});backup(db,p).then(()=>{db.close();const copy=new DatabaseSync(p,{readOnly:true});if(copy.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("Snapshot integrity failed");copy.close();f.chmodSync(p,0o600);}).catch(()=>{console.error("SQLite backup failed");process.exitCode=1;});' "$SNAP"
"$DOCKER" cp "voice-grok-tts-tts-1:$SNAP" "$WORK/tts/usage.sqlite"
"$DOCKER" cp voice-grok-tts-tts-1:/data/adc.json "$WORK/tts/adc.json"
"$DOCKER" cp voice-grok-tts-tts-1:/data/backend-token "$WORK/tts/backend-token"
"$DOCKER" cp "$WEB:/run/config/runtime.json" "$WORK/web/runtime.json"
cp "$CODE/compose.yaml" "$CODE/start.mjs" "$CODE/enable-private-https.sh" "$WORK/web/"
if test -f /volume1/docker/voice-grok-tts/compose.nas.yaml; then
  cp /volume1/docker/voice-grok-tts/compose.nas.yaml "$WORK/tts/compose.nas.yaml"
else
  cp /volume1/docker/voice-grok-tts/compose.yaml "$WORK/tts/compose.nas.yaml"
fi
cp /volume1/docker/voice-grok-tts/enable-private-https.sh "$WORK/tts/enable-private-https.sh"
/var/packages/Tailscale/target/bin/tailscale serve status --json > "$WORK/network/serve.json"
printf '%s\n' 'set -eu' '/var/packages/Tailscale/target/bin/tailscale configure-host' 'synosystemctl restart pkgctl-Tailscale.service' > "$WORK/network/boot-recovery.sh"
if test -f /var/packages/Tailscale/var/tailscaled.state; then
  cp /var/packages/Tailscale/var/tailscaled.state "$WORK/network/tailscaled.state"
fi
printf '{"format":"VoiceGrokRecovery-v1","createdUtc":"%s","database":"SQLite online backup","servicesStopped":false}\n' "$STAMP" > "$WORK/manifest.json"
tar -czf "$WORK/snapshot.tar.gz" -C "$WORK" web tts network manifest.json
OUT=$BASE/voice-grok-recovery-$STAMP.vgrec
# The key is transmitted through stdin, never command arguments or environment.
{ tr -d '\r\n' < "$KEY"; printf '\n'; cat "$WORK/snapshot.tar.gz"; } | "$DOCKER" exec -i "$WEB" node --input-type=module -e "$(cat "$CODE/recovery-encrypt.mjs")" > "$OUT.partial"
test -s "$OUT.partial"
mv "$OUT.partial" "$OUT"
chmod 600 "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
SUCCESS=1
printf 'Encrypted recovery backup completed: %s\n' "$OUT"
