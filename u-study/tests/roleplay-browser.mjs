import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {readRoleplay,readRoleplayFromDOM,completeRoleplay} from '../roleplay.mjs';
import {oralTestWave} from './fixtures/oral-retell.mjs';
import {roleplayHTML} from './fixtures/roleplay.mjs';

export async function roleplayBrowserCases(t,context,root){
  let sequence=0;
  async function setup(options={}){
    const page=await context.newPage(),url='https://ucontent.unipus.cn/offline-roleplay/'+Math.random();await page.route(url,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:roleplayHTML(options)}));await page.goto(url);
    const store=await new Store(path.join(root,'roleplay-'+(++sequence)),{env:{}}).load(),task={id:'roleplay-'+sequence,courseId:'roleplay-book',unitId:'roleplay-unit',unitLabel:'Unit 1',entryKey:JSON.stringify(['roleplay-unit',['Inside view','Conversation','Conversation 1'],'Oral practice']),status:'running',logs:[],answered:0,pages:0,manualItems:[]},engine=new Automation(store);store.data.tasks=[task];engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);
    let synthesized=0;engine.oralSpeech={synthesize:async()=>{synthesized++;return {bytes:oralTestWave(1),voice:'fixture'};}};engine.askModel=async()=>assert.fail('roleplay must not call AI');
    return {engine,task,page,store,settings:{autoSubmit:true,aiEnabled:false},signal:new AbortController().signal,synthesized:()=>synthesized,cleanup:async()=>{await page.close().catch(()=>{});await store.flush();}};
  }
  for(const legacy of [false,true])await t.test(`A role dialogue completes six zero-score recordings once using cached ${legacy?'legacy':'modern'} input, without replay or physical microphone permission`,async()=>{
    const f=await setup({count:6,legacy});try{
      const before=await f.page.evaluate(readRoleplayFromDOM);assert.equal(before.phase,'choose');assert.equal(before.roleName,'Kate');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);if(!result.roleplayDone)console.error(JSON.stringify({dom:await f.page.evaluate(()=>({finished:window.finished,footer:document.querySelector('footer')?.outerHTML,scores:[...document.querySelectorAll('.score')].map(el=>({text:el.textContent,visible:getComputedStyle(el).visibility})),alerts:[...document.querySelectorAll('[role=alert]')].map(el=>el.textContent)})),read:await f.page.evaluate(readRoleplayFromDOM)}));assert.equal(result.roleplayDone,true,JSON.stringify({result,logs:f.task.logs}));
      const observed=await f.page.evaluate(()=>({choices:window.roleChoices,starts:window.starts,stops:window.stops,duplicates:window.duplicates,saved:window.saved,requests:window.requests,replays:window.replays,speakers:window.speakers,submitted:window.submitted,clean:!window.__ustudyRoleplayInput&&!window.__ustudyOralReservation}));
      assert.equal(observed.choices,1);assert.equal(observed.starts,1);assert.deepEqual(observed.stops,[0,2,4,6,8,10]);assert.equal(observed.duplicates,0);assert.equal(observed.saved.length,6);assert.ok(observed.saved.every(item=>item.bytes>100));assert.equal(observed.requests,6);assert.equal(observed.replays,0);assert.equal(observed.speakers,0);assert.equal(observed.submitted,true);assert.equal(observed.clean,true);assert.equal(f.synthesized(),1);assert.equal(f.task.answered,6);assert.equal(f.store.data.bank.length,0);assert.equal(await f.page.evaluate(async()=>(await navigator.permissions.query({name:'microphone'})).state),'prompt');
    }finally{await f.cleanup();}
  });
  await t.test('a delayed role selection transition waits for the dialogue without choosing A twice',async()=>{
    const f=await setup({count:2,choiceDelay:1200});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.roleplayDone,true,result.message);
      assert.deepEqual(await f.page.evaluate(()=>({choices:window.roleChoices,starts:window.starts,saved:window.saved.length,stops:window.stops,duplicates:window.duplicates,submitted:window.submitted})),{choices:1,starts:1,saved:2,stops:[0,2],duplicates:0,submitted:true});
      assert.ok(f.task.logs.some(log=>/已点击 A，等待/.test(log.message)));assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('a previously manual roleplay retries once and waits for the real directory before completion',async()=>{
    const f=await setup({count:2});let completed=false,polls=0,captured;
    try{
      await f.store.rememberManualEntry(f.task,{},'no-fillable-questions','question-controls-v4');const entry={key:f.task.entryKey,title:'Oral practice',path:['Inside view','Conversation','Conversation 1'],required:true,pending:true,completed:false};
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed()&&await f.page.evaluate(()=>window.submitted))polls++;completed ||= polls>=3;f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:f.task.unitId,entries:[{...entry,completed,pending:!completed}]};};
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{captured=await page.evaluate(()=>window.stops);return release(page,options);};
      await f.engine.runTask(f.task,{},f.settings,f.signal);assert.equal(f.task.status,'completed');assert.deepEqual(captured,[0,2]);assert.equal(f.store.data.manualEntryMarks.length,0);assert.equal(f.store.data.bank.length,0);assert.ok(polls>=3);
    }finally{await f.cleanup();}
  });
  await t.test('an upload failure pauses the whole session and retains the lesson without submitting',async()=>{
    const f=await setup({uploadFailure:true});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.review,true);assert.match(result.message,/上传失败/);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(await f.page.evaluate(()=>window.pauses),1);assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('cancelling during an active line pauses the dialogue before restoring microphone functions',async()=>{
    const f=await setup({count:4}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);await f.page.waitForFunction(()=>window.recording);controller.abort();await assert.rejects(pending,{name:'AbortError'});await f.page.waitForTimeout(400);
      assert.equal(await f.page.evaluate(()=>window.recording),false);assert.equal(await f.page.evaluate(()=>window.pauses),1);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(await f.page.evaluate(()=>!window.__ustudyRoleplayInput&&!window.__ustudyOralReservation),true);assert.equal(await f.page.evaluate(async()=>(await navigator.permissions.query({name:'microphone'})).state),'prompt');
    }finally{controller.abort();await pending?.catch(()=>{});await f.cleanup();}
  });
  await t.test('an already recorded dialogue does not start, replay or overwrite its zero scores',async()=>{
    const f=await setup({existing:true,count:2});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,{...f.settings,autoSubmit:false},f.signal);assert.equal(result.roleplayDone,true,result.message);assert.equal(f.synthesized(),0);assert.equal(await f.page.evaluate(()=>window.starts+window.replays+window.roleChoices),0);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.cleanup();}
  });
  await t.test('mixed roleplay answer fields are preserved without starting or synthesizing',async()=>{
    const f=await setup({mixed:true});try{
      await f.page.locator('#role-a').click();const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.review,true);assert.equal(f.synthesized(),0);assert.equal(await f.page.evaluate(()=>window.starts),0);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.cleanup();}
  });
  await t.test('a partner-first dialogue waits for partner audio and only ends A-role lines',async()=>{
    const f=await setup({count:2,partnerFirst:true});try{const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.roleplayDone,true,result.message);assert.deepEqual(await f.page.evaluate(()=>window.stops),[1,3]);assert.equal(await f.page.evaluate(()=>window.starts),1);assert.equal(await f.page.evaluate(()=>window.speakers+window.replays+window.duplicates),0);}finally{await f.cleanup();}
  });
  await t.test('paused partner audio after five saved lines resumes in place without restarting or replaying the dialogue',async()=>{
    const f=await setup({count:6,partnerPauseAt:9});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);assert.equal(result.roleplayDone,true,result.message);
      const observed=await f.page.evaluate(()=>({starts:window.starts,saved:window.saved.length,stops:window.stops,duplicates:window.duplicates,pauses:window.pauses,speakers:window.speakers,replays:window.replays,submitted:window.submitted}));
      assert.deepEqual(observed,{starts:1,saved:6,stops:[0,2,4,6,8,10],duplicates:0,pauses:0,speakers:0,replays:0,submitted:true});
      assert.equal(f.task.logs.filter(log=>/从当前位置恢复/.test(log.message)).length,1);assert.ok(f.task.logs.some(log=>/已保存 5\/6 句/.test(log.message)));assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('closing the lesson retains the last saved-turn diagnostics instead of reporting a focus error',async()=>{
    const f=await setup({count:6,partnerPauseAt:9});let pending;try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);await f.page.waitForFunction(()=>window.saved.length===5);
      const deadline=Date.now()+5000;while(!f.task.logs.some(log=>/已保存 5\/6 句/.test(log.message))&&Date.now()<deadline)await f.page.waitForTimeout(50);
      assert.ok(f.task.logs.some(log=>/已保存 5\/6 句/.test(log.message)));await f.page.close();
      const result=await pending;assert.equal(result.review,true);assert.match(result.message,/课程窗口已关闭/);assert.ok(f.task.logs.some(log=>/中断.*已保存 5\/6 句/.test(log.message)));assert.equal(f.store.data.bank.length,0);
    }finally{await pending?.catch(()=>{});await f.cleanup();}
  });
  await t.test('a disappearing recording surface stops local audio and retains input isolation instead of falling back to a physical device',async()=>{
    const f=await setup({count:3});let pending;
    try{pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,f.signal);await f.page.waitForFunction(()=>window.recording);await f.page.locator('.question-role-play').evaluate(el=>el.remove());const result=await pending;assert.equal(result.review,true);assert.equal(await f.page.evaluate(()=>!window.__ustudyRoleplayInput&&!!window.__ustudyOralReservation),true);assert.equal(await f.page.evaluate(async()=>{try{await navigator.mediaDevices.getUserMedia({audio:true});return false;}catch{return true;}}),true);assert.equal(await f.page.evaluate(async()=>(await navigator.permissions.query({name:'microphone'})).state),'prompt');assert.ok(f.task.logs.some(log=>/保持输入隔离/.test(log.message)));}
    finally{await pending?.catch(()=>{});await f.cleanup();}
  });
}
