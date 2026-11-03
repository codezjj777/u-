import test from 'node:test';
import assert from 'node:assert/strict';
import '../dist/service.js';

const state=()=>({courses:[],tasks:[],activity:[],settings:{aiEnabled:false},bankCount:0,connected:false,windowOpen:false,lastSynced:null,keyPresent:false});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

function fixture(t,fetchImpl,options={}){
  const streams=[],timers=new Map(),changes=[],states=[];let serial=0;
  class Stream{
    constructor(url){this.url=url;this.listeners=new Map();this.closed=false;streams.push(this);}
    addEventListener(name,fn){this.listeners.set(name,fn);}
    emit(name,value){this.listeners.get(name)?.({data:JSON.stringify(value)});}
    close(){this.closed=true;}
  }
  const client=UStudyService.createClient({fetchImpl,EventSourceImpl:Stream,location:new URL('http://127.0.0.1:4173/'),onConnectionChange:value=>changes.push(value),onState:value=>states.push(value),schedule:fn=>{const id=++serial;timers.set(id,fn);return id;},cancel:id=>timers.delete(id),...options});
  t.after(()=>client.stop());
  return {client,streams,timers,changes,states,async retry(){const [id,fn]=timers.entries().next().value||[];assert.ok(fn,'a recovery read should be scheduled');timers.delete(id);await fn();}};
}

test('service starts its event stream even when the first state request fails',async t=>{
  let ready=false;const calls=[];
  const f=fixture(t,async(url,options)=>{calls.push([url,options.method]);if(!ready)throw new TypeError('offline');return json(url==='/api/state'?state():{ok:true});});
  await assert.rejects(f.client.start(),{code:'SERVICE_UNAVAILABLE'});assert.equal(f.streams.length,1);assert.equal(f.client.isConnected(),false);
  ready=true;assert.deepEqual(await f.client.request('/ai/test',{apiKey:'fixture-only-key'}),{ok:true});assert.equal(f.client.isConnected(),true);
  assert.deepEqual(calls,[['/api/state','GET'],['/api/state','GET'],['/api/ai/test','POST']]);
});

test('service automatically recovers after startup failure without a page refresh',async t=>{
  let ready=false;const f=fixture(t,async()=>{if(!ready)throw new TypeError('offline');return json(state());});
  await assert.rejects(f.client.start());ready=true;await f.retry();assert.equal(f.client.isConnected(),true);assert.equal(f.states.length,1);assert.equal(f.timers.size,0);
});

test('a valid event stream state can restore the connection after a failed initial fetch',async t=>{
  const f=fixture(t,async()=>{throw new TypeError('offline');});await assert.rejects(f.client.start());
  f.streams[0].emit('state',state());assert.equal(f.client.isConnected(),true);assert.equal(f.states.length,1);assert.equal(f.timers.size,0);
});

test('AI validation errors do not incorrectly mark the local service offline',async t=>{
  const f=fixture(t,async url=>url==='/api/state'?json(state()):json({error:'API Key 无效'},400));await f.client.start();
  await assert.rejects(f.client.request('/ai/test',{}),error=>{assert.equal(error.status,400);assert.equal(error.code,undefined);return true;});
  assert.equal(f.client.isConnected(),true);assert.equal(f.timers.size,0);
});

test('recovery retries only state reads and never replays a failed submitted action',async t=>{
  let failPost=true;const calls=[];
  const f=fixture(t,async(url,options)=>{calls.push([url,options.method]);if(url!=='/api/state'&&failPost)throw new TypeError('offline');return json(url==='/api/state'?state():{saved:true});});
  await f.client.start();await assert.rejects(f.client.request('/settings',{apiKey:'fixture-only-key'}));assert.equal(f.client.isConnected(),false);
  failPost=false;await f.retry();assert.equal(calls.filter(([,method])=>method==='POST').length,1);
  assert.deepEqual(await f.client.request('/settings',{}),{saved:true});assert.equal(calls.filter(([,method])=>method==='POST').length,2);
});

test('simultaneous actions share one reconnect check',async t=>{
  let resolve,reads=0;const wait=new Promise(done=>{resolve=done;});const f=fixture(t,async()=>{reads++;await wait;return json(state());});
  const a=f.client.ensureConnected(),b=f.client.ensureConnected();assert.equal(a,b);resolve();await Promise.all([a,b]);assert.equal(reads,1);assert.equal(f.streams.length,1);
});

