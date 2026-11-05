import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {performAnswerAction} from '../lesson-actions.mjs';
import {lessonBlockerHTML,blockerAnswers} from './fixtures/lesson-blocker.mjs';

export async function lessonActionsBrowserCases(t,context,root){
  let sequence=0;
  async function setup(options={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/lesson-blocker');await page.setContent(lessonBlockerHTML(options));
    const store=await new Store(path.join(root,'action-'+(++sequence)),{env:{}}).load(),engine=new Automation(store),task={id:'action-'+sequence,courseId:'action-book',unitId:'action-unit',unitLabel:'Unit 2',entryKey:JSON.stringify(['action-unit',['Language focus'],'Exercise 1']),status:'running',answered:0,pages:0,logs:[],manualItems:[]};store.data.tasks=[task];store.apiKey='fixture-key';engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);
    let calls=0;engine.askModel=async question=>{calls++;return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
    return {page,store,engine,task,calls:()=>calls,settings:{aiEnabled:true,autoSubmit:true},cleanup:async()=>{await page.close().catch(()=>{});await store.flush();}};
  }
  const addSiblingMask=page=>page.evaluate(()=>{
    const wrap=document.querySelector('.ant-modal-wrap'),root=document.createElement('div'),mask=document.createElement('div');
    root.className='ant-modal-root';mask.className='ant-modal-mask';mask.style.cssText='position:fixed;inset:0;z-index:999;background:#0006;pointer-events:auto!important';
    wrap.before(root);root.append(mask,wrap);
  });
  for(const mode of ['ghost','study'])await t.test(`a ${mode} Ant portal with a sibling mask permits prepared answers and restores both pointer styles`,async()=>{
    const f=await setup({mode,late:false});try{
      await addSiblingMask(f.page);
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.feedback?.summary,true);assert.equal(f.calls(),1);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.acks),mode==='study'?1:0);
      assert.deepEqual(await f.page.locator('.ant-modal-wrap,.ant-modal-mask').evaluateAll(els=>els.map(el=>({value:el.style.getPropertyValue('pointer-events'),priority:el.style.getPropertyPriority('pointer-events')}))),[{value:'auto',priority:'important'},{value:'',priority:''}]);
      assert.equal(await f.page.locator('[data-ustudy-modal-operation]').count(),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.cleanup();}
  });
  await t.test('an active dialog behind its sibling mask blocks answers without acknowledging an unrelated confirmation',async()=>{
    const f=await setup({mode:'active',late:false,keep:true});try{
      await addSiblingMask(f.page);await f.page.locator('.ant-modal-wrap').evaluate(wrap=>{wrap.style.pointerEvents='none';wrap.querySelector('.ant-modal').style.pointerEvents='auto';});
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit'),error=>error.code==='LESSON_ACTION_BLOCKED'&&/确认清空/.test(error.message));
      assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.pointerEvents),'auto');
    }finally{await f.cleanup();}
  });
  for(const mode of ['reopen','stop'])await t.test(`a sibling mask is restored when a released portal must ${mode} before dispatch`,async()=>{
    const f=await setup({mode:'ghost',late:false,keep:true}),controller=new AbortController();let triggered=false;try{
      await addSiblingMask(f.page);
      const checkpoint=f.engine.checkpoint.bind(f.engine);f.engine.checkpoint=async signal=>{
        await checkpoint(signal);if(!triggered&&await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.pointerEvents==='none')){
          triggered=true;if(mode==='stop')controller.abort(new Error('stop-sibling-mask'));
          else await f.page.locator('.ant-modal').evaluate(el=>{el.style.display='block';el.setAttribute('aria-hidden','false');});
        }signal?.throwIfAborted();
      };
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit','',{signal:controller.signal}),error=>mode==='stop'?/stop-sibling-mask/.test(error.message):error.code==='LESSON_ACTION_BLOCKED');
      assert.equal(triggered,true);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
      assert.equal(await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.getPropertyValue('pointer-events')),'auto');assert.equal(await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.getPropertyPriority('pointer-events')),'important');assert.equal(await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents),'');
    }finally{controller.abort();await f.cleanup();}
  });
  for(const kind of ['unassociated','ambiguous','foreign-content'])await t.test(`an ${kind} mask remains an unknown blocker and keeps its pointer style`,async()=>{
    const f=await setup({mode:'ghost',late:false,keep:true});try{
      await addSiblingMask(f.page);await f.page.evaluate(kind=>{
        const root=document.querySelector('.ant-modal-root'),mask=root.querySelector('.ant-modal-mask');
        if(kind==='unassociated')document.body.append(mask);else if(kind==='ambiguous')root.append(root.querySelector('.ant-modal-wrap').cloneNode(true));else{const button=document.createElement('button');button.textContent='确认其他操作';root.append(button);}
        mask.style.zIndex='1100';
      },kind);
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit'),error=>error.code==='LESSON_ACTION_BLOCKED');
      assert.equal(await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.pointerEvents),'auto');assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.cleanup();}
  });
  for(const iframe of [false,true])await t.test(`a sibling mask permits a background lesson input without taking focus${iframe?' through an ancestor iframe':''}`,async()=>{
    const f=await setup({mode:'ghost',late:false,keep:true});let home;try{
      await addSiblingMask(f.page);let frame=f.page.mainFrame(),selector='#blank-0';
      if(iframe){await f.page.evaluate(()=>{const child=document.createElement('iframe');child.style.cssText='width:500px;height:250px';document.querySelector('#exercise').replaceWith(child);});const handle=await f.page.locator('iframe').elementHandle();frame=await handle.contentFrame();await frame.setContent('<input id="child-answer" type="text">');selector='#child-answer';await handle.dispose();}
      home=await context.newPage();await home.goto('https://ucontent.unipus.cn/offline-recognition/home');await home.bringToFront();
      await performAnswerAction(f.engine,frame,selector,()=>frame.locator(selector).fill('prepared answer',{timeout:3000}));
      assert.equal(await frame.locator(selector).inputValue(),'prepared answer');assert.equal(await home.evaluate(()=>document.hasFocus()),true);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.locator('.ant-modal-mask').evaluate(el=>el.style.pointerEvents),'auto');assert.equal(await f.page.locator('[data-ustudy-modal-operation]').count(),0);
    }finally{await home?.close();await f.cleanup();}
  });
  for(const mode of ['ghost','empty','study'])await t.test(`a late ${mode} modal does not lose ten committed answers or repeat AI before submission`,async()=>{
    const f=await setup({mode});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(f.task.logs));assert.equal(f.calls(),1);assert.equal(f.task.answered,1);assert.equal(f.task.pages,1);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.evaluate(()=>window.acks),mode==='study'?1:0);
    }finally{await f.cleanup();}
  });
  for(const count of [2,4])await t.test(`${count} stacked closed modal portals allow the next action after one AI request and restore their pointer styles`,async()=>{
    const f=await setup({mode:'ghost',late:false,keep:true});try{
      await f.page.evaluate(count=>{
        const original=document.querySelector('.ant-modal-wrap');
        for(let i=1;i<count;i++){const clone=original.cloneNode(true);clone.style.zIndex=String(1000+i);document.body.append(clone);}
        document.querySelector('#submit').textContent='下一题';
      },count);
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.nextPage,true);assert.equal(f.calls(),1);assert.equal(f.task.answered,1);assert.equal(f.task.pages,1);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
      await f.page.waitForFunction(()=>[...document.querySelectorAll('.ant-modal-wrap')].every(el=>el.style.pointerEvents===''));
      assert.equal(await f.page.locator('.ant-modal-wrap').count(),count);
    }finally{await f.cleanup();}
  });
  for(const mode of ['slow','acknowledgement'])await t.test(`four closed portals stay released throughout ${mode} checkpoints and are restored after the action`,async()=>{
    const f=await setup({late:false,mode:'ghost',keep:true});try{
      await f.page.evaluate(()=>{const original=document.querySelector('.ant-modal-wrap');for(let index=1;index<4;index++){const clone=original.cloneNode(true);clone.style.zIndex=String(1000+index);document.body.append(clone);}const helper=document.createElement('button');helper.id='checkpoint-ack';helper.textContent='我知道了';helper.onclick=()=>window.checkpointAcks=(window.checkpointAcks||0)+1;document.body.append(helper);});
      const checkpoint=f.engine.checkpoint.bind(f.engine);let released=false,pauses=0;
      f.engine.checkpoint=async signal=>{await checkpoint(signal);const count=await f.page.evaluate(()=>[...document.querySelectorAll('.ant-modal-wrap')].filter(el=>el.style.pointerEvents==='none').length);if(count<4)released=false;if(count===4&&!released){released=true;pauses++;if(mode==='slow')await sleep(5500,undefined,{signal});else await f.page.evaluate(()=>document.querySelector('#checkpoint-ack').click());}};
      assert.equal(await f.engine.action(f.page.mainFrame(),'submit'),true);assert.equal(pauses,1);assert.equal(await f.page.evaluate(()=>window.submissions.length),1);assert.equal(await f.page.locator('[data-ustudy-modal-operation]').count(),0);assert.equal(await f.page.evaluate(()=>[...document.querySelectorAll('.ant-modal-wrap')].every(el=>el.style.pointerEvents==='')),true);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.cleanup();}
  });
  await t.test('stopping with released portals restores only that operation and dispatches no lesson click',async()=>{
    const f=await setup({late:false,mode:'ghost',keep:true}),controller=new AbortController();try{
      await f.page.evaluate(()=>{const original=document.querySelector('.ant-modal-wrap');for(let index=1;index<4;index++){const clone=original.cloneNode(true);clone.style.zIndex=String(1000+index);document.body.append(clone);}const unrelated=document.createElement('div');unrelated.id='unrelated-pointer-style';unrelated.style.pointerEvents='none';document.body.append(unrelated);});
      const checkpoint=f.engine.checkpoint.bind(f.engine);f.engine.checkpoint=async signal=>{await checkpoint(signal);if(await f.page.evaluate(()=>[...document.querySelectorAll('.ant-modal-wrap')].filter(el=>el.style.pointerEvents==='none').length===4))controller.abort(new Error('stop-modal-repair'));signal?.throwIfAborted();};
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit','',{signal:controller.signal}),/stop-modal-repair/);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.locator('[data-ustudy-modal-operation]').count(),0);assert.equal(await f.page.evaluate(()=>[...document.querySelectorAll('.ant-modal-wrap')].every(el=>el.style.pointerEvents==='')),true);assert.equal(await f.page.locator('#unrelated-pointer-style').evaluate(el=>el.style.pointerEvents),'none');
    }finally{await f.cleanup();}
  });
  await t.test('a modal reopening during a released operation restores interception before any lesson click',async()=>{
    const f=await setup({late:false,mode:'ghost',keep:true});let reopened=false;try{
      const checkpoint=f.engine.checkpoint.bind(f.engine);f.engine.checkpoint=async signal=>{await checkpoint(signal);if(!reopened&&await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents==='none')){reopened=true;await f.page.locator('.ant-modal').evaluate(modal=>{modal.style.display='block';modal.setAttribute('aria-hidden','false');});}};
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit'),error=>error.code==='LESSON_ACTION_BLOCKED');assert.equal(reopened,true);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.locator('.ant-modal-wrap').evaluate(el=>el.style.pointerEvents),'');assert.equal(await f.page.locator('[data-ustudy-modal-operation]').count(),0);assert.equal(await f.page.locator('.ant-modal').isVisible(),true);
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
  await t.test('stacked ancestor-frame closed modals are released before clicking the lesson button inside its iframe',async()=>{
    const f=await setup({mode:'ghost',late:true,keep:true});try{
      await f.page.evaluate(()=>{document.body.innerHTML='<iframe src="https://ucontent.unipus.cn/offline-recognition/action-frame" style="width:500px;height:300px"></iframe>';});const handle=await f.page.locator('iframe').elementHandle(),frame=await handle.contentFrame();await frame.setContent('<button id="submit" onclick="window.submits=(window.submits||0)+1">提交</button>');await f.page.evaluate(()=>window.showBlocker());
      await f.page.evaluate(()=>{const original=document.querySelector('.ant-modal-wrap');for(let i=1;i<4;i++){const clone=original.cloneNode(true);clone.style.zIndex=String(1000+i);document.body.append(clone);}});
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
  await t.test('a visible confirmation below four closed portals still blocks the lesson action',async()=>{
    const f=await setup({mode:'active',late:false,keep:true});try{
      await f.page.evaluate(()=>{
        const original=document.querySelector('.ant-modal-wrap');original.id='active-confirmation';
        for(let i=1;i<=4;i++){
          const clone=original.cloneNode(true);clone.removeAttribute('id');clone.style.zIndex=String(1000+i);clone.querySelector('.ant-modal').style.display='none';document.body.append(clone);
        }
      });
      await assert.rejects(f.engine.action(f.page.mainFrame(),'submit'),error=>error.code==='LESSON_ACTION_BLOCKED');
      assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.locator('#active-confirmation').evaluate(el=>el.style.pointerEvents),'');assert.equal(await f.page.locator('#active-confirmation .ant-modal').isVisible(),true);
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
