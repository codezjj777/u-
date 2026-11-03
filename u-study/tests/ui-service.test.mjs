import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import '../dist/core.js';
import '../dist/service.js';
import '../dist/task-view.js';

const markup=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const idle=()=>new Promise(resolve=>setImmediate(resolve));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

function fixture(t,{courses=[],unitSummary={required:33,completed:2,pending:31,unknown:0},unitAvailability=[],keyPresent=true,saveError=false,manualEntryCount=0,syncError=false}={}){
  const {window,document}=parseHTML(markup),calls=[],timers=[];let ready=false,client,unitReadCount=0;
  // linkedom exposes a getter only; emulate native select selection for UI tests.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){const options=[...this.querySelectorAll('option')];return (options.find(option=>option.hasAttribute('selected'))||options[0])?.value||'';},set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
  const settings={aiEnabled:true,endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture-model',autoSubmit:false,questionSelector:'',nextSelector:'',submitSelector:''};
  const backend={courses,tasks:[],activity:[],settings,bankCount:0,manualEntryCount,connected:false,windowOpen:false,syncing:false,keyPresent,keySource:keyPresent?'environment':'none',lastSynced:null};
  const values=new Map([['ustudy-demo','false']]);
  for(const dialog of document.querySelectorAll('dialog')){
    dialog.showModal=function(){this.open=true;this.setAttribute('open','');};
    dialog.close=function(){this.open=false;this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  }
  const transport={createClient:options=>{
    client=UStudyService.createClient({...options,EventSourceImpl:undefined,location:new URL('http://127.0.0.1:4173/'),schedule:()=>1,cancel:()=>{},fetchImpl:async(url,options)=>{
      calls.push({url,options});if(!ready)throw new TypeError('fixture offline');
      if(url==='/api/state')return json(backend);
      if(url==='/api/ai/test')return json({ok:true,model:'fixture-model',latencyMs:12});
      if(url==='/api/sync')return syncError?json({error:'离线同步失败'},503):json({accepted:true},202);
      if(url==='/api/settings'){if(saveError)return json({error:'数据未能保存到磁盘，请重试。'},507);backend.settings={...backend.settings,...JSON.parse(options.body).settings};return json({...backend,keyPresent:true});}
      if(url==='/api/manual-entries/clear'){const cleared=backend.manualEntryCount;backend.manualEntryCount=0;return json({cleared,manualEntryCount:0});}
      if(url==='/api/units'){const input=JSON.parse(options.body),availability=unitAvailability[Math.min(unitReadCount++,unitAvailability.length-1)]||'ready';return json({courseId:input.courseId,units:[{id:'unit4',label:'Unit 4'},{id:'unit5',label:'Unit 5'}],activeUnitId:input.unitId||'unit4',availability,summary:availability==='pending'?{required:0,completed:0,pending:0,unknown:0}:unitSummary,account:'测试账号',heading:'Horns of a dilemma',sourceURL:'https://ucloud.unipus.cn/app/cmgt/resource-detail/42',entries:[{title:'Exercise 1',path:['Active reading'],required:true,requiredLabel:'必修',status:'未开始'}]});}
      if(url==='/api/tasks'){const input=JSON.parse(options.body);return json({task:{id:'test-task',...input,status:'waiting',logs:[],answered:0}});}
      throw new Error('unexpected request');
    }});return client;
  }};
  vm.runInNewContext(script,{document,window,UStudy,UStudyTaskView:globalThis.UStudyTaskView,UStudyService:transport,AbortController,AbortSignal,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},setTimeout:(fn,delay)=>{const timer=setTimeout(fn,delay);timer.unref();timers.push(timer);return timer;},clearTimeout});
  t.after(()=>{client?.stop();timers.forEach(clearTimeout);});
  const click=element=>element.dispatchEvent(new window.Event('click',{bubbles:true}));
  function fill(){
    click(document.querySelector('button[data-action=settings]'));
    document.querySelector('#ai-enabled').checked=true;
    document.querySelector('#api-endpoint').value=settings.endpoint;document.querySelector('#api-model').value=settings.model;
  }
  return {document,window,calls,fill,click,reconnect:()=>client.ensureConnected(),recover:()=>{ready=true;},setState:async next=>{Object.assign(backend,next);await client.request('/state');}};
}

test('the AI test reconnects after failed startup and uses no browser-supplied key',async t=>{
  const f=fixture(t);await idle();f.fill();assert.equal(f.document.querySelector('#settings-service-note').hidden,false);
  f.recover();f.click(f.document.querySelector('#test-ai-connection'));await idle();await idle();
  const result=f.document.querySelector('#ai-test-result');assert.equal(result.dataset.status,'success');assert.match(result.textContent,/连接成功/);
  assert.equal(f.document.querySelector('#api-key').disabled,true);assert.match(f.document.querySelector('#api-key-status').textContent,/环境变量/);assert.equal(f.document.querySelector('#api-model').value,'fixture-model');assert.equal(f.document.querySelector('#settings-service-note').hidden,true);
  assert.equal(f.document.querySelector('#settings-service-state').textContent,'本地服务已连接');
  assert.equal(f.calls.filter(call=>call.url==='/api/ai/test').length,1);
  assert.equal('apiKey' in JSON.parse(f.calls.find(call=>call.url==='/api/ai/test').options.body),false);
});

test('saving settings performs a fresh connection check instead of trusting an offline flag',async t=>{
  const f=fixture(t);await idle();f.fill();f.recover();
  f.document.querySelector('#settings-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));await idle();await idle();
  const saved=f.calls.filter(call=>call.url==='/api/settings');assert.equal(saved.length,1);assert.equal('apiKey' in JSON.parse(saved[0].options.body),false);
  assert.equal(f.document.querySelector('#settings-dialog').open,false);assert.equal(f.document.querySelector('#settings-error').hidden,true);
});

test('a missing key can be entered and saved locally',async t=>{
  const f=fixture(t,{keyPresent:false});await idle();f.recover();await f.reconnect();f.fill();f.click(f.document.querySelector('#test-ai-connection'));await idle();await idle();
  assert.match(f.document.querySelector('#ai-test-result').textContent,/请填写 API Key/);assert.equal(f.calls.filter(call=>call.url==='/api/ai/test').length,0);assert.equal(f.document.querySelector('#api-key').disabled,false);
  f.document.querySelector('#api-key').value='local-fixture-secret';
  f.document.querySelector('#settings-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));await idle();await idle();
  const request=f.calls.find(call=>call.url==='/api/settings');assert.equal(JSON.parse(request.options.body).apiKey,'local-fixture-secret');assert.equal(f.document.querySelector('#api-key').value,'');
});

test('task UI reads units, submits the selected unit and invalidates it when the course changes',async t=>{
  const f=fixture(t,{courses:[{id:'course-one',title:'Course one'},{id:'course-two',title:'Course two'}]});await idle();f.recover();await f.reconnect();await idle();
  const query=selector=>f.document.querySelector(selector),change=el=>el.dispatchEvent(new f.window.Event('change',{bubbles:true}));
  f.click(query('[data-course-start="course-one"]'));f.click(query('[data-course-start="course-one"]'));assert.equal(query('#start-task').disabled,true);
  await idle();await idle();assert.equal(query('#task-course').value,'course-one');assert.equal(query('#task-unit').value,'unit4');assert.match(query('#task-unit-summary').textContent,/必修 33 项/);assert.equal(query('#start-task').disabled,false);
  assert.equal(f.calls.filter(call=>call.url==='/api/units').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/tasks').length,0);
  query('#task-unit').value='unit5';change(query('#task-unit'));assert.equal(query('#start-task').disabled,true);await idle();await idle();
  f.click(query('#start-task'));await idle();await idle();const created=f.calls.filter(call=>call.url==='/api/tasks');assert.equal(created.length,1);assert.deepEqual(JSON.parse(created[0].options.body),{courseId:'course-one',unitId:'unit5'});
});
test('switching courses clears a previously loaded unit instead of reusing the other course directory',async t=>{
  const f=fixture(t,{courses:[{id:'course-one',title:'Course one'},{id:'course-two',title:'Course two'}]});await idle();f.recover();await f.reconnect();await idle();const query=selector=>f.document.querySelector(selector);
  f.click(query('#load-units'));await idle();await idle();assert.equal(query('#start-task').disabled,false);
  query('#task-course').value='course-two';query('#task-course').dispatchEvent(new f.window.Event('change',{bubbles:true}));assert.equal(query('#start-task').disabled,true);assert.equal(query('#task-unit').value,'');
});

test('zero required items are visible as a source-check problem and cannot start answering',async t=>{
  const f=fixture(t,{courses:[{id:'course-one',title:'Course one'}],unitSummary:{required:0,completed:0,pending:0,unknown:0}});await idle();f.recover();await f.reconnect();await idle();const query=selector=>f.document.querySelector(selector);
  f.click(query('#load-units'));await idle();await idle();assert.equal(query('#start-task').disabled,true);assert.match(query('#task-unit-summary').textContent,/未读取到必修标记/);assert.equal(query('#directory-preview').hidden,false);assert.match(query('#directory-preview-content').textContent,/测试账号/);assert.match(query('#directory-preview-content').textContent,/Active reading.*Exercise 1/);
});

test('the unit picker waits through locked placeholders and pins the unit during the retry',async t=>{
  const f=fixture(t,{courses:[{id:'course-one',title:'Course one'}],unitAvailability:['pending','ready']});await idle();f.recover();await f.reconnect();await idle();const query=selector=>f.document.querySelector(selector);
  f.click(query('#load-units'));await idle();await idle();assert.equal(query('#start-task').disabled,true);assert.match(query('#task-unit-summary').textContent,/等待必修要求和完成状态/);
  await new Promise(resolve=>setTimeout(resolve,1700));await idle();assert.match(query('#task-unit-summary').textContent,/必修 33 项/);assert.equal(query('#start-task').disabled,false);const requests=f.calls.filter(call=>call.url==='/api/units');assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].options.body).unitId,'unit4');
});

test('failed saves keep the settings form and entered key open, and block duplicate submissions',async t=>{
  const f=fixture(t,{keyPresent:false,saveError:true});await idle();f.recover();await f.reconnect();f.fill();
  f.document.querySelector('#api-key').value='fixture-unsaved-key';
  const form=f.document.querySelector('#settings-form');
  form.dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  form.dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  await idle();await idle();
  assert.equal(f.calls.filter(call=>call.url==='/api/settings').length,1);
  assert.equal(f.document.querySelector('#settings-dialog').open,true);assert.equal(f.document.querySelector('#api-key').value,'fixture-unsaved-key');
  assert.match(f.document.querySelector('#settings-error').textContent,/未能保存/);assert.equal(f.document.querySelector('button[type=submit]').disabled,false);
});

test('the oral mode defaults to five seconds and saves the selected recording mode',async t=>{
  const f=fixture(t);await idle();f.recover();await f.reconnect();f.fill();
  const mode=f.document.querySelector('#oral-mode');assert.equal(mode.value,'short');mode.value='retell';
  f.document.querySelector('#settings-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));await idle();await idle();
  const saved=f.calls.find(call=>call.url==='/api/settings');assert.ok(saved);assert.equal(JSON.parse(saved.options.body).settings.oralMode,'retell');assert.equal(f.document.querySelector('#oral-mode-summary').textContent,'完整复述');
});
test('task updates retain log nodes, reading position and an unchanged directory preview',async t=>{
  const f=fixture(t,{courses:[{id:'one',title:'Course'}]});await idle();f.recover();await f.reconnect();
  f.click(f.document.querySelector('#load-units'));await idle();await idle();
  const directoryRow=f.document.querySelector('#directory-preview-content li');
  const task={id:'live',status:'running',logs:[{message:'First',timestamp:1}],answered:0,courseTitle:'Course'};
  await f.setState({tasks:[task]});const log=f.document.querySelector('.task-live-log'),line=log.firstElementChild;
  Object.defineProperties(log,{clientHeight:{configurable:true,value:100},scrollHeight:{configurable:true,value:1000}});log.scrollTop=10;
  await f.setState({tasks:[{...task,answered:1,logs:[...task.logs,{message:'Second',timestamp:2}]}]});
  assert.equal(f.document.querySelector('.task-live-log'),log);assert.equal(log.firstElementChild,line);assert.equal(log.children.length,2);assert.equal(log.scrollTop,10);
  assert.equal(f.document.querySelector('#directory-preview-content li'),directoryRow);
  await f.setState({storageError:'磁盘写入失败'});assert.equal(f.document.querySelector('#system-status').hidden,false);assert.match(f.document.querySelector('#system-status').textContent,/磁盘/);
});

test('manual entry reset is visible, disabled during a task and clears only the remembered entries',async t=>{
  const f=fixture(t,{manualEntryCount:2});await idle();f.recover();await f.reconnect();f.fill();
  const button=f.document.querySelector('#clear-manual-entries');
  assert.match(f.document.querySelector('#manual-entry-status').textContent,/2/);assert.equal(button.disabled,false);
  await f.setState({tasks:[{id:'active',status:'running',logs:[]}]});assert.equal(button.disabled,true);
  await f.setState({tasks:[]});assert.equal(button.disabled,false);
  f.click(button);await idle();await idle();
  assert.equal(f.calls.filter(call=>call.url==='/api/manual-entries/clear').length,1);
  assert.match(f.document.querySelector('#manual-entry-status').textContent,/0/);assert.equal(button.disabled,true);
  assert.match(f.document.querySelector('#toast').textContent,/下次运行将重新检测/);
});

test('finished tasks coalesce into one progress sync after the browser operation is released and update percentages only from the returned state',async t=>{
  const course={id:'one',title:'Course',progress:81.82,status:'active'},f=fixture(t,{courses:[course]});await idle();f.recover();await f.reconnect();
  const running={id:'answer',courseId:'one',courseTitle:'Course',status:'running',updatedAt:2000,logs:[]};
  await f.setState({connected:true,windowOpen:true,lastSynced:1000,tasks:[running],operation:{kind:'answer'}});
  await f.setState({tasks:[{...running,status:'completed',updatedAt:3000},{...running,id:'other',status:'partial',updatedAt:3100}]});await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,0);
  await f.setState({operation:null});await idle();await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/tasks').length,0);
  assert.equal(f.document.querySelector('#course-grid .progress-label strong').textContent,'81.82%');
  await f.setState({lastSynced:4000,syncing:false,courses:[{...course,progress:100,status:'completed'}]});await idle();
  assert.equal(f.document.querySelector('#course-grid .progress-label strong').textContent,'100%');assert.equal(f.document.querySelector('#course-grid .course-status').textContent,'已完成');
  await f.setState({activity:[]});await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);
});

