import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {GOOGLE_REDIRECT_URI,OAUTH_SCOPES} from '../src/lib/google-workspace-contract.ts';
import {workspaceChat} from '../src/lib/google-workspace-chat.server.ts';
import {streamAsk} from '../src/lib/ask-stream.ts';
import {workspaceConversation,selectWorkspaceContext} from '../src/lib/google-workspace-client.ts';
import { GoogleWorkspace, WorkspaceStore, WORKSPACE_SCOPES, googleWorkspace } from '../src/lib/google-workspace.server.ts';
const config={clientId:'test-client',clientSecret:'test-secret',origin:'https://test.tail.example',directory:''};
function memory(value={}) {return {value,async read(){return structuredClone(this.value);},async write(v){this.value=structuredClone(v);}};}
const response=(body,status=200)=>Response.json(body,{status});
test('OAuth requests exact configured scopes, uses PKCE, consumes state and prevents replay',async()=>{
  const store=memory();let exchanges=0;
  const client=new GoogleWorkspace(config,store,async(url,options)=>{
    exchanges++; assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.ok(options.body.get('code_verifier'));
    return response({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:Object.values(WORKSPACE_SCOPES).join(' ')});
  });
  const url=new URL((await client.connect()).url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.deepEqual(url.searchParams.get('scope').split(' '),OAUTH_SCOPES);
  await assert.rejects(client.callback('code','wrong'),e=>e.code==='state');assert.equal(exchanges,0);
  assert.equal(url.searchParams.get('redirect_uri'),GOOGLE_REDIRECT_URI);const state=url.searchParams.get('state');await client.callback('code',state);
  await assert.rejects(client.callback('code',state),e=>e.code==='state');assert.equal(exchanges,1);
  const status=await client.status();assert.equal(status.connected,true);assert.equal(JSON.stringify(status).includes('refresh'),false);
});
test('denied consent retains existing connection without token exchange',async()=>{
  const store=memory({refreshToken:'old'});const client=new GoogleWorkspace(config,store,()=>{throw new Error('unexpected network');});
  const url=new URL((await client.connect()).url);await client.callback('',url.searchParams.get('state'),true);
  assert.equal(store.value.refreshToken,'old');assert.equal(store.value.pending,undefined);
});
test('scope denial blocks API and invalid refresh clears credentials',async()=>{
  const store=memory({refreshToken:'old',scopes:[WORKSPACE_SCOPES.drive]});let calls=0;
  const client=new GoogleWorkspace(config,store,async()=>{calls++;return response({error:'invalid_grant'},400);});
  await assert.rejects(client.events('primary','',''),e=>e.code==='consent');assert.equal(calls,0);
  await assert.rejects(client.files('', ''),e=>e.code==='invalid_grant');assert.deepEqual(store.value,{});
});
test('all data operations use GET, drive query is escaped, mail body stays plain text',async()=>{
  const store=memory({refreshToken:'refresh',accessToken:'access',expiresAt:Date.now()+3600000,scopes:Object.values(WORKSPACE_SCOPES)});
  const calls=[];const client=new GoogleWorkspace(config,store,async(url,options)=>{calls.push([url,options.method]);
    if(url.includes('format=full'))return response({snippet:'fallback',payload:{parts:[{mimeType:'text/plain',body:{data:Buffer.from('safe text').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<script>bad</script>').toString('base64url')}}]}});
    return response({items:[],files:[],messages:[]});});
  await client.calendars();await client.events('primary','','');await client.files("a' or trashed = true",'');await client.messages('is:unread','');
  assert.equal((await client.message('abcdef')).text,'safe text');
  assert.ok(calls.every(([,method])=>method==='GET'));assert.match(new URL(calls.find(([url])=>url.includes('/drive/v3/files'))[0]).searchParams.get('q'),/a\\' or/);
});
test('store encrypts credentials and authenticates persisted ciphertext',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voice-grok-google-test-'));
  try {const store=new WorkspaceStore(dir);await store.write({refreshToken:'very-secret-token'});
    const data=await readFile(join(dir,'oauth.enc'));assert.equal(data.includes(Buffer.from('very-secret-token')),false);
    assert.equal((await store.read()).refreshToken,'very-secret-token');
    data[data.length-1]^=1;await writeFile(join(dir,'oauth.enc'),data);await assert.rejects(store.read());
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('NAS routes reject anonymous and cross-origin callers before touching tokens',async()=>{
  assert.equal((await googleWorkspace(new Request('https://localhost/api/google-workspace'))).status,403);
  const saved={...process.env};Object.assign(process.env,{VOICE_GROK_PRIVATE_NAS:'true',VOICE_GROK_NAS_LOGIN:'owner',VOICE_GROK_NAS_ORIGIN:config.origin});
  try {const request=new Request(`${config.origin}/api/google-workspace?action=connect`,{method:'POST',headers:{'tailscale-user-login':'owner','x-forwarded-host':'test.tail.example','x-forwarded-proto':'https',origin:'https://evil.example'}});
    assert.equal((await googleWorkspace(request)).status,403);
  } finally {for(const key of ['VOICE_GROK_PRIVATE_NAS','VOICE_GROK_NAS_LOGIN','VOICE_GROK_NAS_ORIGIN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});

const authorized=()=>memory({refreshToken:'refresh',accessToken:'access',expiresAt:Date.now()+3600000,scopes:Object.values(WORKSPACE_SCOPES),generation:'account-1'});
test('expired state, missing refresh and mismatching configured redirect fail safely',async()=>{
  const store=memory();const client=new GoogleWorkspace(config,store,async()=>response({access_token:'access',expires_in:3600,scope:OAUTH_SCOPES.join(' ')}));
  let url=new URL((await client.connect()).url);store.value.pending.expires=0;
  await assert.rejects(client.callback('code',url.searchParams.get('state')),e=>e.code==='state');
  url=new URL((await client.connect()).url);await assert.rejects(client.callback('code',url.searchParams.get('state')),e=>e.code==='missing_refresh');
  assert.equal((await client.status()).connected,false);
  await assert.rejects(new GoogleWorkspace({...config,redirectUri:GOOGLE_REDIRECT_URI+'/'},memory()).connect(),e=>e.code==='redirect_uri_mismatch');
});
test('401 forces exactly one refresh, preserves token, and quota is distinct',async()=>{
  const store=authorized();let api=0,refresh=0;
  const client=new GoogleWorkspace(config,store,async(url,options)=>{
    if(url.includes('/token')){refresh++;assert.equal(options.body.get('grant_type'),'refresh_token');assert.equal(options.body.get('refresh_token'),'refresh');return response({access_token:'new',expires_in:3600});}
    if(++api===1)return response({},401);assert.equal(options.headers.authorization,'Bearer new');return response({files:[]});
  });
  await client.files('','');assert.equal(api,2);assert.equal(refresh,1);assert.equal(store.value.refreshToken,'refresh');
  const limited=new GoogleWorkspace(config,authorized(),async()=>response({error:{errors:[{reason:'rateLimitExceeded'}]}},403));
  await assert.rejects(limited.files('',''),e=>e.code==='quota');
});
test('writes require one-time confirmation and cannot cross account changes',async()=>{
  const store=authorized();let writes=0;
  const client=new GoogleWorkspace(config,store,async(url,options)=>{assert.equal(options.method,'POST');writes++;const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();assert.match(raw,/To: owner@example.com/);return response({id:'abcdef'});});
  const draft=await client.propose({operation:'sendMail',to:'owner@example.com',subject:'한글 제목',text:'본문'});assert.equal(writes,0);
  await client.execute(draft.id);assert.equal(writes,1);await assert.rejects(client.execute(draft.id),e=>e.code==='confirmation');
  const old=await client.propose({operation:'sendMail',to:'owner@example.com',text:'body'});store.value.generation='other';await assert.rejects(client.execute(old.id),e=>e.code==='confirmation');assert.equal(writes,1);
  await assert.rejects(client.propose({operation:'sendMail',to:'a@example.com\r\nBcc:bad@example.com',text:'x'}),e=>e.code==='input');
});
test('revocation failure still removes local tokens and queued changes',async()=>{
  const store=authorized();const client=new GoogleWorkspace(config,store,async()=>{throw new Error('secret raw network detail');});
  const draft=await client.propose({operation:'markMail',id:'abcdef',unread:true});const result=await client.disconnect();
  assert.deepEqual(store.value,{});assert.equal(result.revoked,false);assert.equal(JSON.stringify(result).includes('secret'),false);
  await assert.rejects(client.execute(draft.id));
});
test('disconnect posts token only to Google revoke endpoint and clears account state',async()=>{
  const store=authorized();const client=new GoogleWorkspace(config,store,async(url,options)=>{
    assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.equal(options.method,'POST');assert.equal(options.body.get('token'),'refresh');return new Response(null,{status:200});
  });
  assert.deepEqual(await client.disconnect(),{disconnected:true,revoked:true});assert.deepEqual(store.value,{});assert.equal((await client.status()).connected,false);
});
test('self-test only sends to own address, modifies its new objects and deletes no Gmail',async()=>{
  const calls=[];const client=new GoogleWorkspace(config,authorized(),async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    if(url.endsWith('/profile'))return response({emailAddress:'owner@example.com'});
    if(url.includes('/messages/send')){assert.match(Buffer.from(JSON.parse(options.body).raw,'base64url').toString(),/To: owner@example.com/);return response({id:'abcdef'});}
    if(url.includes('format=full'))return response({id:'abcdef',payload:{parts:[{mimeType:'text/plain',body:{data:Buffer.from('test').toString('base64url')}}]}});
    if(url.includes('/messages?'))return response({messages:[]});
    if(url.includes('/events') && options.method==='POST')return response({id:'event-created-by-test'});
    if(url.includes('/drive/v3/files?fields=id') && options.method==='POST')return response({id:'file-created-by-test'});
    if(url.includes('/files/file-created-by-test?fields'))return response({id:'file-created-by-test',name:'test',mimeType:'text/plain',size:'4'});
    if(url.includes('?alt=media'))return new Response('test');
    return response({items:[],id:'ok'});
  });
  const draft=await client.propose({operation:'selfTest'});assert.equal(calls.length,0);
  const result=await client.execute(draft.id);assert.ok(result.results.every(x=>x.ok),JSON.stringify(result));
  const deleted=calls.filter(x=>x.method==='DELETE');assert.equal(deleted.length,2);assert.ok(deleted.every(x=>x.url.includes('created-by-test')));
  assert.ok(!calls.some(x=>x.url.includes('gmail') && x.method==='DELETE'));
});
test('natural-language read dispatches real API; write only proposes without executing',async()=>{
  const saved=process.env.XAI_API_KEY;process.env.XAI_API_KEY='test-not-real';
  try {
    let writes=0;const client=new GoogleWorkspace(config,authorized(),async(url,options)=>{if(options.method!=='GET')writes++;return response({messages:[]});});
    const planner=(plan)=>async(url,options)=>{assert.equal(url,'https://api.x.ai/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.tools[0].name,'workspace_request');return response({output:[{type:'function_call',name:'workspace_request',arguments:JSON.stringify(plan)}]});};
    const read=await workspaceChat(client,{message:'오늘 온 중요한 메일 알려줘'},planner({operation:'messages',q:'is:important after:2026/10/07'}));assert.equal(read.text,'해당 메일이 없습니다.');
    const draft=await workspaceChat(client,{message:'내일 오후 3시에 일정 추가해줘'},planner({operation:'createEvent',subject:'회의',start:'2026-10-08T15:00:00+09:00',end:'2026-10-08T16:00:00+09:00'}));assert.ok(draft.proposal);assert.equal(writes,0);
    const nullable=await workspaceChat(client,{message:'일정 추가'},planner({operation:'createEvent',id:null,to:null,text:null,name:null,calendarId:null,subject:'회의',start:'2026-10-08T15:00:00+09:00',end:'2026-10-08T16:00:00+09:00'}));assert.ok(nullable.proposal);assert.equal(writes,0);
    const named=await workspaceChat(client,{message:'일정 추가'},planner({operation:'createEvent',calendarId:'primary',name:'회의',start:'2026-10-08T15:00:00+09:00',end:'2026-10-08T16:00:00+09:00'}));assert.match(named.proposal.details,/subject: 회의/);assert.equal(writes,0);
    await assert.rejects(workspaceChat(client,{message:'일정 추가'},planner({operation:'createEvent',subject:null,start:null,end:null})),e=>e.code==='input');
  } finally {if(saved===undefined)delete process.env.XAI_API_KEY;else process.env.XAI_API_KEY=saved;}
});
test('HTTP connect/callback binds browser cookie, preserves return origin and strips code',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voice-grok-http-oauth-')),saved={...process.env},oldFetch=globalThis.fetch;
  const keys=['VOICE_GROK_PRIVATE_NAS','VOICE_GROK_NAS_LOGIN','VOICE_GROK_NAS_ORIGIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_WORKSPACE_DATA_DIR'];
  Object.assign(process.env,{VOICE_GROK_PRIVATE_NAS:'true',VOICE_GROK_NAS_LOGIN:'owner',VOICE_GROK_NAS_ORIGIN:config.origin,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_WORKSPACE_DATA_DIR:dir});
  globalThis.fetch=async(url)=>url.includes('userinfo')?response({email_verified:true,email:'owner@example.com'}):response({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:OAUTH_SCOPES.join(' '),token_type:'Bearer'});
  const headers={'tailscale-user-login':'owner','x-forwarded-host':'test.tail.example','x-forwarded-proto':'https'};
  try {
    const start=await googleWorkspace(new Request(config.origin+'/api/google-workspace/connect?returnOrigin=https%3A%2F%2Fdrivemode.grok.me',{headers}),false,'connect');
    assert.equal(start.status,303);const url=new URL(start.headers.get('location')),state=url.searchParams.get('state');assert.equal(url.searchParams.get('redirect_uri'),GOOGLE_REDIRECT_URI);
    const cookie=start.headers.get('set-cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
    const wrong=await googleWorkspace(new Request(config.origin+`/api/google-workspace/callback?code=private-code&state=${state}`,{headers}),true);
    assert.match(wrong.headers.get('location'),/google=state/);
    const done=await googleWorkspace(new Request(config.origin+`/api/google-workspace/callback?code=private-code&state=${state}`,{headers:{...headers,cookie:cookie.split(';')[0]}}),true);
    assert.equal(done.headers.get('location'),'https://drivemode.grok.me/?google=connected');assert.equal(done.headers.get('location').includes('private-code'),false);
    const status=await googleWorkspace(new Request(config.origin+'/api/google-workspace/status',{headers:{...headers,origin:'https://drivemode.grok.me'}}),false,'status');
    assert.equal(status.headers.get('access-control-allow-origin'),'https://drivemode.grok.me');const body=await status.json();assert.equal(body.connected,true);assert.equal(body.email,'owner@example.com');assert.equal(JSON.stringify(body).includes('private-refresh'),false);
  } finally {globalThis.fetch=oldFetch;for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}await rm(dir,{recursive:true,force:true});}
});
test('selected binary Drive upload remains bounded and requires preview confirmation',async()=>{
  const bytes=Buffer.from([0,255,1,128]);let uploaded;
  const client=new GoogleWorkspace(config,authorized(),async(url,options)=>{
    if(url.includes('/upload/')){uploaded=Buffer.from(await options.body.arrayBuffer());return response({id:'new-file'});}
    return response({id:'new-file'});
  });
  const draft=await client.propose({operation:'createFile',name:'selected.bin',data:bytes.toString('base64'),mimeType:'application/octet-stream'});
  assert.equal(uploaded,undefined);assert.ok(!draft.details.includes(bytes.toString('base64')));
  await client.execute(draft.id);assert.deepEqual(uploaded,bytes);
  await assert.rejects(client.propose({operation:'createFile',name:'huge.bin',data:Buffer.alloc(1048577).toString('base64')}),e=>e.code==='size');
});
test('group personas share one Workspace request and internal prompts do not execute Google actions',async()=>{
  const previous=globalThis.fetch;let workspaceCalls=0,ordinaryCalls=0;
  globalThis.fetch=async(url)=>{if(String(url).includes('google-workspace/chat')){workspaceCalls++;return response({text:'일정 조회 결과'});}ordinaryCalls++;return new Response('data: '+JSON.stringify({text:'일반 대답',done:true})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
  try {
    const shared=workspaceConversation('다음 주 일정 알려줘');
    const results=await Promise.all([1,2].map(()=>streamAsk({message:'다음 주 일정 알려줘',history:[],workspaceResult:shared},()=>{})));
    assert.equal(workspaceCalls,1);assert.ok(results.every(x=>x.ok && x.text==='일정 조회 결과'));
    const internal=await streamAsk({message:'이 메일은 전달 문구만 작성해줘',history:[]},()=>{});assert.equal(internal.ok,true);assert.equal(workspaceCalls,1);assert.equal(ordinaryCalls,1);
  } finally {globalThis.fetch=previous;}
});
test('original and summary follow-ups enter Workspace only with selected mail metadata',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/google-workspace\/chat/);assert.equal(JSON.parse(options.body).context[0].id,'mail-a');return response({text:'원문 마지막 문장입니다.',context:[{id:'mail-a',subject:'안내'}]});};
 try {
  selectWorkspaceContext([]);assert.equal(await workspaceConversation('원문 읽어줘'),null);
  selectWorkspaceContext([{id:'mail-a',subject:'안내'}]);assert.equal(await workspaceConversation('원문 읽어줘'),'원문 마지막 문장입니다.');
  assert.equal(await workspaceConversation('짧게 요약해줘'),'원문 마지막 문장입니다.');assert.equal(calls,2);
 }finally{globalThis.fetch=previous;selectWorkspaceContext([]);}
});
