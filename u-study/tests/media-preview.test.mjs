import test from 'node:test';
import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {createApp} from '../server.mjs';
import {accessToken,accessHeaders} from './fixtures/local-access.mjs';
import {Store} from '../store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';

test('media preview can retrieve material and ask AI without writing or submitting an exercise',async()=>{
  const entry={key:'entry',title:'Exercise 1',path:['Conversation'],required:true,pending:true};
  const store={directory:'.cache',apiKey:'test-key',data:{tasks:[],courses:[{id:'book'}],settings:{aiEnabled:true}},changed(){},addLog(){}};
  const engine=new Automation(store),url='https://ucontent.unipus.cn/preview',page={url:()=>url};
  const question={question:'The library closes at six.',type:'single',options:['True','False'],targets:[],context:'They say the library closes at six.'};
  const snapshot={pageURL:url,signature:'same',questions:[question],issues:[],mediaRequests:[{key:'one',kind:'video',sources:['https://media.example.test/audio?private-token'],tracks:[],duration:90}]};
  let prepared=0,asked=0,released=0;
  engine.courseDirectory=async()=>({page:{}});engine.prepareDirectory=async()=>({ready:true,activeUnitId:'unit',entries:[entry]});engine.openRequiredEntry=async()=>page;engine.waitQuestions=async()=>snapshot;engine.readQuestions=async()=>snapshot;
  engine.prepareMedia=async()=>{prepared++;return snapshot;};engine.askModel=async()=>{asked++;return {answers:['True']};};engine.pages.release=async()=>{released++;};
  engine.fillQuestion=engine.verifyQuestion=engine.action=async()=>assert.fail('preview must not write or submit answers');
  const result=await engine.previewMedia({courseId:'book',unitId:'unit',entryKey:'entry',solve:true});
  assert.equal(result.ready,true);assert.equal(result.written,false);assert.equal(result.submitted,false);assert.deepEqual(result.questions[0].answers,['True']);assert.equal(prepared,1);assert.equal(asked,1);assert.equal(released,1);assert.equal(store.data.tasks.length,0);assert.doesNotMatch(JSON.stringify(result),/private-token|test-key/);
});
test('media preview does not navigate a browser that is owned by an active task',async()=>{
  const engine=new Automation({directory:'.cache',data:{tasks:[{status:'review'}]},changed(){}});engine.ensureBrowser=async()=>assert.fail('active task must be preserved');
  await assert.rejects(engine.previewMedia({courseId:'book',unitId:'unit',entryKey:'entry'}),error=>error.status===409);
});

test('a submitted-summary preview reads completion and its footer without solving, continuing or resubmitting',async()=>{
  const url='https://ucontent.unipus.cn/result',scope={courseId:'book',unitId:'unit',entryKey:JSON.stringify(['unit',['Building your language'],'Exercise 3'])};
  const store={directory:'.cache',data:{tasks:[],courses:[{id:'book'}],settings:{aiEnabled:true}},changed(){},addLog(){}},engine=new Automation(store),page={url:()=>url};
  const feedback={summary:true,failed:false,total:5,objective:0,subjective:5,unanswered:0,grading:{score:93.4,pending:false},completion:{allAnswered:true},pageURL:url,frameURL:url,navigationKey:JSON.stringify([['Book','Unit 4'],'Building your language','Exercise 3']),frame:{evaluate:async()=>({selector:'footer button',count:1})}};
  engine.courseDirectory=async()=>({page:{}});engine.prepareDirectory=async()=>({ready:true,activeUnitId:'unit',entries:[{key:scope.entryKey,title:'Exercise 3',required:true,pending:true}]});engine.openRequiredEntry=async()=>page;engine.waitQuestions=async(_task,_page,_settings,_signal,options)=>{assert.equal(options.allowSummary,true);return {summaryFeedback:feedback};};engine.pages.release=async()=>{};engine.askModel=engine.action=engine.fillQuestion=async()=>assert.fail('read-only summary preview');
  const result=await engine.previewMedia({...scope,solve:true});assert.equal(result.kind,'submission-summary');assert.equal(result.completionReady,true);assert.equal(result.continueReady,true);assert.equal(result.continued,false);assert.equal(result.submitted,false);assert.equal(result.feedback.grading.score,93.4);assert.doesNotMatch(JSON.stringify(result),/https:|footer button|navigationKey/);
});

test('picture previews run the final content verification and fail promptly while preserving an unreadable lesson',async()=>{
  for(const fail of [false,true]){
    const entry={key:'entry',title:'Before you read',required:true,pending:true},store={directory:'.cache',apiKey:'test-key',data:{tasks:[],courses:[{id:'book'}],settings:{aiEnabled:true}},changed(){},addLog(){}};
    const engine=new Automation(store),url='https://ucontent.unipus.cn/preview',page={url:()=>url,isClosed:()=>false,frames:()=>[],close:async()=>assert.fail('failed image review keeps its lesson')},snapshot={pageURL:url,signature:'same',questions:[{question:'Describe the photos.',type:'text',targets:[{}]}],issues:[],imageRecords:[{key:'one'}]};let verified=0,released=0;
    engine.courseDirectory=async()=>({page:{}});engine.prepareDirectory=async()=>({ready:true,activeUnitId:'unit',entries:[entry]});engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson');return page;};engine.waitQuestions=engine.readQuestions=async()=>snapshot;engine.askModel=async()=>({answers:['A complete picture description.']});engine.imageMaterials.set(page,{url,images:{one:{digest:'fixture'}}});
    engine.imageReader.verify=async()=>{verified++;if(fail)throw Object.assign(new Error('图片暂时不可读。'),{code:'IMAGE_READ_UNAVAILABLE'});};engine.fillQuestion=engine.action=async()=>assert.fail('preview must not fill or submit');
    if(fail){await assert.rejects(engine.previewMedia({courseId:'book',unitId:'unit',entryKey:'entry',solve:true}),error=>error.code==='IMAGE_READ_UNAVAILABLE');assert.equal(engine.pages.records.get(page).protected,'image-review');}
    else{engine.pages.release=async()=>{released++;};assert.equal((await engine.previewMedia({courseId:'book',unitId:'unit',entryKey:'entry',solve:true})).ready,true);assert.equal(released,1);}
    assert.equal(verified,1);assert.equal(store.data.tasks.length,0);
  }
});

