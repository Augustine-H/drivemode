#!/bin/sh
# One-time NAS setup. Add a distinct private Serve port; preserve existing music routes.
set -eu
umask 077
cd /volume1/docker/voice-grok-tts
exec > private-https-setup.log 2>&1
TS=/var/packages/Tailscale/target/bin/tailscale
test -x "$TS"
"$TS" serve status --json > private-https-before.json
/usr/local/bin/docker exec -i voice-grok-tts-tts-1 node -e '
let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{
const c=JSON.parse(s);for(const [host,web] of Object.entries(c.Web||{})){
if(host.endsWith(":8444") && web.Handlers?.["/"]?.Proxy!=="http://127.0.0.1:8092"){
console.error("EXISTING_PORT_8444_NOT_CHANGED");process.exit(1);}}
});' < private-https-before.json
"$TS" serve --bg --https=8444 http://127.0.0.1:8092
"$TS" serve status --json > private-https-after.json
printf 'Voice Grok TTS private HTTPS ready.\n'
