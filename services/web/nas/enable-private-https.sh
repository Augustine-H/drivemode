#!/bin/sh
set -eu
umask 077
cd /volume1/docker/voice-grok-web
exec > private-https-setup.log 2>&1
TS=/var/packages/Tailscale/target/bin/tailscale
"$TS" serve status --json > private-https-before.json
/usr/local/bin/docker exec -i voice-grok-web-web-1 node -e '
let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{
const c=JSON.parse(s);for(const [host,web] of Object.entries(c.Web||{})){
if(host.endsWith(":8445") && !["http://127.0.0.1:8096","http://127.0.0.1:8097"].includes(web.Handlers?.["/"]?.Proxy)){
console.error("EXISTING_PORT_8445_NOT_CHANGED");process.exit(1);}}
});' < private-https-before.json
"$TS" serve --bg --https=8445 http://127.0.0.1:8097
"$TS" serve status --json > private-https-after.json
printf 'Voice Grok web private HTTPS ready.\n'
