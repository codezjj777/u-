import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {openStudyWindow} from '../workspace-start.mjs';
import {APP_VERSION} from '../runtime-check.mjs';

const base='http://127.0.0.1:4173';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('one-click startup opens the study window with the normal protected local API',async()=>{
  const calls=[];
  const result=await openStudyWindow(base,{fetchImpl:async(url,options)=>{
    calls.push({url,options});return json(url.endsWith('/state')?{tasks:[],windowOpen:false}:{windowOpen:true});
  }});
  assert.equal(result.status,'opened');assert.equal(calls.length,2);assert.equal(calls[1].url,base+'/api/connect');
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
    if(req.url==='/api/health')res.end(JSON.stringify({ok:true,app:'u-study',version:APP_VERSION}));
    else if(req.url==='/api/state')res.end(JSON.stringify({windowOpen:false,tasks:[]}));
    else if(req.url==='/api/connect'&&req.method==='POST'){connects++;res.end(JSON.stringify({windowOpen:true}));}
    else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.PORT=String(server.address().port);
  try{const {main}=await import('../launcher.mjs?one-click-test');assert.equal((await main(['--all','--no-open'])).status,'opened');assert.equal(connects,1);}
  finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;await new Promise(resolve=>server.close(resolve));}
});
test('an outdated backend with a task or browser window is never silently reused or closed',async()=>{
  for(const state of [{windowOpen:true,tasks:[]},{windowOpen:false,tasks:[{status:'review'}]}]){
    const previousPort=process.env.PORT;let writes=0;
    const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST')writes++;res.end(JSON.stringify(req.url==='/api/health'?{ok:true,app:'u-study',version:'1.1.1'}:state));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.PORT=String(server.address().port);
    try{const {main}=await import(`../launcher.mjs?old-busy-${server.address().port}`);await assert.rejects(main(['--no-open'],{startService:async()=>assert.fail('active service cannot be restarted')}),error=>error.code==='OUTDATED_SERVICE'&&/尚未加载/.test(error.message));assert.equal(writes,0);}
    finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;await new Promise(resolve=>server.close(resolve));}
  }
});
test('an idle outdated backend is gracefully replaced and its actual new version is verified',async()=>{
  const previousPort=process.env.PORT;let starts=0,stops=0,replacement;
  const old=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/health')res.end(JSON.stringify({ok:true,app:'u-study',version:'1.1.1'}));
    else if(req.url==='/api/state')res.end(JSON.stringify({windowOpen:false,tasks:[],operation:null}));
    else if(req.url==='/api/shutdown'){stops++;res.once('finish',()=>old.close());res.end(JSON.stringify({accepted:true}));}
  });
  await new Promise(resolve=>old.listen(0,'127.0.0.1',resolve));const port=old.address().port;process.env.PORT=String(port);
  try{
    const {main}=await import(`../launcher.mjs?old-idle-${port}`);
    await main(['--no-open'],{startService:async()=>{starts++;replacement=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,app:'u-study',version:APP_VERSION}));});await new Promise(resolve=>replacement.listen(port,'127.0.0.1',resolve));}});
    assert.equal(starts,1);assert.equal(stops,1);
  }finally{if(previousPort===undefined)delete process.env.PORT;else process.env.PORT=previousPort;if(old.listening)await new Promise(resolve=>old.close(resolve));if(replacement)await new Promise(resolve=>replacement.close(resolve));}
});