test('cancelling a test does not turn a healthy service into an offline service',async t=>{
  const controller=new AbortController();const f=fixture(t,async(url,options)=>{if(url==='/api/state')return json(state());options.signal.throwIfAborted();return json({ok:true});});
  await f.client.start();controller.abort();await assert.rejects(f.client.request('/ai/test',{},'POST',controller.signal),{name:'AbortError'});assert.equal(f.client.isConnected(),true);assert.equal(f.timers.size,0);
});

test('stop closes the event stream and a page restored from history can reconnect',async t=>{
  const f=fixture(t,async()=>json(state()));await f.client.start();f.client.stop();assert.equal(f.streams[0].closed,true);assert.equal(f.client.isConnected(),false);
  await f.client.start();assert.equal(f.client.isConnected(),true);assert.equal(f.streams.length,2);
});

test('static files and foreign origins cannot receive saved settings or API keys',async t=>{
  for(const location of [new URL('file:///D:/u-study/dist/index.html'),new URL('https://example.test/')]){
    let calls=0;const f=fixture(t,async()=>{calls++;return json(state());},{location});
    await assert.rejects(f.client.request('/settings',{apiKey:'fixture-only-key'}),error=>{assert.equal(error.code,'SERVICE_UNAVAILABLE');assert.match(error.message,/http:\/\/127\.0\.0\.1:4173/);return true;});
    assert.equal(calls,0);assert.equal(f.streams.length,0);assert.equal(f.timers.size,0);
  }
});

test('a different local preview server is not mistaken for the application backend',async t=>{
  let posts=0;const f=fixture(t,async(url,options)=>{if(options.method==='POST')posts++;return json({preview:true});});
  await assert.rejects(f.client.request('/settings',{apiKey:'fixture-only-key'}),{code:'SERVICE_UNAVAILABLE'});assert.equal(f.client.isConnected(),false);assert.equal(posts,0);
});

test('a rendering exception does not masquerade as a stopped backend',async t=>{
  const f=fixture(t,async()=>json(state()),{onState:()=>{throw new Error('fixture rendering error');}});
  await assert.rejects(f.client.start(),/rendering error/);assert.equal(f.client.isConnected(),true);assert.equal(f.timers.size,0);
});

test('SSE patches apply in order and a gap triggers only a fresh snapshot read',async t=>{
  let reads=0;const current={...state(),revision:1,instanceId:'same'};
  const f=fixture(t,async()=>{reads++;return json(current);});await f.client.start();
  f.streams[0].emit('patch',{baseRevision:1,revision:2,changes:{connected:true},updates:[]});
  assert.equal(f.states.at(-1).connected,true);assert.equal(f.states.at(-1).revision,2);
  current.revision=4;f.streams[0].emit('patch',{baseRevision:3,revision:4,changes:{},updates:[]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);assert.equal(f.states.at(-1).revision,4);
  f.streams[0].emit('state',{...current,instanceId:'restarted',revision:0});assert.equal(f.states.at(-1).revision,0);
});
test('business request timeout does not report a healthy local service as offline',async t=>{
  const f=fixture(t,async(url,options)=>{
    if(url==='/api/state')return json(state());
    return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  },{requestTimeout:10});await f.client.start();
  // Keep the event loop alive while AbortSignal's unref'ed timeout expires.
  const keepAlive=setTimeout(()=>{},1000);try{await assert.rejects(f.client.request('/units',{}),{code:'REQUEST_TIMEOUT'});}finally{clearTimeout(keepAlive);}
  assert.equal(f.client.isConnected(),true);assert.equal(f.timers.size,0);
});

test('a missing patch arriving during an older snapshot fetch forces a new read after it settles',async t=>{
  let reads=0,release;const held=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,async()=>{
    reads++;if(reads===1)return json({...state(),instanceId:'one',revision:1});
    if(reads===2){await held;return json({...state(),instanceId:'one',revision:2});}
    return json({...state(),instanceId:'one',revision:4,connected:true});
  });await f.client.start();const pending=f.client.request('/state');
  f.streams[0].emit('patch',{instanceId:'one',baseRevision:3,revision:4,changes:{connected:true},updates:[]});
  release();await pending;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,3);assert.equal(f.states.at(-1).revision,4);assert.equal(f.states.at(-1).connected,true);
});
