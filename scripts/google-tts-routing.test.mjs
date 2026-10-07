import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackends, routeTts } from '../src/lib/google-tts-routing.server.ts';
import { UsageLedger } from '../services/tts/ledger.mjs';
import { createTtsService } from '../services/tts/server.mjs';
const token = 'x'.repeat(48);
const nodes = ['cloud','nas','pc'].map((id,i) => ({ id, url:`https://${id}.example`, token, budget:[800000,100000,100000][i] }));
const status = backend => ({ authentication:true, api:true, nodeId:backend.id, config:{ threshold:backend.budget, allowOverage:false, cluster:true } });
const request = (method='POST', body={ text:'고정 테스트', segmentId:'one' }, signal) => new Request('https://app.example/api/google-tts', { method, ...(method==='POST'? {body:JSON.stringify(body)}:{}), signal });
function fixture(unavailable=[]) {
  const calls=[];
  const fetcher = async (url, options) => {
    const u = new URL(url), backend=nodes.find(b=>new URL(b.url).hostname===u.hostname);
    calls.push(`${backend.id}${u.pathname}`);
    if (unavailable.includes(backend.id)) throw new Error('offline');
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    return u.pathname==='/synthesize' ? new Response(JSON.stringify({type:'done',status:status(backend)})+'\n', {headers:{'content-type':'application/x-ndjson'}}) : Response.json(status(backend));
  };
  return { calls,fetcher };
}
test('priority, tokens, TLS, unique addresses and combined budget validated',()=>{
  assert.deepEqual(parseBackends(JSON.stringify(nodes)),nodes);
  for (const invalid of [[...nodes].reverse(), [{...nodes[0],url:'http://remote.example'}], [{...nodes[0],budget:1000001}], [{...nodes[0],token:'short'}], [nodes[0],{...nodes[1],url:nodes[0].url}]]) assert.throws(()=>parseBackends(JSON.stringify(invalid)));
});
for (const [down, chosen] of [[[],'cloud'],[['cloud'],'nas'],[['cloud','nas'],'pc']]) test(`unreachable ${down.join(',') || 'none'} chooses ${chosen}`,async()=>{
  const f=fixture(down), response=await routeTts(nodes,request(),'/synthesize',f.fetcher);
  assert.equal(response.headers.get('x-voice-grok-backend'),chosen);
  const frame=JSON.parse((await response.text()).trim()); assert.equal(frame.status.routing.activeBackend,chosen);
  assert.equal(f.calls.filter(s=>s.endsWith('/synthesize')).length,1);
});
test('all unavailable returns 503 without submission',async()=>{
  const f=fixture(['cloud','nas','pc']); const r=await routeTts(nodes,request(),'/synthesize',f.fetcher);
  assert.equal(r.status,503); assert.equal(f.calls.length,3);
});
test('restored cloud wins the next segment',async()=>{
  const f=fixture(['cloud']); assert.equal((await routeTts(nodes,request(),'/synthesize',f.fetcher)).headers.get('x-voice-grok-backend'),'nas');
  const restored=fixture(); assert.equal((await routeTts(nodes,request(),'/synthesize',restored.fetcher)).headers.get('x-voice-grok-backend'),'cloud');
});
test('ambiguous submission failure never replays on NAS or PC',async()=>{
  const f=fixture(), fetcher=async(url,opt)=>{ if(new URL(url).pathname==='/synthesize'){ f.calls.push('cloud/synthesize');throw new Error('disconnected'); } return f.fetcher(url,opt); };
  const r=await routeTts(nodes,request(),'/synthesize',fetcher); assert.equal(r.status,503); assert.deepEqual(f.calls,['cloud/health','cloud/synthesize']);
});
test('quota mismatch and invalid API authentication fall through',async()=>{
  const f=fixture(),fetcher=async(url,opt)=>new URL(url).hostname==='cloud.example'?Response.json({...status(nodes[0]),config:{threshold:1000000,allowOverage:false}}):new URL(url).hostname==='nas.example'?Response.json({...status(nodes[1]),authentication:false}):f.fetcher(url,opt);
  const r=await routeTts(nodes,request('GET'),'/status',fetcher); const data=await r.json(); assert.equal(data.routing.activeBackend,'pc'); assert.equal(data.routing.totalBudget,1000000);
});
test('overage is blocked without mutating any backend',async()=>{
  const f=fixture(); assert.equal((await routeTts(nodes,request('POST',{allowOverage:true}),'/settings',f.fetcher)).status,409); assert.deepEqual(f.calls,['cloud/health']);
});
test('request cancellation halts traversal',async()=>{
  const ac=new AbortController();ac.abort();const f=fixture(); await assert.rejects(routeTts(nodes,request('GET',null,ac.signal),'/status',f.fetcher));assert.equal(f.calls.length,0);
});
test('HTTP duplicate/error responses do not submit elsewhere',async()=>{
  const f=fixture(),fetcher=async(url,opt)=>new URL(url).pathname==='/synthesize'?new Response('duplicate',{status:409}):f.fetcher(url,opt);
  assert.equal((await routeTts(nodes,request(),'/synthesize',fetcher)).status,409);assert.deepEqual(f.calls,['cloud/health']);
});
test('slow health probe times out and advances to NAS',async()=>{
  const f=fixture(); const fetcher=async(url,opt)=>{
    if(new URL(url).hostname==='cloud.example') return new Promise((resolve,reject)=>opt.signal.addEventListener('abort',()=>reject(opt.signal.reason),{once:true}));
    return f.fetcher(url,opt);
  };
  // Keep a live handle: AbortSignal.timeout timers alone do not keep Node alive.
  const keepAlive=setTimeout(()=>{},1000);
  try { assert.equal((await routeTts(nodes,request(),'/synthesize',fetcher,10)).headers.get('x-voice-grok-backend'),'nas'); }
  finally { clearTimeout(keepAlive); }
});
test('real backend health and persisted overage obey cluster guard',async t=>{
  const ledger=new UsageLedger(':memory:');ledger.configure({allowOverage:true});
  const client={listVoices:async()=>[{voices:[]}]};
  const service=createTtsService({client,ledger,token,nodeId:'nas',defaults:{threshold:100000,voice:'Leda',streaming:true,allowOverage:false,cluster:true}});
  await service.refresh();await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{service.server.closeAllConnections();service.server.close();ledger.close();});
  const base=`http://127.0.0.1:${service.server.address().port}`;
  assert.equal((await fetch(base+'/health')).status,401);
  const health=await (await fetch(base+'/health',{headers:{authorization:`Bearer ${token}`}})).json();
  assert.equal(health.nodeId,'nas');assert.equal(health.authentication,true);assert.equal(health.config.allowOverage,false);
  const response=await fetch(base+'/settings',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({allowOverage:true,confirmOverage:true})});assert.equal(response.status,400);
});
