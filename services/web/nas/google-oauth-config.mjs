// Optional private NAS environment export. Never prints credential values.
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const callback='https://ds218-hmh.tail15dbbb.ts.net:8445/api/google-workspace/callback';
try {
 const path=process.argv[2];if(!path)throw new Error('missing');
 const client=JSON.parse(await readFile(path,'utf8')).web;
 if(!client?.client_id || !client?.client_secret || !client.redirect_uris?.includes(callback))throw new Error('invalid');
 if(!/^[A-Za-z0-9._-]+$/.test(client.client_id) || !/^[A-Za-z0-9._-]+$/.test(client.client_secret))throw new Error('format');
 if(process.argv[3]==='--output') {
   if(!process.argv[4] || !isAbsolute(process.argv[4]))throw new Error('output');
   const target=resolve(process.argv[4]),workspace=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
   const rel=relative(workspace,target);if(!rel || (!rel.startsWith('..') && !isAbsolute(rel)))throw new Error('workspace');
   await writeFile(target,`GOOGLE_CLIENT_ID=${client.client_id}\nGOOGLE_CLIENT_SECRET=${client.client_secret}\n`,{flag:'wx',mode:0o600});
   await chmod(target,0o600);
   console.log('Private environment file created. Credential values were not printed.');
 } else {
   if(process.argv[3])throw new Error('option');
   console.log('Client JSON validated. Required server variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. No credentials were printed or written.');
 }
} catch {console.error('Client JSON validation failed. Check web-client type and the exact registered callback URI.');process.exitCode=1;}
