import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {inspectOralWave} from '../oral-speech.mjs';
import {readOralActivityFromDOM,collectOralSourceFromDOM,oralIdentity,assertOralEntry,validateRetelling,isOralRetellEntry,loadOralStory} from '../oral-activity.mjs';
import {oralRetellHTML,oralRetelling,oralStory,oralPrompt,oralQuestion,oralQuestionDirections,oralTestWave} from './fixtures/oral-retell.mjs';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareOralDraft,saveLocalOralDraft} from '../oral-draft.mjs';
import {createApp} from '../server.mjs';
import {accessToken,accessHeaders} from './fixtures/local-access.mjs';

test('oral audio validation rejects silence, truncation and excessive duration',()=>{
  const result=inspectOralWave(oralTestWave());assert.equal(result.duration,1);assert.equal(result.sampleRate,22050);assert.ok(result.rms>0.01);
  assert.throws(()=>inspectOralWave(oralTestWave(1,{silent:true})),/没有有效语音/);assert.throws(()=>inspectOralWave(oralTestWave().subarray(0,100)),/不完整/);assert.throws(()=>inspectOralWave(oralTestWave(2),{maxSeconds:1}),/超过/);
});
test('oral reading identifies the whole retelling prompt without treating a recording button as a text answer',()=>{
  const {window,document}=parseHTML('<html><body><main><div class="layout-container"><div class="abs-direction">Complete the following task and record your answer.</div><p>Retell the story in your own words.</p><div class="record-btn" role="button">03:00 点击按钮，结束录音</div></div></main></body></html>');globalThis.document=document;globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});window.HTMLElement.prototype.getClientRects=()=>[{}];
  const oral=readOralActivityFromDOM();assert.equal(oral.recognized,true);assert.equal(oral.prompt,'Retell the story in your own words.');assert.equal(oral.context,'');assert.equal(oral.hasOtherFields,false);assert.match(oral.diagnostics.rootHTML,/record-btn/);assert.equal(oral.clocks[0],'03:00');assert.notEqual(oralIdentity(oral),oralIdentity({...oral,prompt:'Retell another story.'}));
});

