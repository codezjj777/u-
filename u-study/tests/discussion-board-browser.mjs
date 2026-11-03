import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {completeDiscussionBoard,readDiscussionBoard} from '../discussion-board.mjs';
import {discussionBoardHTML} from './fixtures/discussion-board.mjs';

export async function discussionBoardBrowserCases(t,context,root){
  let sequence=0;
  async function setup(options={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/discussion-board');await page.setContent(discussionBoardHTML(options));
    const store=await new Store(path.join(root,'discussion-'+(++sequence)),{env:{}}).load(),engine=new Automation(store),task={id:'discussion-'+sequence,courseId:'discussion-book',unitId:'discussion-unit',unitLabel:'Unit 1',entryKey:JSON.stringify(['discussion-unit',['Active reading','Before you read'],'Before you read']),status:'running',answered:0,pages:0,logs:[],manualItems:[]};store.data.tasks=[task];engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);engine.askModel=async()=>assert.fail('discussion publication must never request AI');
    return {page,store,engine,task,signal:new AbortController().signal,settings:{aiEnabled:false,autoSubmit:true},cleanup:async()=>{await page.close().catch(()=>{});await store.flush();}};
  }
  for(const options of [{},{editable:true},{ghost:true},{customButton:true,enableDelay:250},{mountDelay:1400},{draft:'1'}])await t.test(`discussion publishes literal 1 exactly once without touching reply or notes: ${JSON.stringify(options)}`,async()=>{
    const f=await setup(options);try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.discussionDone,true,result.message);assert.equal(f.task.answered,1);assert.equal(f.task.pages,1);assert.deepEqual(await f.page.evaluate(()=>window.values),['1']);assert.equal(await f.page.evaluate(()=>window.replyClicks),0);assert.equal(await f.page.locator('#reply').inputValue(),'');assert.equal(await f.page.locator('#notes').inputValue(),'A private note.');assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('an iframe discussion publishes to its own primary composer only',async()=>{
    const f=await setup();let handle;try{
      await f.page.setContent('<iframe src="https://ucontent.unipus.cn/offline-recognition/discussion-frame" style="width:1000px;height:800px"></iframe>');await f.page.frameLocator('iframe').locator('body').waitFor();handle=await f.page.locator('iframe').elementHandle();const frame=await handle.contentFrame();await frame.setContent(discussionBoardHTML({editable:true}));
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.discussionDone,true,result.message);assert.deepEqual(await frame.evaluate(()=>window.values),['1']);assert.equal(await frame.evaluate(()=>window.replyClicks),0);assert.equal(f.store.data.bank.length,0);
    }finally{await handle?.dispose();await f.cleanup();}
  });
  await t.test('a formerly manual discussion is retried once, waits for directory confirmation and never becomes a bank answer',async()=>{
    const f=await setup({delay:180});try{
      await f.store.rememberManualEntry(f.task,{},'no-fillable-questions','question-controls-v3');
      const entry={key:f.task.entryKey,title:'Before you read',path:['Active reading','Before you read'],required:true,pending:true,completed:false};let polls=0,captured,done=false;
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())done=await f.page.evaluate(()=>window.done);if(done)polls++;const completed=done&&polls>=3;f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:f.task.unitId,entries:[{...entry,completed,pending:!completed}]};};
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
      const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{captured=await page.evaluate(()=>window.values);return release(page,options);};
      await f.engine.runTask(f.task,{},f.settings,f.signal);assert.equal(f.task.status,'completed');assert.equal(f.task.requiredCompleted,1);assert.equal(f.store.data.bank.length,0);assert.equal(f.store.data.manualEntryMarks.length,0);assert.deepEqual(captured,['1']);assert.ok(polls>=3);
    }finally{await f.cleanup();}
  });
  await t.test('an unmounted discussion SDK pauses for loading and never becomes a remembered no-question leaf',async()=>{
    const f=await setup({neverMount:true});try{
      const wait=f.engine.waitQuestions.bind(f.engine);f.engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:1600});
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.review,true);assert.notEqual(result.manual,true);assert.match(result.message,/仍在加载/);assert.equal(await f.page.evaluate(()=>window.publishes),0);assert.equal(f.store.data.manualEntryMarks.length,0);
    }finally{await f.cleanup();}
  });
  for(const options of [{draft:'An unfinished answer.'},{mixed:true},{duplicates:true}])await t.test(`discussion preserves ambiguous or drafted content without publishing: ${JSON.stringify(options)}`,async()=>{
    const f=await setup(options);try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.review,true);assert.equal(await f.page.evaluate(()=>window.publishes),0);assert.equal(await f.page.locator('#comment').inputValue(),options.draft||'');assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('manual-submit mode fills 1 and leaves publishing to the user',async()=>{
    const f=await setup();try{const result=await f.engine.answerEntryAttempt(f.task,f.page,{...f.settings,autoSubmit:false},f.signal);assert.equal(result.review,true);assert.equal(await f.page.locator('#comment').inputValue(),'1');assert.equal(await f.page.evaluate(()=>window.publishes),0);}finally{await f.cleanup();}
  });
  await t.test('an unconfirmed publish retains its draft and never automatically clicks again',async()=>{
    const f=await setup({failed:true});try{
      const board=await readDiscussionBoard(f.engine,f.page),result=await completeDiscussionBoard(f.engine,f.task,f.page,board,f.settings,f.signal,{timeout:350,pollMs:50});assert.equal(result.review,true);assert.equal(await f.page.evaluate(()=>window.publishes),1);assert.equal(await f.page.locator('#comment').inputValue(),'1');assert.equal(f.task.answered,0);
    }finally{await f.cleanup();}
  });
  await t.test('stopping after a comment is filled keeps the draft and prevents publication',async()=>{
    const f=await setup(),controller=new AbortController();try{
      const action=f.engine.action.bind(f.engine);f.engine.action=async(...args)=>{controller.abort();return action(...args);};await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),{name:'AbortError'});assert.equal(await f.page.evaluate(()=>window.publishes),0);assert.equal(await f.page.locator('#comment').inputValue(),'1');
    }finally{await f.cleanup();}
  });
  await t.test('a discussion topic change while filling blocks publication without overwriting the new page',async()=>{
    const f=await setup();try{
      await f.page.locator('#comment').evaluate(el=>el.addEventListener('input',()=>{document.querySelector('.discussion-title').textContent='A different discussion task.';}));const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.review,true);assert.equal(await f.page.evaluate(()=>window.publishes),0);
    }finally{await f.cleanup();}
  });
}
