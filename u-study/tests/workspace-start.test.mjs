import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {openStudyWindow} from '../workspace-start.mjs';
import {APP_VERSION,sourceBuildId} from '../runtime-check.mjs';
import {LOCAL_AUTH} from '../local-access.mjs';
import {accessToken} from './fixtures/local-access.mjs';

const base='http://127.0.0.1:4173';
const buildId=await sourceBuildId();
const currentHealth={ok:true,app:'u-study',version:APP_VERSION,buildId,localAuth:LOCAL_AUTH,instanceId:'fixture-service'};
const readAccess=async(_runtime,_port,instanceId)=>{assert.equal(instanceId,currentHealth.instanceId);return accessToken;};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('one-click startup opens the study window with the normal protected local API',async()=>{
  const calls=[];
  const result=await openStudyWindow(base,{accessToken,fetchImpl:async(url,options)=>{
    calls.push({url,options});return json(url.endsWith('/state')?{tasks:[],windowOpen:false}:{windowOpen:true});
  }});
  assert.equal(result.status,'opened');assert.equal(calls.length,2);assert.equal(calls[1].url,base+'/api/connect');
  for(const {options} of calls)assert.equal(options.headers.Authorization,`Bearer ${accessToken}`);
  assert.equal(calls[1].options.headers.Origin,base);assert.equal(calls[1].options.headers['X-UStudy'],'1');assert.equal(calls[1].options.body,'{}');
});
test('repeated startup leaves an existing browser window and its draft untouched',async()=>{
  let calls=0;const result=await openStudyWindow(base,{fetchImpl:async()=>{calls++;return json({windowOpen:true,tasks:[]});}});
  assert.equal(result.status,'already-open');assert.equal(calls,1);
});
test('startup preserves active tasks, directory reads and course syncs',async()=>{
  for(const state of [{syncing:true},{operation:{kind:'catalog'}},...['waiting','running','paused','review','stopping'].map(status=>({tasks:[{status}]}))]){
    let calls=0;const result=await openStudyWindow(base,{fetchImpl:async()=>{calls++;return json(state);}});
    assert.equal(result.status,'busy');assert.equal(calls,1);
  }
});
test('startup reports a browser launch error without restarting or repeating the action',async()=>{
  let calls=0;await assert.rejects(openStudyWindow(base,{fetchImpl:async()=>++calls===1?json({tasks:[]}):json({error:'登录窗口启动失败'},400)}),/登录窗口启动失败/);assert.equal(calls,2);
});
test('startup does not claim success from an unconfirmed browser response',async()=>{
  let calls=0;await assert.rejects(openStudyWindow(base,{fetchImpl:async()=>++calls===1?json({}):json({})}),/尚未确认/);
});
test('launcher --all reuses a healthy service and opens its login window without spawning another service',async()=>{
  const previousPort=process.env.PORT;let connects=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/health')res.end(JSON.stringify(currentHealth));
    else if(req.headers.authorization!==`Bearer ${accessToken}`){res.statusCode=401;res.end('{}');}
    else if(req.url==='/api/state')res.end(JSON.stringify({windowOpen:false,tasks:[]}));
    else if(req.url==='/api/connect'&&req.method==='POST'){connects++;res.end(JSON.stringify({windowOpen:true}));}
    else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.PORT=String(server.address().port);
  try{const {main}=await import('../launcher.mjs?one-click-test');assert.equal((await main(['--all','--no-open'],{readAccess})).status,'opened');assert.equal(connects,1);}
  finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;await new Promise(resolve=>server.close(resolve));}
});
test('outdated or same-version stale backends with tasks or windows are never silently reused or closed',async()=>{
  for(const health of [{version:'1.1.1',buildId},{version:APP_VERSION},{version:APP_VERSION,buildId:'old-code'}])for(const state of [{windowOpen:true,tasks:[]},{windowOpen:false,tasks:[{status:'review'}]}]){
    const previousPort=process.env.PORT;let writes=0;
    const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST')writes++;res.end(JSON.stringify(req.url==='/api/health'?{ok:true,app:'u-study',...health}:state));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.PORT=String(server.address().port);
    try{const {main}=await import(`../launcher.mjs?old-busy-${server.address().port}`);await assert.rejects(main(['--no-open'],{startService:async()=>assert.fail('active service cannot be restarted')}),error=>error.code==='OUTDATED_SERVICE'&&/尚未加载/.test(error.message));assert.equal(writes,0);}
    finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;await new Promise(resolve=>server.close(resolve));}
  }
});
test('idle outdated and same-version stale backends are gracefully replaced and the loaded code is verified',async()=>{
  for(const health of [{version:'1.1.1',buildId},{version:APP_VERSION},{version:APP_VERSION,buildId:'old-code'}]){
  const previousPort=process.env.PORT;let starts=0,stops=0,replacement;
  const old=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/health')res.end(JSON.stringify({ok:true,app:'u-study',...health}));
    else if(req.url==='/api/state')res.end(JSON.stringify({windowOpen:false,tasks:[],operation:null}));
    else if(req.url==='/api/shutdown'){stops++;res.once('finish',()=>old.close());res.end(JSON.stringify({accepted:true}));}
  });
  await new Promise(resolve=>old.listen(0,'127.0.0.1',resolve));const port=old.address().port;process.env.PORT=String(port);
  try{
    const {main}=await import(`../launcher.mjs?old-idle-${port}`);
    await main(['--no-open'],{readAccess,startService:async()=>{starts++;replacement=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(currentHealth));});await new Promise(resolve=>replacement.listen(port,'127.0.0.1',resolve));}});
    assert.equal(starts,1);assert.equal(stops,1);
  }finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;if(old.listening)await new Promise(resolve=>old.close(resolve));if(replacement)await new Promise(resolve=>replacement.close(resolve));}
  }
});
test('launcher does not report readiness when a replacement still loads stale same-version code',async()=>{
  const previousPort=process.env.PORT;const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));process.env.PORT=String(port);let replacement,starts=0;
  try{
    const {main}=await import(`../launcher.mjs?stale-replacement-${port}`);
    await assert.rejects(main(['--no-open'],{startService:async()=>{starts++;replacement=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,app:'u-study',version:APP_VERSION,buildId:'old-code'}));});await new Promise(resolve=>replacement.listen(port,'127.0.0.1',resolve));}}),/尚未加载本机最新代码/);assert.equal(starts,1);
  }finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;if(replacement)await new Promise(resolve=>replacement.close(resolve));}
});