function dom(html){const {window,document}=parseHTML(html);globalThis.document=document;globalThis.getComputedStyle=el=>({display:'block',visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}

test('a spoken follow-up question retains its complete two-part prompt without its zero score or recorder labels',()=>{
  const document=dom(oralRetellHTML({prompt:oralQuestion,directions:oralQuestionDirections}));
  const oral=readOralActivityFromDOM();assert.ok(oral,'the follow-up recording must be recognized');assert.equal(oral.ready,true);assert.equal(oral.prompt,oralQuestion);assert.equal(oral.kind,'response');assert.equal(oral.instructions,oralQuestionDirections);assert.doesNotMatch(oral.prompt,/^0|03:00|结束录音/);
  document.querySelector('.score_layout').textContent='100';assert.equal(oralIdentity(readOralActivityFromDOM()),oralIdentity(oral));
  document.querySelector('.oral-personal-state-sentence-container p').textContent='What choice would you make? Explain your reasons.';assert.notEqual(oralIdentity(readOralActivityFromDOM()),oralIdentity(oral));
});

test('spoken questions require a standard recorder and retain mixed or ambiguous pages for review',()=>{
  dom('<main><p>What choices does Jimmy have?</p><button class="record-btn">Record your answer</button></main>');assert.equal(readOralActivityFromDOM(),null);
  dom(oralRetellHTML({prompt:'Avenue',directions:'Learn the following words.'}));assert.equal(readOralActivityFromDOM(),null);
  dom(oralRetellHTML({prompt:oralQuestion,directions:oralQuestionDirections,mixed:true}));let oral=readOralActivityFromDOM();assert.equal(oral.ready,false);assert.equal(oral.hasOtherFields,true);
  const document=dom(oralRetellHTML({prompt:oralQuestion,directions:oralQuestionDirections})),second=document.querySelector('.p-oral-personal-state').cloneNode(true);second.querySelector('p').textContent='What choice would you make?';document.querySelector('.layout-container').append(second);oral=readOralActivityFromDOM();assert.equal(oral.ready,false);assert.match(oral.issue,/唯一|多组/);
});

test('a standard oral response need not contain the words retell, story or a question mark',()=>{
  const prompt='Describe a difficult decision you have made and explain your reasons.';dom(oralRetellHTML({prompt,directions:oralQuestionDirections}));const oral=readOralActivityFromDOM();assert.equal(oral.prompt,prompt);assert.equal(oral.ready,true);assert.equal(oral.kind,'response');
});

test('idle end-recording text is not a live recording, and saved playback cannot be overwritten',()=>{
  const document=dom(oralRetellHTML());let oral=readOralActivityFromDOM();assert.equal(oral.ready,true);assert.equal(oral.recording,false);assert.equal(oral.saved,false);assert.equal(oral.maxSeconds,180);
  document.querySelector('.button-record path').setAttribute('d','M645.744434,351 L378,351 Z');oral=readOralActivityFromDOM();assert.equal(oral.recording,true);assert.equal(oral.ready,false);
  document.querySelector('.button-record path').setAttribute('d','M340,450 L450,500');document.querySelector('.record-count-down').remove();const replay=document.createElement('button');replay.className='audio-replay';document.querySelector('.record-button-group').append(replay);oral=readOralActivityFromDOM();assert.equal(oral.saved,true);assert.equal(oral.ready,true);
  dom(oralRetellHTML({mixed:true}));assert.equal(readOralActivityFromDOM().hasOtherFields,true);assert.equal(readOralActivityFromDOM().ready,false);
});

test('retelling validation rejects incomplete, oversized and non-spoken responses',()=>{
  assert.equal(validateRetelling(oralRetelling),oralRetelling);assert.throws(()=>validateRetelling('Correct'),/完整英文/);assert.throws(()=>validateRetelling('Here is '+oralRetelling),/完整英文/);assert.throws(()=>validateRetelling(oralRetelling+' <speak>extra</speak>'),/完整英文/);assert.throws(()=>validateRetelling(oralRetelling.repeat(4)),/完整英文/);
});

test('oral task binding requires exact course frame, directory leaf and selected unit',()=>{
  const url='https://ucontent.unipus.cn/offline-oral/retell',page={url:()=>url},frame={url:()=>url},task={unitId:'unit4',entryKey:JSON.stringify(['unit4',['Active reading','Getting the idea'],'Exercise 2'])},oral={prompt:oralPrompt,pageURL:url,frameURL:url,frame,navigation:{known:true,chapter:'Getting the idea',title:'Exercise 2'}};
  assert.doesNotThrow(()=>assertOralEntry(task,page,oral));assert.equal(isOralRetellEntry(task),true);
  for(const changed of [{pageURL:url+'?wrong'},{frameURL:url+'?wrong'},{navigation:{known:true,chapter:'Getting the idea',title:'Exercise 1'}},{hasOtherFields:true}])assert.throws(()=>assertOralEntry(task,page,{...oral,...changed}),/口语题/);
  assert.throws(()=>assertOralEntry({...task,unitId:'unit5'},page,oral),/口语题/);
  assert.throws(()=>assertOralEntry(task,{url:()=>url.replace('unipus.cn','unipus.cn.evil.test')},oral),/口语题/);
});

test('missing or ambiguous same-section story never starts source navigation',async()=>{
  const task={courseId:'book',unitId:'unit4',entryKey:JSON.stringify(['unit4',['Active reading','Getting the idea'],'Exercise 2'])},engine={store:{data:{courses:[{id:'book'}]}}},page={},oral={context:''};engine.courseDirectory=async()=>({page:{}});
  for(const entries of [[],[{title:'Text',path:['Further exploration','Reading in detail']}],[{title:'Text',path:['Active reading','Reading in detail']},{title:'Text',path:['Active reading','Reading in detail']} ]]){engine.prepareDirectory=async()=>({entries});await assert.rejects(loadOralStory(engine,task,page,oral,new AbortController().signal),/唯一故事原文/);}
});

test('standalone rich-text story includes its ending while unrelated note inputs and player controls stay outside the material',()=>{
  dom('<html><body><aside><input placeholder="笔记"></aside><main><div class="layoutBody-container"><div class="question-rich-text-read"><div class="richText"><div class="textContainer">'+oralStory+'</div></div><div class="rich-text-read-control">精读00:00 / 10:16译注词倍速字号背景</div></div></div></main></body></html>');const source=collectOralSourceFromDOM();assert.equal(source.context,oralStory);assert.equal(source.complete,true);assert.match(source.context,/expensive possessions\.$/);assert.doesNotMatch(source.context,/精读|笔记|倍速/);
});

for(const priorHandler of ['question-controls-v2','oral-retell-v1'])test(`an oral mark from ${priorHandler} is retried once and an unsupported oral mark still skips later runs`,async()=>{
  const directory=await mkdtemp(path.resolve('.cache/oral-memory-'));let store;
  try{
    store=await new Store(directory,{env:{}}).load();const scope={courseId:'book',unitId:'unit4',entryKey:JSON.stringify(['unit4',['Active reading','Getting the idea'],'Exercise 2']),currentEntry:'Active reading / Getting the idea / Exercise 2'};
    await store.rememberManualEntry(scope,{},'no-fillable-questions',priorHandler);const engine=new Automation(store),entry={key:scope.entryKey,title:'Exercise 2',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false},snapshot={ready:true,activeUnitId:'unit4',entries:[entry]};let scans=0;
    engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>snapshot;engine.openRequiredEntry=async()=>({});engine.pages.release=async()=>({status:'closed'});engine.answerEntry=async()=>{scans++;return {manual:true,reason:'oral-only'};};
    const task=()=>({...scope,id:Math.random().toString(),status:'running',logs:[],manualItems:[],answered:0,pages:0});const first=task();await engine.runTask(first,{}, {},new AbortController().signal);
    assert.equal(scans,1);assert.equal(store.data.manualEntryMarks[0].handler,'oral-recording-v2');assert.ok(first.logs.some(log=>/支持口语复述/.test(log.message)));
    await engine.runTask(task(),{}, {},new AbortController().signal);assert.equal(scans,1);assert.equal(store.data.bank.length,0);
  }finally{await store?.flush();await rm(directory,{recursive:true,force:true});}
});

test('saved oral recording waits for exact directory completion without treating sound or elapsed time as completion',async()=>{
  const task={id:'oral-directory',status:'running',logs:[]},store={directory:'.cache',data:{tasks:[task]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store),entry={key:'oral-entry',required:true};let polls=0;
  engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.refreshTaskDirectory=async()=>({entries:[{...entry,completed:++polls===3}]});
  const result=await engine.waitTaskCompletion(task,{}, {},entry,new AbortController().signal,{oralComplete:true,delayMs:0});assert.equal(polls,3);assert.equal(result.matched.completed,true);assert.ok(task.logs.some(log=>/不再重复录音/.test(log.message)));
  polls=0;engine.refreshTaskDirectory=async()=>({entries:[{...entry,completed:false}]});const pending=await engine.waitTaskCompletion(task,{}, {},entry,new AbortController().signal,{oralComplete:true,delayMs:0});assert.equal(pending.matched.completed,false);
});

test('a local oral preview is reusable without AI or credentials and binds the exact script and audio',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/oral-draft-'));try{
    const scope={courseId:'book',unitId:'unit',entryKey:JSON.stringify(['unit',['Getting the idea'],'Exercise 2'])},oral={prompt:oralPrompt,instructions:'Record your answer.',progress:50,maxSeconds:180},source={context:oralStory},settings={model:'fixture',endpoint:'https://ai.example.test/v1/chat/completions'},bytes=oralTestWave(2),options={directory,scope,oral,source,settings,ask:async()=>assert.fail('local preview must not call AI'),speech:{synthesize:async()=>assert.fail('reuse must not synthesize again')}};
    const prepared=await saveLocalOralDraft({...options,text:oralRetelling,speech:{synthesize:async()=>({...inspectOralWave(bytes),bytes,voice:'fixture'})}});assert.match(prepared.reviewKey,/^[a-f0-9]{64}$/);
    const cached=await prepareOralDraft({...options,expectedKey:prepared.reviewKey});assert.equal(cached.reused,true);assert.equal(cached.script,oralRetelling);assert.deepEqual(cached.audio.bytes,bytes);
    await assert.rejects(prepareOralDraft({...options,source:{context:oralStory+' A changed ending.'},expectedKey:prepared.reviewKey}),/草稿不存在/);
    await assert.rejects(prepareOralDraft({...options,expectedKey:'f'.repeat(64)}),/试听稿或音频已变化/);
    await writeFile(path.join(prepared.folder,'retelling.txt'),oralRetelling+' Changed.');await assert.rejects(prepareOralDraft({...options,expectedKey:prepared.reviewKey}),/内容与本题不一致/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a one-time oral replacement visits only its selected pending leaf and retries its old manual mark',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/oral-scope-'));let store;
  try{
    store=await new Store(directory,{env:{}}).load();const entryKey=JSON.stringify(['unit4',['Active reading','Getting the idea'],'Exercise 2']),task={id:'scoped',courseId:'book',unitId:'unit4',unitLabel:'Unit 4',entryKey,status:'running',logs:[],answered:0,pages:0,manualItems:[],oralReplacement:{entryKey,recordingKey:'a'.repeat(64),draftKey:'b'.repeat(64)}},entry={key:entryKey,title:'Exercise 2',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false},other={...entry,key:'another-entry',title:'Exercise 1'},engine=new Automation(store),opened=[];
    await store.rememberManualEntry(task,{},'oral-only','oral-retell-v1');engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>({ready:true,activeUnitId:'unit4',entries:[other,entry]});engine.openRequiredEntry=async(_task,_catalog,_directory,entry)=>{opened.push(entry.key);return {};};engine.answerEntry=async()=>({manual:true,reason:'oral-only'});engine.pages.release=async()=>({status:'closed'});
    await engine.runTask(task,{}, {},new AbortController().signal);assert.deepEqual(opened,[entryKey]);assert.equal(task.status,'partial');assert.equal(store.data.bank.length,0);
  }finally{await store?.flush();await rm(directory,{recursive:true,force:true});}
});

test('the task API rejects malformed or cross-origin replacement requests and keeps exact preview bindings',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/oral-api-'));let server,store;
  try{
    store=await new Store(directory,{env:{}}).load();let received,calls=0;server=createApp({store,automation:{busy:()=>false,startTask:(courseId,unitId,options)=>{calls++;received={courseId,unitId,options};return {id:'fixture',status:'waiting'};}},port:0,accessToken});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,replacement={entryKey:JSON.stringify(['unit4',['Getting the idea'],'Exercise 2']),recordingKey:'a'.repeat(64),draftKey:'b'.repeat(64)},send=(oralReplacement,origin=base)=>fetch(base+'/api/tasks',{method:'POST',headers:{...accessHeaders,'Content-Type':'application/json','X-UStudy':'1',Origin:origin},body:JSON.stringify({courseId:'book',unitId:'unit4',oralReplacement})});
    assert.equal((await send(replacement,'https://foreign.example.test')).status,403);assert.equal((await send({...replacement,draftKey:''})).status,400);assert.equal(calls,0);assert.equal((await send(replacement)).status,202);assert.deepEqual(received,{courseId:'book',unitId:'unit4',options:{oralReplacement:replacement}});
    const engine=new Automation(store);assert.throws(()=>engine.startTask('book','unit5',{oralReplacement:replacement}),/口语替换需要对应目录/);
  }finally{await server?.shutdown();await store?.flush();await rm(directory,{recursive:true,force:true});}
});

test('retrying oral speech requires a live review task and consumes its exact server-side preview once',()=>{
  const task={id:'oral-control',status:'review',entryKey:'entry',logs:[],oralReview:{ready:true,entryKey:'entry',recordingKey:'a'.repeat(64),draftKey:'b'.repeat(64),previousSeconds:1.8,seconds:51}},store={data:{tasks:[task]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store);
  assert.throws(()=>engine.controlTask(task.id,'replace-oral'),/没有可重录/);engine.runtime.runs.set(task.id,Promise.resolve());engine.taskPages.set(task.id,{isClosed:()=>false});const resumed=engine.controlTask(task.id,'replace-oral');assert.equal(resumed.status,'running');assert.equal(resumed.oralRetryRequested,true);assert.deepEqual(resumed.oralReplacement,{entryKey:'entry',recordingKey:'a'.repeat(64),draftKey:'b'.repeat(64)});assert.throws(()=>engine.controlTask(task.id,'replace-oral'),/没有可重录/);
});