test('media preview reports changed material without exposing resource URLs or returning old answers',async()=>{
  const entry={key:'entry',title:'Exercise 1',required:true,pending:true};
  const store={directory:'.cache',apiKey:'test-key',data:{tasks:[],courses:[{id:'book'}],settings:{aiEnabled:true}},changed(){},addLog(){}};
  const engine=new Automation(store),url='https://ucontent.unipus.cn/preview',page={url:()=>url};
  const original={question:'They go to the library.',type:'single',options:['True','False'],targets:[],context:'original material',mediaKeys:['one']};
  const snapshot={pageURL:url,signature:'original',questions:[original],issues:[],mediaRequests:[{key:'one',kind:'video',sources:['https://media.example.test/one?private-token'],tracks:[],duration:90}]};
  let changed=false,released=0;
  engine.courseDirectory=async()=>({page:{}});engine.prepareDirectory=async()=>({ready:true,activeUnitId:'unit',entries:[entry]});engine.openRequiredEntry=async()=>page;engine.waitQuestions=async()=>snapshot;
  engine.readQuestions=async()=>changed?{...snapshot,signature:'changed',questions:[{...original,context:'second material',mediaKeys:['two']}]}:snapshot;
  engine.media.resolve=async()=>{changed=true;return {text:'They go to the library.',source:'test speech'};};engine.pages.release=async()=>{released++;};
  engine.askModel=engine.fillQuestion=engine.action=async()=>assert.fail('changed material must not be answered or written');
  await assert.rejects(engine.previewMedia({courseId:'book',unitId:'unit',entryKey:'entry',solve:true}),error=>{
    assert.equal(error.code,'MEDIA_SNAPSHOT_CHANGED');assert.deepEqual(error.mediaChange.questions,[{index:1,fields:['context','mediaKeys']}]);
    assert.doesNotMatch(JSON.stringify(error.mediaChange),/private-token|https:|original material|second material/);return true;
  });
  assert.equal(released,1);assert.equal(engine.mediaTranscripts.has(page),false);
});

test('picture verification diagnostics identify the affected material and comparison without revealing resources',async()=>{
  const store={directory:'.cache',data:{tasks:[]},changed(){},addLog(){}},engine=new Automation(store),url='https://ucontent.unipus.cn/preview',page={url:()=>url,isClosed:()=>false};
  const task={id:'diagnostics',status:'running'},records=[{key:'one'},{key:'two'}];let checks=0;
  engine.pages.track(page,'lesson');engine.imageMaterials.set(page,{url,images:Object.fromEntries(records.map(record=>[record.key,{verification:{mode:'original'}}]))});
  engine.imageReader.verify=async()=>{if(++checks===2)throw Object.assign(new Error('题目图片内容或显示方式发生变化，已停止。'),{code:'IMAGE_CHANGED',imageChange:{reason:'display'}});};
  await assert.rejects(engine.verifyImages(task,page,{imageRecords:records},undefined,{interactive:false}),error=>{
    assert.deepEqual(error.imageChange,{reason:'display',index:2,mode:'original'});assert.match(error.message,/第 2 张.*显示效果/);assert.doesNotMatch(JSON.stringify(error.imageChange),/https:|selector|dataURL/);return true;
  });
  assert.equal(engine.pages.records.get(page).protected,'image-review');
});
test('media preview API validates its scope and keeps the normal local-origin protection',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/media-preview-api-'));let server;
  const store=await new Store(directory,{env:{}}).load();let calls=0;
  try{
    const automation={busy:()=>false,previewMedia:async(input,options)=>{calls++;assert.equal(input.solve,true);assert.ok(options.signal instanceof AbortSignal);return {ready:true,written:false,submitted:false};}};
    server=createApp({store,automation,port:0,accessToken});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const send=(input,origin=base)=>fetch(base+'/api/media/preview',{method:'POST',headers:{...accessHeaders,Origin:origin,'X-UStudy':'1','Content-Type':'application/json'},body:JSON.stringify(input)});
    const input={courseId:'book',unitId:'unit',entryKey:'entry',solve:true};
    assert.equal((await send(input,'https://foreign.example.test')).status,403);assert.equal((await send({...input,entryKey:''})).status,400);assert.equal(calls,0);
    assert.deepEqual(await(await send(input)).json(),{ready:true,written:false,submitted:false});assert.equal(calls,1);
  }finally{await server?.shutdown();clearTimeout(store.saveTimer);await store.writeQueue;await rm(directory,{recursive:true,force:true});}
});
