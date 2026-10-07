// Usage: node backup-pc.mjs DATA_DIRECTORY RECOVERY_KEY OUTPUT_DIRECTORY
// The key and credential contents are never printed. SQLite is copied online.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const [data, keyFile, output] = process.argv.slice(2);
if (!data || !keyFile || !output) throw Error('Data, key and output paths required');
const keyText = fs.readFileSync(keyFile, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(keyText)) throw Error('Invalid recovery key');
fs.mkdirSync(output, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const snapshot = path.join(output, `.sqlite-${randomBytes(8).toString('hex')}`);
const entries = [];
const add = (name, bytes) => entries.push({ name, bytes: Buffer.from(bytes) });
function tarEntry({ name, bytes }) {
  const header = Buffer.alloc(512);
  header.write(name); header.write('0000600\0',100); header.write('0000000\0',108); header.write('0000000\0',116);
  header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);
  header.write(Math.floor(Date.now()/1000).toString(8).padStart(11,'0')+'\0',136);
  header.fill(32,148,156); header.write('0',156); header.write('ustar\0',257); header.write('00',263);
  header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512)]);
}
try {
  const db = new DatabaseSync(path.join(data,'usage.sqlite'), { readOnly:true });
  try { await backup(db,snapshot); } finally { db.close(); }
  const copy = new DatabaseSync(snapshot,{readOnly:true});
  try { if(copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('SQLite integrity failed'); } finally { copy.close(); }
  for(const file of ['backend-token','backend-config.json','google-adc.json']) add(`pc/${file}`,fs.readFileSync(path.join(data,file)));
  add('pc/usage.sqlite',fs.readFileSync(snapshot));
  for(const file of ['supervise-pc.ps1','launch-pc-supervisor.py']) add(`pc/autostart/${file}`,fs.readFileSync(path.join(data,'Autostart',file)));
  add('pc/autostart/task.xml',execFileSync('powershell.exe',['-NoProfile','-Command',"Export-ScheduledTask -TaskName 'VoiceGrok TTS - Logon'"],{windowsHide:true}));
  add('pc/network/serve.json',execFileSync('C:/Program Files/Tailscale/tailscale.exe',['serve','status','--json'],{windowsHide:true}));
  add('manifest.json',JSON.stringify({format:'VoiceGrokRecovery-v1',scope:'PC TTS',createdUtc:new Date().toISOString(),database:'SQLite online backup',servicesStopped:false,dataDirectory:path.resolve(data),webPort:8097}));
  const tar = Buffer.concat([...entries.map(tarEntry),Buffer.alloc(1024)]), payload=gzipSync(tar);
  const key=Buffer.from(keyText,'hex'), iv=randomBytes(12), aad=Buffer.from('VoiceGrokRecovery-v1');
  const cipher=createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);
  const archive={format:'VoiceGrokRecovery-v1',algorithm:'AES-256-GCM',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  const out=path.join(output,`voice-grok-pc-recovery-${stamp}.vgrec`);
  fs.writeFileSync(out,JSON.stringify(archive),{flag:'wx'});
  const saved=JSON.parse(fs.readFileSync(out,'utf8'));
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(saved.iv,'base64')); decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
  const restored=gunzipSync(Buffer.concat([decipher.update(Buffer.from(saved.ciphertext,'base64')),decipher.final()]));
  if(!restored.equals(tar)) throw Error('Encrypted archive round trip failed');
  const hash=createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  fs.writeFileSync(out+'.sha256',`${hash}  ${path.basename(out)}\n`);
  const report={passed:true,archive:path.basename(out),sha256:hash,sqliteIntegrity:'ok',authenticatedDecryption:true,files:entries.map(e=>e.name),plaintextSnapshotRemoved:true};
  fs.writeFileSync(out+'.verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { for(const suffix of ['','-wal','-shm']) fs.rmSync(snapshot+suffix,{force:true}); }
