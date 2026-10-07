// Authenticate an archive without extracting credentials. Only the SQLite
// database is briefly written inside an existing restricted private folder.
import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
const [archive,keyFile,privateDirectory]=process.argv.slice(2);
if(!archive||!keyFile||!privateDirectory||!fs.statSync(privateDirectory).isDirectory()) throw Error('Archive, key and existing private directory required');
const saved=JSON.parse(fs.readFileSync(archive,'utf8')), key=fs.readFileSync(keyFile,'utf8').trim();
if(saved.format!=='VoiceGrokRecovery-v1'||saved.algorithm!=='AES-256-GCM'||!/^[a-f0-9]{64}$/.test(key)) throw Error('Unsupported archive/key');
const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(saved.iv,'base64'));d.setAAD(Buffer.from(saved.format));d.setAuthTag(Buffer.from(saved.tag,'base64'));
const tar=gunzipSync(Buffer.concat([d.update(Buffer.from(saved.ciphertext,'base64')),d.final()]));
const files=new Map();
for(let pos=0;pos+512<=tar.length;){
  const h=tar.subarray(pos,pos+512);if(h.every(x=>x===0))break;
  const name=h.subarray(0,100).toString().split('\0')[0], prefix=h.subarray(345,500).toString().split('\0')[0];
  const size=parseInt(h.subarray(124,136).toString().replace(/\0/g,'').trim(),8),type=String.fromCharCode(h[156]);
  if(prefix||name.includes('..')||!(/^(web|tts|network|pc)\/[A-Za-z0-9._/-]*$|^manifest\.json$/).test(name)||!Number.isSafeInteger(size)||size<0||pos+512+size>tar.length||!['0','\0','5'].includes(type))throw Error('Unsafe tar entry');
  if(type!=='5'){if(files.has(name))throw Error('Duplicate entry');files.set(name,tar.subarray(pos+512,pos+512+size));}
  pos+=512+Math.ceil(size/512)*512;
}
const json=name=>JSON.parse(files.get(name).toString('utf8'));
const manifest=json('manifest.json'),isPC=manifest.scope==='PC TTS';
let credentialsConsistent=false;
if(isPC){const adc=json('pc/google-adc.json');json('pc/backend-config.json');credentialsConsistent=!!adc.type&&files.get('pc/backend-token').toString().trim().length>=48;}
else {const runtime=json('web/runtime.json'),adc=json('tts/adc.json'),token=files.get('tts/backend-token').toString().trim();credentialsConsistent=!!runtime.login&&!!runtime.origin&&!!runtime.xaiApiKey&&!!adc.type&&token.length>=48&&runtime.backends?.find(b=>b.id==='nas')?.token===token;}
if(!credentialsConsistent)throw Error('Credentials/configuration inconsistent');
const dbPath=path.join(path.resolve(privateDirectory),`.verify-${randomBytes(12).toString('hex')}.sqlite`);
let usage,settings;
try {
  fs.writeFileSync(dbPath,files.get(isPC?'pc/usage.sqlite':'tts/usage.sqlite'),{flag:'wx',mode:0o600});
  const db=new DatabaseSync(dbPath,{readOnly:true});try{
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity failed');
    usage=db.prepare("SELECT engine,SUM(characters) AS characters FROM requests WHERE state IN ('submitted','success','partial','uncertain') GROUP BY engine").all();
    settings=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,JSON.parse(r.value)]));
  }finally{db.close();}
}finally{for(const suffix of ['','-wal','-shm'])fs.rmSync(dbPath+suffix,{force:true});}
const compose=files.get('web/compose.yaml')?.toString()||'',start=files.get('web/start.mjs')?.toString()||'';
const explicitPort=compose.match(/VOICE_GROK_WEB_PORT:\s*["']?(\d+)/)?.[1];
const web8097=isPC||((explicitPort==='8097'||(!explicitPort&&/NITRO_PORT\s*=.*VOICE_GROK_WEB_PORT.*['"]8097['"]/.test(start)))&&
  /127\.0\.0\.1:8097/.test(files.get('web/enable-private-https.sh')?.toString()||'')&&
  /127\.0\.0\.1:8097/.test(files.get('network/serve.json')?.toString()||''));
console.log(JSON.stringify({passed:credentialsConsistent&&web8097,authenticatedDecryption:true,credentialsConsistent,databaseIntegrity:'ok',web8097,usage,settings,createdUtc:manifest.createdUtc,files:[...files.keys()],sha256:createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),plaintextCredentialsExtracted:false}));
if(!web8097)process.exitCode=1;
