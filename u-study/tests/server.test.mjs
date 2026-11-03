import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {Store} from '../store.mjs';
import {imageAsset} from '../image-materials.mjs';
import {pictureBytes} from './fixtures/picture-exercise.mjs';
import {createApp,validateSettings} from '../server.mjs';
const tmpRoot=path.resolve('.cache');
async function fixture(t,{onShutdown,testConnection,inspectCurrentLesson,env={}}={}){const directory=await mkdtemp(path.join(tmpRoot,'test-store-'));const store=await new Store(directory,{env}).load();const automation={busy:()=>false,connect:async()=>({windowOpen:true}),startSync:()=>{store.syncing=true;},unitsForCourse:async(courseId,unitId)=>({courseId,activeUnitId:unitId||'unit4',units:[{id:'unit4',label:'Unit 4'}]}),startTask:(courseId,unitId)=>({id:'test-task',courseId,unitId,status:'waiting'}),controlTask:(id,action)=>({id,status:action==='pause'?'paused':'stopped'}),openCourse:async()=>({}),inspectCurrentLesson};const server=createApp({store,automation,port:0,onShutdown,testConnection});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{await server.shutdown();await store.flush();await rm(directory,{recursive:true,force:true});});return {directory,store,base,post:(route,data,headers={})=>fetch(base+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json','X-UStudy':'1',Origin:base,...headers},body:JSON.stringify(data)})};}
test('local API starts and serves complete UI assets',async t=>{const f=await fixture(t);assert.equal((await(await fetch(f.base+'/api/health')).json()).app,'u-study');const html=await(await fetch(f.base)).text();assert.match(html,/我的课程/);assert.equal((await fetch(f.base+'/styles.css')).status,200);});

test('current-lesson diagnostics accept only a scoped task id and retain local origin checks',async t=>{
  let calls=0;const f=await fixture(t,{inspectCurrentLesson:async input=>{calls++;assert.deepEqual(input,{taskId:'known-task'});return {ready:true,written:false,submitted:false,pages:[]};}});
  assert.equal((await f.post('/lesson/inspect',{taskId:'known-task'},{Origin:'https://evil.test'})).status,403);
  assert.equal((await f.post('/lesson/inspect',{taskId:'https://evil.test'})).status,400);assert.equal(calls,0);
  const result=await f.post('/lesson/inspect',{taskId:'known-task'});assert.equal(result.status,200);assert.deepEqual(await result.json(),{ready:true,written:false,submitted:false,pages:[]});assert.equal(calls,1);
});
test('cross-site API writes and cross-site reads are rejected',async t=>{const f=await fixture(t);assert.equal((await f.post('/sync',{}, {Origin:'https://evil.test'})).status,403);assert.equal((await f.post('/sync',{}, {'X-UStudy':'0'})).status,403);assert.equal((await fetch(f.base+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);});
test('DNS rebinding Host and requests for private files are rejected',async t=>{const f=await fixture(t);const hostStatus=await new Promise((resolve,reject)=>{http.get(f.base+'/api/state',{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(hostStatus,403);assert.equal((await fetch(f.base+'/.runtime/state.json')).status,404);assert.equal((await fetch(f.base+'/..%5Cserver.mjs')).status,403);});
test('environment key survives restart without being written or returned',async t=>{const env={USTUDY_API_KEY:'test-only-key-value',USTUDY_API_ENDPOINT:'https://api.example.test/v1/chat/completions',USTUDY_API_MODEL:'test-model'};const f=await fixture(t,{env});const s={...f.store.data.settings,aiEnabled:true};const response=await f.post('/settings',{settings:s,bank:[{question:'A sample question?',answer:'sample'}]});assert.equal(response.status,200);const returned=await response.text();assert.equal(returned.includes(env.USTUDY_API_KEY),false);assert.equal(JSON.parse(returned).keySource,'environment');const raw=await readFile(path.join(f.directory,'state.json'),'utf8');assert.equal(raw.includes(env.USTUDY_API_KEY),false);const loaded=await new Store(f.directory,{env}).load();assert.equal(loaded.apiKey,env.USTUDY_API_KEY);assert.equal(loaded.data.bank.length,1);const empty=await new Store(f.directory,{env:{}}).load();assert.equal(empty.apiKey,'');});
test('changing provider cannot send the environment key to a different endpoint',async t=>{const f=await fixture(t,{env:{USTUDY_API_KEY:'old-test-key',USTUDY_API_ENDPOINT:'https://first.example.test/v1'}});const res=await f.post('/settings',{settings:{aiEnabled:true,endpoint:'https://second.example.test/v1',model:'b'}});assert.equal(res.status,400);assert.equal(f.store.data.settings.endpoint,'https://first.example.test/v1');assert.equal(f.store.apiKey,'old-test-key');});
test('malformed bank fails atomically without overwriting previous data',async t=>{const f=await fixture(t);await f.post('/settings',{settings:{},bank:[{question:'Valid question?',answer:'answer'}]});const res=await f.post('/settings',{settings:{autoSubmit:true},bank:[{question:'Broken'}]});assert.equal(res.status,400);assert.equal(f.store.data.bank.length,1);assert.equal(f.store.data.settings.autoSubmit,false);});
test('sync and task controls return asynchronous accepted status',async t=>{const f=await fixture(t);assert.equal((await f.post('/sync',{})).status,202);const created=await f.post('/tasks',{courseId:'course-one',unitId:'unit4'});assert.equal(created.status,202);assert.equal((await created.json()).task.courseId,'course-one');assert.equal((await(await f.post('/tasks/test-task/pause',{})).json()).task.status,'paused');});
test('restarting changes unfinished tasks to stopped and retains logs',async t=>{const f=await fixture(t);f.store.data.tasks=[{id:'unfinished',status:'running',logs:[{message:'working'}]}];await f.store.flush();const next=await new Store(f.directory,{env:{}}).load();assert.equal(next.data.tasks[0].status,'stopped');assert.equal(next.data.tasks[0].logs[0].message,'working');});

test('restarting retains distinct copies of one textbook across different scoring periods',async t=>{const f=await fixture(t),group={name:'大学英语',className:'B1 班',period:'2026/08/03-2027/02/03'};f.store.data.courses=UStudy.mergeCourses([], [{id:'current',title:'综合教程2',url:'https://ucloud.unipus.cn/app/cmgt/course-management',group,entry:{title:'综合教程2',pageIndex:0}},{id:'previous',title:'综合教程2',url:'https://ucloud.unipus.cn/app/cmgt/course-management',group:{...group,period:'2026/02/27-2026/08/27'},entry:{title:'综合教程2',pageIndex:0}}]);await f.store.flush();const next=await new Store(f.directory,{env:{}}).load();assert.equal(next.data.courses.length,2);assert.equal(next.data.courses[0].group.period,group.period);assert.notEqual(next.data.courses[0].group.period,next.data.courses[1].group.period);assert.equal(next.data.courses[1].entry.title,'综合教程2');});
test('settings validate HTTPS and bounded input',()=>{assert.throws(()=>validateSettings({aiEnabled:true,endpoint:'http://not-https.test',model:'x'}));assert.throws(()=>validateSettings({model:'x'.repeat(201)}));assert.equal(validateSettings({autoSubmit:true}).autoSubmit,true);});
test('shutdown rejects outside origins and acknowledges before stopping the service',async t=>{let calls=0;const f=await fixture(t,{onShutdown:()=>{calls++;}});assert.equal((await f.post('/shutdown',{}, {Origin:'https://evil.test'})).status,403);assert.equal((await f.post('/shutdown',{}, {'X-UStudy':'0'})).status,403);assert.equal(calls,0);const response=await f.post('/shutdown',{});assert.equal(response.status,202);assert.deepEqual(await response.json(),{accepted:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);});
test('shutdown reports when no service lifecycle handler is available',async t=>{const f=await fixture(t);assert.equal((await f.post('/shutdown',{})).status,503);assert.equal((await fetch(f.base+'/api/health')).status,200);});

test('AI connection test uses the environment key and unsaved model without overwriting settings',async t=>{
  let seen;const f=await fixture(t,{env:{USTUDY_API_KEY:'env-test-key',USTUDY_API_ENDPOINT:'https://new.example.test/v1/chat/completions'},testConnection:async config=>{seen=config;return {ok:true,model:config.model,latencyMs:37};}});
  f.store.data.settings={...f.store.data.settings,model:'saved'};
  const before=JSON.stringify(f.store.data),input={endpoint:'https://new.example.test/v1/chat/completions',model:'new-model'};
  const response=await f.post('/ai/test',input);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,model:'new-model',latencyMs:37});assert.deepEqual(seen,{...input,apiKey:'env-test-key'});
  assert.equal(JSON.stringify(f.store.data),before);await f.store.flush();assert.equal((await readFile(path.join(f.directory,'state.json'),'utf8')).includes('env-test-key'),false);
});

test('AI connection test uses an environment key only for the exact startup endpoint',async t=>{
  let calls=0,key;const f=await fixture(t,{env:{USTUDY_API_KEY:'memory-test-key',USTUDY_API_ENDPOINT:'https://saved.example.test/v1/chat/completions'},testConnection:async config=>{calls++;key=config.apiKey;return {ok:true,model:config.model,latencyMs:10};}});
  f.store.data.settings.endpoint='https://saved.example.test/v1/chat/completions';f.store.apiKey='memory-test-key';
  assert.equal((await f.post('/ai/test',{endpoint:f.store.data.settings.endpoint,model:'test'})).status,200);assert.equal(key,'memory-test-key');
  assert.equal((await f.post('/ai/test',{endpoint:'https://another.example.test/v1/chat/completions',model:'test'})).status,400);assert.equal(calls,1);
});

test('AI connection validation and source checks happen before any upstream request',async t=>{
  let calls=0;const f=await fixture(t,{testConnection:async()=>{calls++;return {ok:true};}}),input={endpoint:'https://ai.example.test/v1/chat/completions',model:'test',apiKey:'test-key'};
  assert.equal((await f.post('/ai/test',input,{Origin:'https://other.test'})).status,403);
  for(const patch of [{endpoint:'http://ai.example.test/v1'},{model:''},{apiKey:42},{apiKey:''}])assert.equal((await f.post('/ai/test',{...input,...patch})).status,400);
  assert.equal(calls,0);
});

test('AI connection test rejects overlapping probes and allows a retry afterward',async t=>{
  let entered,release,calls=0;const started=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{env:{USTUDY_API_KEY:'test-key',USTUDY_API_ENDPOINT:'https://ai.example.test/v1/chat/completions'},testConnection:async config=>{if(++calls===1){entered();await pending;}return {ok:true,model:config.model,latencyMs:10};}}),input={endpoint:'https://ai.example.test/v1/chat/completions',model:'test'};
  const first=f.post('/ai/test',input);await started;assert.equal((await f.post('/ai/test',input)).status,409);release();assert.equal((await first).status,200);assert.equal((await f.post('/ai/test',input)).status,200);assert.equal(calls,2);
});

test('unit discovery needs no answer source and tasks require an explicit unit',async t=>{
  const f=await fixture(t);assert.equal(f.store.apiKey,'');const response=await f.post('/units',{courseId:'course',unitId:'unit4'});assert.equal(response.status,200);assert.equal((await response.json()).activeUnitId,'unit4');
  assert.equal((await f.post('/tasks',{courseId:'course'})).status,400);const created=await f.post('/tasks',{courseId:'course',unitId:'unit4'});assert.equal(created.status,202);assert.equal((await created.json()).task.unitId,'unit4');
});

test('browser key injection is rejected for saves and connection tests',async t=>{
  let calls=0;const f=await fixture(t,{env:{USTUDY_API_KEY:'environment-secret',USTUDY_API_ENDPOINT:'https://ai.example.test/v1/chat/completions'},testConnection:async()=>{calls++;return {ok:true};}});
  const settings={aiEnabled:true,endpoint:f.store.data.settings.endpoint,model:'test'};
  for(const apiKey of ['browser-secret',42]){
    assert.equal((await f.post('/settings',{settings,apiKey})).status,400);
    const result=await f.post('/ai/test',{endpoint:settings.endpoint,model:'test',apiKey});assert.equal(result.status,400);assert.equal((await result.text()).includes('browser-secret'),false);
  }
  assert.equal(calls,0);assert.equal(f.store.apiKey,'environment-secret');
});

test('local key is persisted separately, restored on restart and never returned',async t=>{
  const f=await fixture(t),endpoint='https://local.example.test/v1/chat/completions',apiKey='local-development-secret';
  const saved=await f.post('/settings',{settings:{aiEnabled:true,endpoint,model:'test'},apiKey});assert.equal(saved.status,200);const publicState=await saved.json();assert.equal(publicState.keySource,'local');assert.equal(JSON.stringify(publicState).includes(apiKey),false);
  assert.equal((await readFile(path.join(f.directory,'state.json'),'utf8')).includes(apiKey),false);
  const credentials=JSON.parse(await readFile(path.join(f.directory,'credentials.json'),'utf8'));assert.equal(credentials.apiKey,apiKey);assert.equal(credentials.endpoint,endpoint);
  const next=await new Store(f.directory,{env:{}}).load();assert.equal(next.apiKey,apiKey);assert.equal(next.keySource,'local');assert.equal(next.keyEndpoint,endpoint);
  assert.equal((await fetch(f.base+'/.runtime/credentials.json')).status,404);
  assert.equal((await f.post('/settings',{settings:{aiEnabled:true,endpoint:'https://other.example.test/v1',model:'test'}})).status,400);
  assert.equal((await f.post('/settings',{settings:{aiEnabled:true,endpoint,model:'next'}})).status,200);assert.equal(f.store.apiKey,apiKey);
  const overridden=await new Store(f.directory,{env:{USTUDY_API_KEY:'environment-override'}}).load();assert.equal(overridden.apiKey,'environment-override');assert.equal(overridden.keySource,'environment');
});

test('testing an unsaved local key never persists it or changes the active key',async t=>{
  let seen;const f=await fixture(t,{testConnection:async config=>{seen=config.apiKey;return {ok:true};}}),endpoint='https://local.example.test/v1';
  const result=await f.post('/ai/test',{endpoint,model:'test',apiKey:'unsaved-local-secret'});assert.equal(result.status,200);assert.equal(seen,'unsaved-local-secret');assert.equal(f.store.apiKey,'');
  await assert.rejects(readFile(path.join(f.directory,'credentials.json')),error=>error.code==='ENOENT');
});

test('invalid environment endpoints fail startup without echoing credentials',async t=>{
  const f=await fixture(t);
  await assert.rejects(new Store(f.directory,{env:{USTUDY_API_KEY:'private-env-key',USTUDY_API_ENDPOINT:'http://user:private-env-key@example.test'}}).load(),error=>/USTUDY_API_ENDPOINT/.test(error.message)&&!error.message.includes('private-env-key'));
});

test('complete embedded-picture banks larger than 9 MB import and export without losing any image assets',async t=>{
  const f=await fixture(t),imageAssets=[1,2,3].map(seed=>imageAsset(pictureBytes(seed,{width:1024,height:1024,noise:true}),{width:1024,height:1024}));
  const bank=[{kind:'exercise',version:1,title:'Before you read',scope:{courseId:'pictures',unitId:'one',entryKey:'before'},pages:[{number:1,questions:[{question:'Describe the pictures and the title.',type:'text',options:[],context:'Look at the three pictures.',wordBank:[],blankOptions:[[]],fields:[{kind:'text'}],answer:['A complete sample description.'],images:imageAssets.map((asset,index)=>({digest:asset.digest,label:'Picture '+index}))}]}],imageAssets,verification:{method:'platform-all-correct',total:1,correct:1,unit:'questions',verifiedAt:1},learnedAt:1}];
  assert.ok(JSON.stringify(bank).length>9*1024*1024);const response=await f.post('/settings',{settings:f.store.data.settings,bank});assert.equal(response.status,200);assert.equal(f.store.data.bank.length,1);
  const exported=await(await fetch(f.base+'/api/bank/export')).json();assert.equal(exported[0].imageAssets.length,3);assert.deepEqual(exported[0].imageAssets.map(image=>image.digest),imageAssets.map(image=>image.digest));assert.deepEqual(exported[0].imageAssets.map(image=>image.dataURL.length),imageAssets.map(image=>image.dataURL.length));const imported=await f.post('/settings',{settings:f.store.data.settings,bank:exported});assert.equal(imported.status,200);await f.store.flush();const reloaded=await new Store(f.directory,{env:{}}).load();assert.equal(reloaded.data.bank[0].imageAssets.length,3);await reloaded.flush();
});
