import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import * as Core from '../shared/core.mjs';
import {Store} from '../store.mjs';
import {createApp} from '../server.mjs';
import {Automation} from '../automation.mjs';
import {fillQuestion} from '../answer-writer.mjs';
import {OperationManager} from '../operation-manager.mjs';
import {StateChannel,stateDelta} from '../state-events.mjs';
import '../dist/service.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(t){
  const directory=await mkdtemp(path.resolve('.cache/robustness-'));
  const store=await new Store(directory,{env:{}}).load();
  t.after(async()=>{clearTimeout(store.saveTimer);await store.writeQueue;await rm(directory,{recursive:true,force:true});});
  return {store,directory};
}
const makeIndex=rows=>Core.buildBankIndex(Core.validateBank(rows));

test('bank identity rejects a changed option set but accepts reordered full options',()=>{
  const index=makeIndex([{question:'Choose one.',options:['red','green'],answer:'red',type:'single'}]);
  assert.equal(Core.matchAnswer({question:'Choose one.',type:'single',options:['red','blue']},index),null);
  assert.deepEqual(Core.matchAnswer({question:'Choose one.',type:'single',options:['green','red']},index).indexes,[1]);
  assert.equal(Core.matchAnswer({question:'Choose one.',type:'multiple',options:['green','red']},index),null);
});
test('passage and scope survive import and prevent borrowing an answer from another exercise',()=>{
  const row={question:'What does the author suggest?',answer:'Walk.',type:'text',context:'The author recommends walking.',scope:{courseId:'one',unitId:'unit4'}};
  const index=makeIndex([row]),question={...row,options:[]};
  assert.equal(Core.matchAnswer(question,index).answers[0],'Walk.');
  assert.equal(Core.matchAnswer({...question,context:'The author recommends taking the bus.'},index),null);
  assert.equal(Core.matchAnswer({...question,scope:{courseId:'two',unitId:'unit4'}},index),null);
  assert.equal(Core.matchAnswer(question,makeIndex([{question:row.question,answer:'Old answer.'} ])),null);
  assert.notEqual(Core.questionSignature([question]),Core.questionSignature([{...question,context:'Changed.'}]));
});

test('stopping a multi-blank write prevents the next input and does not count a partial question',async t=>{
  const {store}=await fixture(t),engine=new Automation(store);
  const task={id:'stop-test',status:'running',answered:0,pages:0,logs:[]};store.data.tasks=[task];
  store.data.bank=Core.validateBank([{question:'Fill both.',answer:['first','second']}]);
  const entered=deferred(),release=deferred(),writes=[];let value;
  const frame={locator:selector=>({fill:async text=>{writes.push(selector);if(selector==='one'){entered.resolve();await release.promise;}value=text;},inputValue:async()=>value})};
  const page={url:()=> 'https://ucontent.unipus.cn/learn/42'};
  engine.waitQuestions=async()=>({frame,signature:'same',questions:[{question:'Fill both.',type:'text',options:[],targets:[{selector:'one'},{selector:'two'}]}]});
  const controller=new AbortController();
  const pending=engine.runtime.start(task,controller,()=>engine.answerEntryAttempt(task,page,{autoSubmit:false},controller.signal));
  await entered.promise;engine.controlTask(task.id,'stop');
  assert.equal(task.status,'stopping');assert.equal(engine.busy(),true);
  release.resolve();await pending;
  assert.deepEqual(writes,['one']);assert.equal(task.answered,0);assert.equal(task.status,'stopped');assert.equal(engine.busy(),false);
});
test('pause between multi-choice controls waits before the next mutation and checks changed material',async()=>{
  const controller=new AbortController(),entered=deferred(),release=deferred(),writes=[];
  let paused=false,material='old';
  const frame={locator:selector=>({setChecked:async()=>{writes.push(selector);if(selector==='one'){paused=true;entered.resolve();}}})};
  const pending=fillQuestion(frame,{type:'multiple',targets:[{selector:'one',kind:'native'},{selector:'two',kind:'native'}]},{indexes:[0,1],answers:['a','b']},{signal:controller.signal,checkpoint:async()=>{if(paused)await release.promise;if(material!=='old')throw new Error('材料变化');}});
  const rejected=assert.rejects(pending,/材料变化/);await entered.promise;await sleep(5);assert.deepEqual(writes,['one']);material='new';release.resolve();await rejected;
});
test('an aborted action never clicks a stale submit control',async t=>{
  const {store}=await fixture(t),engine=new Automation(store),controller=new AbortController();let clicks=0;
  const frame={evaluate:async()=>{controller.abort();return '#submit';},locator:()=>({first:()=>({click:async()=>clicks++})})};
  await assert.rejects(engine.action(frame,'submit','',{signal:controller.signal}),{name:'AbortError'});assert.equal(clicks,0);
});

