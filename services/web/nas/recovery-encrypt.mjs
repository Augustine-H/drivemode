// stdin: a 64-character hexadecimal recovery key, newline, then a gzip tar.
import { createCipheriv, randomBytes } from 'node:crypto';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const input=Buffer.concat(chunks), end=input.indexOf(10);
const keyText=input.subarray(0,end).toString('ascii').trim();
if(end<0 || !/^[a-f0-9]{64}$/.test(keyText)) throw new Error('Invalid recovery key');
const payload=input.subarray(end+1);
if(payload.length<32 || payload[0]!==31 || payload[1]!==139) throw new Error('Expected gzip archive');
const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(keyText,'hex'),iv);
const aad=Buffer.from('VoiceGrokRecovery-v1'); cipher.setAAD(aad);
const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
process.stdout.write(JSON.stringify({format:'VoiceGrokRecovery-v1',algorithm:'AES-256-GCM',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
