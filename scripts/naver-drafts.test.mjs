import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NaverMail, NaverCredentialStore, NaverError, naverIdentity } from '../src/lib/naver-mail.server.ts';
import { naverDraftFromSource, syncNaverDraftWithClient } from '../src/lib/naver-mail-transport.server.ts';
import { naverDraftSchema, NAVER_ATTACHMENT_LIMIT } from '../src/lib/naver-mail-contract.ts';
import { naverChat } from '../src/lib/naver-mail-chat.server.ts';
const account={email:'test@naver.com',password:'test-password',generation:'g'};
const draft={to:'test@naver.com',subject:'draft test',text:'private test body',attachments:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=uid=>Buffer.from(JSON.stringify({mailbox:'Drafts',validity:'3',uid,generation:'g'})).toString('base64url');
const source=(bytes=Buffer.from([0,255,128,13,10]),extra='')=>Buffer.from(`To: test@naver.com\r\nSubject: draft test\r\n${extra}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nbody\r\n--test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="test.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytes.toString('base64')}\r\n--test--\r\n`);
function imap(){
  const original=source(),rows=new Map([[7,original]]),calls=[];
  const client={mailbox:{uidValidity:3n},capabilities:new Set(['UIDPLUS']),
    list:async()=>[{path:'Drafts',specialUse:'\\Drafts',flags:new Set()},{path:'Trash',specialUse:'\\Trash',flags:new Set()}],
    getMailboxLock:async(path,options)=>{calls.push(['lock',path,options]);return {release(){calls.push(['release']);}}},
    fetchOne:async(uid,query,options)=>{assert.equal(options.uid,true);const raw=rows.get(Number(uid));return raw?(query.size?{size:raw.length}:{source:raw}):false;},
    append:async(path,raw,flags)=>{calls.push(['append',path,flags]);rows.set(8,raw);return {uid:8,uidValidity:3n};},
    messageMove:async(uid,path,options)=>{calls.push(['move',uid,path,options]);rows.delete(Number(uid));return {uidMap:new Map()};}};
  return {client,rows,calls,previous:{id:identity(7),fingerprint:hash(original)}};
}
test('forward preserves binary attachments, explicit exclusion, and imported recipients',async()=>{
  const bytes=Buffer.from([0,255,128,13,10]);
  const forward=await naverDraftFromSource(source(bytes),true);
  assert.equal(forward.to,'');assert.equal(forward.subject,'Fwd: draft test');
  assert.deepEqual(Buffer.from(forward.attachments[0].data,'base64'),bytes);
  assert.equal((await naverDraftFromSource(source(),true,false)).attachments.length,0);
  assert.equal((await naverDraftFromSource(source())).to,account.email);
  assert.equal((await naverDraftFromSource(source(bytes,'Cc: cc@example.com\r\n'))).cc,'cc@example.com');
});
test('attachment limit accepts 4MB and exact 10MB, rejects over-limit totals and malformed base64',()=>{
  const file=bytes=>({name:'test.bin',mimeType:'application/octet-stream',data:Buffer.alloc(bytes).toString('base64')});
  for(const length of [4*1024*1024,NAVER_ATTACHMENT_LIMIT])assert.equal(naverDraftSchema.safeParse({...draft,attachments:[file(length)]}).success,true);
  assert.equal(naverDraftSchema.safeParse({...draft,attachments:[file(NAVER_ATTACHMENT_LIMIT+1)]}).success,false);
  assert.equal(naverDraftSchema.safeParse({...draft,attachments:[file(6000000),file(4000001)]}).success,false);
  assert.equal(naverDraftSchema.safeParse({...draft,attachments:[{...file(1),data:'YQ='}]}).success,false);
});
test('encrypted draft survives service restart and cache expiry, isolates owners and rejects substitution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voicegrok-draft-'));
  try{
    const store=new NaverCredentialStore(dir);await store.write(account);
    const mail=new NaverMail(store,{});await mail.saveDraft('a',draft);
    const restarted=new NaverMail(new NaverCredentialStore(dir),{});
    assert.deepEqual(await restarted.draft('a'),draft);assert.equal(await restarted.draft('b'),null);
    const originalClock=Date.now;Date.now=()=>originalClock()+3600001;
    try{assert.deepEqual(await restarted.draft('a'),draft);}finally{Date.now=originalClock;}
    const filename=(await readdir(dir)).find(p=>/^draft-.*\.enc$/.test(p));const bytes=await readFile(join(dir,filename));
    assert.equal(bytes.includes(Buffer.from(draft.text)),false);
    const other=`draft-${hash(Buffer.from('b'))}.enc`;await writeFile(join(dir,other),bytes);
    await assert.rejects(store.readDraft('b'));
    await store.write(null);assert.equal(await store.readDraft('a'),null);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('IMAP sync appends flagged MIME before moving only the previous verified UID',async()=>{
  const f=imap();const result=await syncNaverDraftWithClient(f.client,account,draft,f.previous);
  assert.equal(result.previousArchived,true);assert.equal(naverIdentity(result.sync.id,'g').uid,8);
  assert.equal(result.sync.fingerprint,hash(f.rows.get(8)));
  assert.deepEqual(f.calls.filter(c=>c[0]==='append')[0],['append','Drafts',['\\Draft','\\Seen']]);
  assert.deepEqual(f.calls.filter(c=>c[0]==='move')[0],['move','7','Trash',{uid:true}]);
  assert.ok(f.calls.findIndex(c=>c[0]==='append')<f.calls.findIndex(c=>c[0]==='move'));
  assert.deepEqual(f.calls.at(-1),['release']);
});
test('changed or removed previous drafts and missing UIDPLUS cause no append or move',async()=>{
  for(const mode of ['changed','removed','validity','capability']){
    const f=imap();if(mode==='changed')f.rows.set(7,Buffer.from('changed'));if(mode==='removed')f.rows.delete(7);if(mode==='validity')f.client.mailbox.uidValidity=4n;if(mode==='capability')f.client.capabilities.clear();
    await assert.rejects(syncNaverDraftWithClient(f.client,account,draft,f.previous),e=>['draft_conflict','drafts'].includes(e.code));
    assert.equal(f.calls.some(c=>c[0]==='append'||c[0]==='move'),false);
  }
});
test('append ambiguity never moves previous; a post-append conflict preserves both versions',async()=>{
  const fail=imap();fail.client.append=async()=>{throw Error('connection lost');};
  await assert.rejects(syncNaverDraftWithClient(fail.client,account,draft,fail.previous),e=>e.code==='draft_uncertain');assert.equal(fail.rows.has(7),true);
  const race=imap(),append=race.client.append;race.client.append=async(...args)=>{const result=await append(...args);race.rows.set(7,Buffer.from('externally edited'));return result;};
  const result=await syncNaverDraftWithClient(race.client,account,draft,race.previous);assert.equal(result.previousArchived,false);assert.equal(race.rows.size,2);assert.equal(race.calls.some(c=>c[0]==='move'),false);
});
test('sync confirmation is owner-bound, one-use, and retains app draft on uncertain results',async()=>{
  let calls=0;const adapter={syncDraft:async()=>{calls++;throw Error('lost');}};
  const client=new NaverMail({read:async()=>account,write:async()=>{}},adapter);await client.saveDraft('a',draft);
  const proposal=await client.propose('a',{operation:'syncDraft',draft});assert.equal(calls,0);
  await assert.rejects(client.execute('b',proposal.id));assert.equal(calls,0);
  await assert.rejects(client.execute('a',proposal.id),e=>e.code==='draft_uncertain');
  await assert.rejects(client.execute('a',proposal.id));assert.equal(calls,1);assert.deepEqual(await client.draft('a'),draft);
});
test('loaded draft revision is preserved across edits and archived only after accepted SMTP',async()=>{
  const previous={id:identity(7),fingerprint:'original'};let archived=0,seen;
  const adapter={loadDraft:async()=>({draft,sync:previous}),syncDraft:async(_c,_d,sync)=>{seen=sync;return {sync:{id:identity(8),fingerprint:'new'},previousArchived:true};},archiveDraft:async()=>{archived++;},send:async()=>({messageId:'test',accepted:1,rejected:0})};
  const client=new NaverMail({read:async()=>account,write:async()=>{}},adapter);
  await client.loadDraft('a',identity(7));await client.saveDraft('a',{...draft,text:'updated'});
  const p=await client.propose('a',{operation:'syncDraft',draft:{...draft,text:'updated'}});await client.execute('a',p.id);assert.deepEqual(seen,previous);
  const failed=await client.propose('a',{operation:'send',draft});adapter.send=async()=>{throw Error('lost');};await assert.rejects(client.execute('a',failed.id));assert.equal(archived,0);assert.ok(await client.draft('a'));
  adapter.send=async()=>({accepted:1,rejected:0,messageId:'sent'});const good=await client.propose('a',{operation:'send',draft});await client.execute('a',good.id);assert.equal(archived,1);assert.equal(await client.draft('a'),null);
});
test('voice editing retains existing attachment bytes',async()=>{
  const client=new NaverMail({read:async()=>account,write:async()=>{}},{});const withFile={...draft,attachments:[{name:'test.bin',mimeType:'application/octet-stream',data:'AP8='}]};await client.saveDraft('a',withFile);
  const old=process.env.XAI_API_KEY;process.env.XAI_API_KEY='test';
  try{const result=await naverChat(client,'a',{message:'초안 수정해줘'},async()=>Response.json({output:[{type:'function_call',name:'naver_request',arguments:JSON.stringify({operation:'draft',text:'changed'})}]}));assert.deepEqual(result.draft.attachments,withFile.attachments);}
  finally{if(old===undefined)delete process.env.XAI_API_KEY;else process.env.XAI_API_KEY=old;}
});