test('invalid state schemas are quarantined before they can enable automatic submit',async t=>{
  for(const patch of [{bank:[{question:'Missing answer'}]},{tasks:{}},{activity:'wrong'},{settings:{autoSubmit:'yes'}}]){
    const {store,directory}=await fixture(t);
    await writeFile(path.join(directory,'state.json'),JSON.stringify({...store.data,settings:{autoSubmit:true},...patch}));
    const next=await new Store(directory,{env:{}}).load();clearTimeout(next.saveTimer);
    assert.equal(next.data.settings.autoSubmit,false);assert.deepEqual(next.data.bank,[]);assert.deepEqual(next.data.tasks,[]);
    assert.ok((await readdir(directory)).some(name=>name.startsWith('state.invalid-')));
  }
});
test('failed explicit saves reject, retain the old settings, and recover on retry',async t=>{
  const {store,directory}=await fixture(t);await store.flush();
  await mkdir(path.join(directory,'state.tmp'));
  await assert.rejects(store.saveConfiguration({settings:{autoSubmit:true}}),error=>error.status===507);
  assert.equal(store.data.settings.autoSubmit,false);assert.ok(store.publicState().storageError);
  await rm(path.join(directory,'state.tmp'),{recursive:true});
  await store.saveConfiguration({settings:{autoSubmit:true}});assert.equal(store.storageError,null);
  const next=await new Store(directory,{env:{}}).load();assert.equal(next.data.settings.autoSubmit,true);
});
test('settings API reports storage failure instead of accepting unsaved data',async t=>{
  const {store,directory}=await fixture(t);await mkdir(path.join(directory,'state.tmp'));
  const server=createApp({store,automation:{busy:()=>false},port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.shutdown());
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-UStudy':'1',Origin:base},body:JSON.stringify({settings:{autoSubmit:true}})});
  assert.equal(response.status,507);assert.equal(store.data.settings.autoSubmit,false);assert.match((await response.json()).error,/未能保存/);
});
test('concurrent settings requests cannot interleave keys and provider settings',async t=>{
  const {store,directory}=await fixture(t),entered=deferred(),release=deferred(),persist=store.persist.bind(store);
  t.mock.method(store,'persist',async(...args)=>{entered.resolve();await release.promise;return persist(...args);});
  const server=createApp({store,automation:{busy:()=>false},port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.shutdown());
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=data=>fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-UStudy':'1',Origin:base},body:JSON.stringify(data)});
  const first=post({settings:{aiEnabled:true,endpoint:'https://first.example.test/v1',model:'one'},apiKey:'first-fixture-key'});await entered.promise;
  assert.equal((await post({settings:{aiEnabled:true,endpoint:'https://second.example.test/v1',model:'two'},apiKey:'second-fixture-key'})).status,409);
  release.resolve();assert.equal((await first).status,200);const next=await new Store(directory,{env:{}}).load();assert.equal(next.apiKey,'first-fixture-key');assert.equal(next.keyEndpoint,next.data.settings.endpoint);
});
test('a crash after staging credentials still reloads the last committed settings/key pair',async t=>{
  const {store,directory}=await fixture(t),endpoint='https://old.example.test/v1';
  await store.saveConfiguration({settings:{aiEnabled:true,endpoint,model:'old'},apiKey:'old-fixture-key'});
  const committed=JSON.parse(await readFile(path.join(directory,'credentials.json'),'utf8'));
  await writeFile(path.join(directory,'credentials.json'),JSON.stringify({apiKey:'new-fixture-key',endpoint:'https://new.example.test/v1',version:'uncommitted',previous:[committed]}));
  const next=await new Store(directory,{env:{}}).load();assert.equal(next.apiKey,'old-fixture-key');assert.equal(next.data.settings.endpoint,endpoint);
  assert.equal(JSON.stringify(next.publicState()).includes('fixture-key'),false);
});
test('bank storage and index are reused for logs and refreshed only when a new bank is committed',async t=>{
  const {store,directory}=await fixture(t);await store.saveConfiguration({settings:{},bank:[{question:'First?',answer:'one'}]});
  const index=store.getBankIndex(),state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
  assert.equal(state.schemaVersion,2);assert.equal(state.bank,undefined);const modified=(await stat(path.join(directory,state.bankFile))).mtimeMs;
  store.addActivity('Only activity changed.');await store.flush();
  assert.equal(store.getBankIndex(),index);assert.equal((await stat(path.join(directory,state.bankFile))).mtimeMs,modified);
  await store.saveConfiguration({settings:{},bank:[{question:'Second?',answer:'two'}]});assert.notEqual(store.getBankIndex(),index);
});

test('operation ownership is acquired before awaiting and cancellation keeps the lock until cleanup',async()=>{
  const operations=new OperationManager(),entered=deferred(),release=deferred(),controller=new AbortController();
  const pending=operations.run('open',async signal=>{entered.resolve();await release.promise;signal.throwIfAborted();},{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});await entered.promise;controller.abort();
  assert.throws(()=>operations.acquire('catalog'),error=>error.status===409);release.resolve();await rejected;
  await operations.run('catalog',async()=>{});assert.equal(operations.active,null);
});
test('two real automation entry points cannot concurrently navigate the shared browser',async t=>{
  const {store}=await fixture(t),engine=new Automation(store),entered=deferred(),release=deferred();
  engine.openCourse=async()=>{entered.resolve();await release.promise;return {};};
  const opening=engine.openCourseForUser({});await entered.promise;
  await assert.rejects(engine.connect(),error=>error.status===409);release.resolve();await opening;
});
test('directory cancellation is passed through and releases catalog ownership after cleanup',async t=>{
  const {store}=await fixture(t),engine=new Automation(store),controller=new AbortController();
  store.data.courses=[{id:'one',title:'Course',url:'https://ucloud.unipus.cn/a'}];
  engine.courseDirectory=async(_course,{signal})=>{await sleep(10000,undefined,{signal});};
  const pending=engine.unitsForCourse('one',undefined,{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;assert.equal(engine.catalogLoading,false);assert.equal(engine.operations.active,null);
});

test('large SSE states wait for drain and coalesce slow-client updates without disconnecting',()=>{
  class Response extends EventEmitter{constructor(){super();this.messages=[];this.slow=true;this.destroyed=false;}write(message){this.messages.push(message);return !this.slow;}destroy(){this.destroyed=true;this.emit('close');}end(){this.emit('close');}}
  const response=new Response(),channel=new StateChannel(response);
  const initial={revision:0,tasks:Array.from({length:50},(_,i)=>({id:String(i),logs:Array.from({length:150},()=>({message:'x'.repeat(100)}))})),courses:[],activity:[],settings:{}};
  channel.state(initial);channel.state({...initial,revision:1,connected:true});channel.state({...initial,revision:2,connected:false});
  assert.equal(response.destroyed,false);assert.equal(response.messages.length,1);response.slow=false;response.emit('drain');
  assert.equal(response.messages.length,2);assert.match(response.messages[1],/^event: patch/);assert.ok(response.messages[1].length<1000);assert.equal(channel.latest,null);channel.end();
});
test('task/log patches reconstruct the exact snapshot, including log truncation and task removal',()=>{
  const previous={revision:1,tasks:[{id:'one',status:'running',logs:[{message:'a'},{message:'b'}]},{id:'two',logs:[]}],courses:[],activity:[],settings:{}};
  const next={...previous,revision:2,tasks:[{id:'one',status:'paused',logs:[{message:'b'},{message:'c'}]}]};
  assert.deepEqual(UStudyService.applyPatch(previous,stateDelta(previous,next)),next);
  assert.equal(UStudyService.applyPatch({...previous,revision:0},stateDelta(previous,next)),null);
});
