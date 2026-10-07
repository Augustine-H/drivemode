import fs from 'node:fs';
import path from 'node:path';
// Run only with files in an access-restricted private directory; prints no credentials.
const [clientFile,runtimeFile]=process.argv.slice(2);
if(!clientFile || !runtimeFile) throw new Error('Provide OAuth client JSON and private runtime JSON paths.');
const client=JSON.parse(fs.readFileSync(clientFile,'utf8')).web;
const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
const callback=new URL('/api/google-workspace/callback',runtime.origin).href;
if(!client || typeof client.client_id!=='string' || typeof client.client_secret!=='string' || !client.redirect_uris?.includes(callback)) throw new Error('Web OAuth client or registered callback is invalid.');
runtime.googleOAuth={clientId:client.client_id,clientSecret:client.client_secret};
const temporary=path.join(path.dirname(runtimeFile),`runtime-google-${process.pid}.tmp`);
fs.writeFileSync(temporary,JSON.stringify(runtime,null,2),{mode:0o600,flag:'wx'});
fs.renameSync(temporary,runtimeFile);
console.log('Private Google OAuth configuration saved. Recreate config-init and web.');