test('returning to a connected workbench refreshes a completed task newer than the last sync once',async t=>{
  const f=fixture(t,{courses:[{id:'one',title:'Course',progress:81.82}]});await idle();f.recover();await f.reconnect();
  const task={id:'finished',courseId:'one',status:'completed',updatedAt:2000,logs:[]};
  await f.setState({connected:true,windowOpen:true,lastSynced:1000,tasks:[task]});await idle();await idle();
  assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);
  await f.setState({syncing:false});await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);
});

test('progress refresh failure preserves the completed task and does not retry on every state event',async t=>{
  const f=fixture(t,{courses:[{id:'one',title:'Course',progress:81.82,status:'active'}],syncError:true});await idle();f.recover();await f.reconnect();
  await f.setState({connected:true,windowOpen:true,lastSynced:1000,tasks:[{id:'finished',courseId:'one',status:'completed',updatedAt:2000,logs:[]}]});await idle();await idle();
  assert.match(f.document.querySelector('#toast').textContent,/课程进度暂未刷新/);assert.equal(f.document.querySelector('.running-label').textContent,'已完成');assert.equal(f.document.querySelector('#course-grid .progress-label strong').textContent,'81.82%');
  await f.setState({activity:[]});await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);
});

test('historical tasks never launch a closed or login window, while a newly completed live task can refresh before the connection flag is updated',async t=>{
  const f=fixture(t,{courses:[{id:'one',title:'Course',progress:81.82}]});await idle();f.recover();await f.reconnect();
  const task={id:'finished',courseId:'one',status:'completed',updatedAt:2000,logs:[]};
  await f.setState({connected:false,windowOpen:false,lastSynced:1000,tasks:[task]});await f.setState({windowOpen:true});await idle();assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,0);
  await f.setState({tasks:[{...task,status:'running',updatedAt:3000}],operation:{kind:'answer'}});await f.setState({tasks:[{...task,updatedAt:4000}],operation:null});await idle();await idle();
  assert.equal(f.calls.filter(call=>call.url==='/api/sync').length,1);assert.equal(f.calls.filter(call=>call.url==='/api/connect').length,0);
});
