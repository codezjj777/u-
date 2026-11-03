import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {lessonBlockerHTML,blockerAnswers} from './fixtures/lesson-blocker.mjs';

export async function lessonActionsBrowserCases(t,context,root){
  let sequence=0;
  async function setup(options={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/lesson-blocker');await page.setContent(lessonBlockerHTML(options));
    const store=await new Store(path.join(root,'action-'+(++sequence)),{env:{}}).load(),engine=new Automation(store),task={id:'action-'+sequence,courseId:'action-book',unitId:'action-unit',unitLabel:'Unit 2',entryKey:JSON.stringify(['action-unit',['Language focus'],'Exercise 1']),status:'running',answered:0,pages:0,logs:[],manualItems:[]};store.data.tasks=[task];store.apiKey='fixture-key';engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);
    let calls=0;engine.askModel=async question=>{calls++;return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
    return {page,store,engine,task,calls:()=>calls,settings:{aiEnabled:true,autoSubmit:true},cleanup:async()=>{await page.close().catch(()=>{});await store.flush();}};
  }
  for(const mode of ['ghost','empty','study'])await t.test(`a late ${mode} modal does not lose ten committed answers or repeat AI before submission`,async()=>{
    const f=await setup({mode});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(f.task.logs));assert.equal(f.calls(),1);assert.equal(f.task.answered,1);assert.equal(f.task.pages,1);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.evaluate(()=>window.acks),mode==='study'?1:0);
    }finally{await f.cleanup();}
  });
  await t.test('a closed modal reproduces pointer interception, releases the footer and restores interception when it reopens',async()=>{
    const f=await setup({late:false,mode:'ghost',keep:true});try{
      await assert.rejects(f.page.locator('#submit').click({timeout:200}),/intercepts pointer events/);
      assert.equal(await f.engine.action(f.page.mainFrame(),'submit'),true);assert.equal(await f.page.evaluate(()=>window.submissions.length),1);
      await f.page.waitForFunction(()=>getComputedStyle(document.querySelector('.ant-modal-wrap')).pointerEvents!=='none');
      await f.page.locator('.ant-modal').evaluate(modal=>{modal.style.display='block';modal.setAttribute('aria-hidden','false');});await f.page.waitForFunction(()=>getComputedStyle(document.querySelector('.ant-modal-wrap')).pointerEvents!=='none');
      await assert.rejects(f.page.locator('#submit').click({timeout:200}),/intercepts pointer events/);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.cleanup();}
  });
  await t.test('a visible confirmation pauses at submission, and resume reuses the filled values without another AI request',async()=>{
    const f=await setup({mode:'active'}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);
      const deadline=Date.now()+10000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');assert.equal(f.calls(),1);assert.deepEqual(await f.page.locator('#exercise input').evaluateAll(inputs=>inputs.map(input=>input.value)),blockerAnswers);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents),'');const inputs=await f.page.evaluate(()=>window.inputEvents);
      await f.page.locator('#close-modal').click();f.engine.controlTask(f.task.id,'resume');const result=await pending;assert.equal(result.feedback.summary,true);assert.equal(f.calls(),1);assert.equal(await f.page.evaluate(()=>window.inputEvents),inputs);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{controller.abort();await pending?.catch(()=>{});await f.cleanup();}
  });
  await t.test('an ancestor-frame closed modal is released before clicking the lesson button inside its iframe',async()=>{
    const f=await setup({mode:'ghost',late:true,keep:true});try{
      await f.page.evaluate(()=>{document.body.innerHTML='<iframe src="https://ucontent.unipus.cn/offline-recognition/action-frame" style="width:500px;height:300px"></iframe>';});const handle=await f.page.locator('iframe').elementHandle(),frame=await handle.contentFrame();await frame.setContent('<button id="submit" onclick="window.submits=(window.submits||0)+1">提交</button>');await f.page.evaluate(()=>window.showBlocker());
      await assert.rejects(frame.locator('#submit').click({timeout:200}),/intercepts pointer events/);assert.equal(await f.engine.action(frame,'submit'),true);assert.equal(await frame.evaluate(()=>window.submits),1);await handle.dispose();
    }finally{await f.cleanup();}
  });
  await t.test('a closing dialog finishes its transition before the inactive wrapper is released',async()=>{
    const f=await setup({mode:'ghost',late:false,keep:true});try{
      await f.page.locator('.ant-modal').evaluate(modal=>{modal.style.display='block';modal.setAttribute('aria-hidden','false');modal.classList.add('ant-zoom-leave-active');setTimeout(()=>{modal.style.display='none';modal.setAttribute('aria-hidden','true');},450);});
      assert.equal(await f.engine.action(f.page.mainFrame(),'submit'),true);assert.equal(await f.page.evaluate(()=>window.submissions.length),1);assert.equal(await f.page.locator('.ant-modal').evaluate(modal=>getComputedStyle(modal).display),'none');assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.cleanup();}
  });
  await t.test('aria-hidden on an actually painted dialog never authorizes releasing or confirming it',async()=>{
    const f=await setup({mode:'active',late:false,keep:true});try{
      await f.page.locator('.ant-modal').evaluate(modal=>modal.setAttribute('aria-hidden','true'));
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit'),error=>error.code==='LESSON_ACTION_BLOCKED');assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents),'');
    }finally{await f.cleanup();}
  });
  await t.test('manual submission during a modal pause is observed without another submit or AI request',async()=>{
    const f=await setup({mode:'active'}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);const deadline=Date.now()+10000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');
      await f.page.locator('#close-modal').click();await f.page.locator('#submit').click();f.engine.controlTask(f.task.id,'resume');const result=await pending;assert.equal(result.feedback.summary,true);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(f.calls(),1);assert.equal(f.task.answered,1);
    }finally{controller.abort();await pending?.catch(()=>{});await f.cleanup();}
  });
  await t.test('a changed answer during modal review remains untouched and blocks automatic submission on resume',async()=>{
    const f=await setup({mode:'active'}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);let deadline=Date.now()+10000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');
      await f.page.locator('#close-modal').click();await f.page.locator('#blank-2').fill('manually changed');f.engine.controlTask(f.task.id,'resume');
      deadline=Date.now()+10000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');assert.equal(await f.page.locator('#blank-2').inputValue(),'manually changed');assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(f.calls(),1);assert.ok(f.task.logs.some(log=>/提交前复核/.test(log.message)));
    }finally{controller.abort();await pending?.catch(()=>{});await f.cleanup();}
  });
  await t.test('stopping during a modal pause retains the draft and never submits',async()=>{
    const f=await setup({mode:'active'}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);const deadline=Date.now()+10000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.deepEqual(await f.page.locator('#exercise input').evaluateAll(inputs=>inputs.map(input=>input.value)),blockerAnswers);assert.equal(await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents),'');
    }finally{controller.abort();await pending?.catch(()=>{});await f.cleanup();}
  });
}
