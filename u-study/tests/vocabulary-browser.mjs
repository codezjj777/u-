import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {readVocabularyFromDOM} from '../vocabulary-cards.mjs';
import {vocabularyHTML} from './fixtures/vocabulary-cards.mjs';

export async function vocabularyBrowserCases(t,context,root){
  async function setup({store,total=59,initial=0,title='New words',mode='normal',fast=false}={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/vocabulary-cards');await page.setContent(vocabularyHTML({total,initial,title,mode}));
    const task={id:'vocabulary-'+Math.random(),courseId:'vocabulary-book',unitId:'vocabulary-unit',entryKey:JSON.stringify(['vocabulary-unit',['Active reading','Reading in detail','Vocabulary'],title]),unitLabel:'Unit 4',status:'running',answered:0,pages:0,logs:[],manualItems:[]};
    const localStore=store||{directory:'.cache',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(localStore),settings={aiEnabled:true,autoSubmit:false};
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});
    engine.askModel=engine.fillQuestion=engine.verifyQuestion=async()=>assert.fail('vocabulary cannot generate or fill an answer');
    const action=engine.action.bind(engine);engine.action=async(frame,kind,...args)=>{assert.equal(kind,'notice','vocabulary must not submit or use a generic next action');return action(frame,kind,...args);};
    if(fast){const complete=engine.completeVocabulary.bind(engine);engine.completeVocabulary=(task,page,snapshot,signal)=>complete(task,page,snapshot,signal,{stepTimeoutMs:400,pollMs:40});}
    return {page,task,store:localStore,engine,settings};
  }
  const assertOnlyNext=async(f,count)=>{
    assert.deepEqual(await f.page.evaluate(()=>({next:window.nextClicks,auto:window.autoClicks,record:window.recordClicks,submit:window.submitClicks})),{next:count,auto:0,record:0,submit:0});assert.equal(f.task.answered,0);assert.equal(f.store.data.bank.length,0);
  };
  await t.test('the real 59-card flow uses exactly 59 next clicks and ignores the preloaded completion slide',async()=>{
    const f=await setup();try{
      const first=await f.page.evaluate(readVocabularyFromDOM);assert.equal(first.current,1);assert.equal(first.completed,false);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.vocabularyDone,true);assert.equal(result.total,59);await assertOnlyNext(f,59);assert.equal(await f.page.evaluate(()=>window.cardIndex),59);assert.ok(f.task.logs.some(log=>/全部 59/.test(log.message)));
    }finally{await f.page.close();}
  });
  for(const title of ['Phrases','Proper nouns'])await t.test(`${title} uses the same verified vocabulary card controls`,async()=>{
    const f=await setup({title,total:3});try{assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).vocabularyDone,true);await assertOnlyNext(f,3);}finally{await f.page.close();}
  });
  await t.test('an already active vocabulary completion page is checked without any more clicks',async()=>{
    const f=await setup({initial:59});try{assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).vocabularyDone,true);await assertOnlyNext(f,0);}finally{await f.page.close();}
  });
  for(const mode of ['stall','jump','tab-change','no-completion'])await t.test(`vocabulary ${mode} stops without repeated actions or a false completion`,async()=>{
    const f=await setup({total:mode==='no-completion'?1:3,mode,fast:true});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.vocabularyDone,undefined);await assertOnlyNext(f,1);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('mixed writable answer fields prevent vocabulary card advancement',async()=>{
    const f=await setup({total:3});try{
      await f.page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<textarea aria-label="Answer"></textarea>'));
      const wait=f.engine.waitQuestions.bind(f.engine);f.engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:450});
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);await assertOnlyNext(f,0);
    }finally{await f.page.close();}
  });
  await t.test('stopping vocabulary after a real click leaves its page and prevents further clicks',async()=>{
    const f=await setup({total:3}),controller=new AbortController();try{
      await f.page.exposeFunction('stopVocabularyFixture',()=>controller.abort(new Error('stop-vocabulary-fixture')));await f.page.locator('.action.next').evaluate(el=>el.addEventListener('click',()=>window.stopVocabularyFixture()));
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),/stop-vocabulary-fixture/);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);await assertOnlyNext(f,1);
    }finally{await f.page.close();}
  });
  await t.test('pausing at a vocabulary checkpoint preserves the prepared position and excludes pause time from the timeout',async()=>{
    const f=await setup({total:2,fast:true});try{
      const gate=f.engine.gate.bind(f.engine);let paused=false;
      f.engine.gate=async(task,signal)=>{if(!paused&&await f.page.evaluate(()=>window.nextClicks>0)){paused=true;task.status='paused';await new Promise(resolve=>setTimeout(resolve,650));task.status='running';}return gate(task,signal);};
      assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).vocabularyDone,true);assert.equal(paused,true);await assertOnlyNext(f,2);
    }finally{await f.page.close();}
  });
  await t.test('a formerly manual vocabulary entry completes only after delayed directory confirmation and clears only its own mark',async()=>{
    const directory=path.join(root,'vocabulary-learning'),store=await new Store(directory,{env:{}}).load(),f=await setup({store,total:3});
    try{
      f.task.currentEntry='Vocabulary / New words';await store.rememberManualEntry(f.task,{},'oral-only');const other={...f.task,entryKey:JSON.stringify(['vocabulary-unit',['Listening'],'Video'])};await store.rememberManualEntry(other,{});
      const entry={key:f.task.entryKey,title:'New words',path:['Active reading','Reading in detail','Vocabulary'],required:true,pending:true,completed:false};let confirms=0;
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
      f.engine.refreshTaskDirectory=async task=>{if(!f.page.isClosed()&&await f.page.evaluate(()=>window.vocabularyFinished))entry.completed=++confirms>=3;task.requiredTotal=1;task.requiredCompleted=entry.completed?1:0;return {ready:true,activeUnitId:task.unitId,entries:[{...entry}]};};
      await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(f.task.requiredCompleted,1);assert.equal(confirms,3);assert.equal(store.findManualEntry(f.task),null);assert.ok(store.findManualEntry(other));assert.equal(store.data.bank.length,0);assert.equal(f.page.isClosed(),true);assert.ok(f.task.logs.some(log=>/重新识别/.test(log.message)));await store.flush();
      const reloaded=await new Store(directory,{env:{}}).load();assert.equal(reloaded.findManualEntry(f.task),null);assert.ok(reloaded.findManualEntry(other));await reloaded.flush();
    }finally{if(!f.page.isClosed())await f.page.close();await store.flush();}
  });
  await t.test('a completion card alone keeps the task in review when the required directory has not saved completion',async()=>{
    const f=await setup({total:1}),controller=new AbortController();try{
      const entry={key:f.task.entryKey,title:'New words',path:['Vocabulary'],required:true,pending:true,completed:false};f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;f.engine.refreshTaskDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});
      const wait=f.engine.waitTaskCompletion.bind(f.engine);f.engine.waitTaskCompletion=(task,catalog,page,entry,signal,options)=>wait(task,catalog,page,entry,signal,{...options,delayMs:0});const gate=f.engine.gate.bind(f.engine);
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){assert.equal(await f.page.evaluate(()=>window.nextClicks),1);controller.abort(new Error('waiting-for-vocabulary-directory'));}return gate(task,signal);};
      await assert.rejects(f.engine.runTask(f.task,{},f.settings,controller.signal),/waiting-for-vocabulary-directory/);assert.equal(f.task.status,'review');await assertOnlyNext(f,1);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('vocabulary material preview recognizes the real card UI without advancing it or asking AI',async()=>{
    const f=await setup();try{
      f.store.data.tasks=[];f.store.data.courses=[{id:f.task.courseId}];const entry={key:f.task.entryKey,title:'New words',required:true,pending:true};f.engine.courseDirectory=async()=>({page:{}});f.engine.prepareDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});f.engine.openRequiredEntry=async()=>f.page;
      const result=await f.engine.previewMedia({courseId:f.task.courseId,unitId:f.task.unitId,entryKey:f.task.entryKey,solve:true});assert.equal(result.kind,'vocabulary');assert.deepEqual(result.vocabulary,{title:'New words',current:1,total:59,completed:false});assert.equal(result.written,false);assert.equal(result.submitted,false);assert.deepEqual(result.questions,[]);
    }finally{if(!f.page.isClosed())await f.page.close();}
  });
}
