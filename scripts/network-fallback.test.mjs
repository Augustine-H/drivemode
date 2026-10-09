import test from 'node:test';
import assert from 'node:assert/strict';
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
globalThis.window=new EventTarget();window.location={origin:'https://voice.example.com',protocol:'https:'};
globalThis.document=new EventTarget();document.hidden=false;
const net=await import('../src/lib/network.ts');
const originalFetch=globalThis.fetch;
const config={mode:'auto',https:'https://voice.example.com',lan:'https://voice.lan.example.com',tailscale:'https://nas.example.ts.net:8445'};
test('resume refresh distinguishes lost connectivity from an expired credential',async()=>{
  try {
    for (const status of [200,401,403,429,503]) {
      globalThis.fetch=async()=>Response.json({}, {status});
      assert.equal(await net.publicSessionRefreshOutcome(),status===200?true:status===401?false:null);
    }
    globalThis.fetch=async()=>{throw new DOMException('timed out','TimeoutError');};
    assert.equal(await net.publicSessionRefreshOutcome(),null);
    globalThis.fetch=async()=>Response.json({ok:true});
    assert.equal(await net.publicSessionRefreshOutcome(),true);
  } finally {globalThis.fetch=originalFetch;}
});
test('automatic selection preserves priority and caches health, manual modes never fall back',async()=>{
  try {
    const calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));if(String(url).startsWith(config.https))throw Error('down');return Response.json({status:'ok'});};
    net.saveNetworkConfig(config);assert.equal(await net.networkBase(),config.lan);assert.equal(net.networkSnapshot().fallback,true);
    assert.deepEqual(calls,[config.https+'/health',config.lan+'/health']);await net.networkBase();assert.equal(calls.length,2);
    calls.length=0;net.saveNetworkConfig({...config,mode:'https'});await assert.rejects(net.networkBase());assert.deepEqual(calls,[config.https+'/health']);
    net.saveNetworkConfig({...config,mode:'tailscale'});assert.equal(await net.networkBase(),config.tailscale);
  } finally {globalThis.fetch=originalFetch;net.invalidateNetwork();}
});
test('network transport failure never replays a submitted mutation and subsequent request reconnects',async()=>{
  try {
    let posts=0,health=0;globalThis.fetch=async(url)=>{if(String(url).endsWith('/health')){health++;return Response.json({status:'ok'});}posts++;throw Error('connection lost');};
    net.saveNetworkConfig(config);await assert.rejects(net.networkFetch('/api/ask',{method:'POST',body:'{}'}));assert.equal(posts,1);
    await assert.rejects(net.networkFetch('/api/ask',{method:'POST',body:'{}'}));assert.equal(posts,2);assert.equal(health,2);
  } finally {globalThis.fetch=originalFetch;net.invalidateNetwork();}
});
test('authentication rejection renews session once; wrong endpoint and insecure production are rejected',async()=>{
  try {
    let request=0,refresh=0;globalThis.fetch=async(url)=>{if(String(url).endsWith('/health'))return Response.json({status:'ok'});if(String(url).endsWith('/refresh')){refresh++;return Response.json({ok:true});}return Response.json({}, {status:++request===1?401:200});};
    net.saveNetworkConfig(config);assert.equal((await net.networkFetch('/api/ask',{method:'POST',body:'{}'})).status,200);assert.equal(refresh,1);assert.equal(request,2);
    for(const url of ['http://voice.example.com','https://user:secret@voice.example.com','https://voice.example.com:8445','https://voice.example.com/?token=secret'])assert.throws(()=>net.validateEndpoint(url,'https'));
    await assert.rejects(net.probeEndpoint('http://192.168.1.10:8097'),/HTTP LAN/);
  } finally {globalThis.fetch=originalFetch;net.invalidateNetwork();}
});
