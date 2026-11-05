import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Automation} from '../automation.mjs';
import * as Core from '../shared/core.mjs';
import {answerBlockerHTML,answerBlockerAnswers} from './fixtures/answer-blocker.mjs';

export async function answerBlockerBrowserCases(t,context){
  async function setup({mode='study',kind='custom',iframe=false,event='pointerenter',index=0}={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/answer-blocker');await page.setContent(answerBlockerHTML({mode,kind}));let frame=page.mainFrame();
    if(iframe){await page.route('**/answer-blocker-child',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:answerBlockerHTML({mode,kind})}));await page.evaluate(()=>document.body.innerHTML='<div style="height:220px">Parent</div><iframe src="https://ucontent.unipus.cn/offline-recognition/answer-blocker-child" style="width:850px;height:700px"></iframe>');frame=page.frames().find(item=>item.url().endsWith('/answer-blocker-child'))||await page.waitForEvent('framenavigated',{predicate:item=>item.url().endsWith('/answer-blocker-child')});}
    await frame.locator('#submit').waitFor();await page.mouse.move(0,0);
    const task={id:'answer-blocker',status:'running',courseId:'book',unitId:'unit',entryKey:JSON.stringify(['unit',['Language in focus'],'Collocations']),logs:[],answered:0,pages:0,manualItems:[]},store={directory:'.cache',apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(store);
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);let calls=0;
    engine.askModel=async question=>{const answer=answerBlockerAnswers[calls++];return Core.parseModelAnswer(JSON.stringify({answers:[answer]}),question);};
    const fill=engine.fillQuestion.bind(engine);let armed=false;
    engine.fillQuestion=async(...args)=>{if(!armed){armed=true;const selector=kind==='text'?'#answer-'+index:index===1?'#q1o0':'#q0o1';await frame.evaluate(({selector,event,parent})=>window.armBlocker(selector,event,parent),{selector,event,parent:iframe});}return fill(...args);};
    return {page,frame,engine,task,calls:()=>calls,settings:{aiEnabled:true,autoSubmit:true}};
  }
  for(const options of [{},{kind:'native'},{mode:'ghost'},{iframe:true},{iframe:true,kind:'native'},{kind:'text',mode:'ghost',event:'blur'},{event:'click'}])await t.test(`a late notice interrupts an answer control and resumes the prepared four answers: ${JSON.stringify(options)}`,async()=>{
    const f=await setup(options);try{
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify({message:result.message,logs:f.task.logs}));assert.equal(f.calls(),4);assert.equal(f.task.answered,4);assert.equal(f.task.pages,1);assert.deepEqual(await f.frame.evaluate(()=>window.submissions),[answerBlockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await (options.iframe?f.page:f.frame).evaluate(()=>window.acks),options.mode==='ghost'?0:1);
      if(options.kind==='text')assert.deepEqual(await f.frame.evaluate(()=>window.fieldWrites),[1,1,1,1]);
      else{const clicks=await f.frame.evaluate(()=>window.selectionClicks);assert.deepEqual(clicks.map(item=>item.answer),answerBlockerAnswers);assert.ok(clicks.every(item=>item.trusted));}
    }finally{await f.page.close();}
  });
  await t.test('a study notice appearing after the final answer checkpoint is freshly identified before reporting a blocked answer',async()=>{
    const f=await setup({kind:'text',event:'never-fired'});try{
      const fill=f.engine.fillQuestion.bind(f.engine),gate=f.engine.gate.bind(f.engine);let armed=false;
      f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      f.engine.fillQuestion=async(...args)=>{
        if(!armed){armed=true;await f.frame.evaluate(()=>{
          const hit=document.elementFromPoint.bind(document);let shown=false;
          document.elementFromPoint=(x,y)=>{const target=hit(x,y);if(!shown&&target?.id==='answer-0'){
            shown=true;window.showBlocker();const wrap=document.querySelector('.ant-modal-wrap'),dialog=wrap.querySelector('.ant-modal');dialog.className='system-info-cloud-modal';dialog.setAttribute('role','alertdialog');wrap.querySelector('#ack').onclick=()=>{window.acks++;wrap.remove();};
          }return hit(x,y);};
        });}return fill(...args);
      };
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(result));assert.equal(f.calls(),4);assert.equal(f.task.answered,4);assert.equal(await f.frame.evaluate(()=>window.acks),1);assert.deepEqual(await f.frame.evaluate(()=>window.fieldWrites),[1,1,1,1]);assert.deepEqual(await f.frame.evaluate(()=>window.submissions),[answerBlockerAnswers]);assert.ok(f.task.logs.some(log=>/操作受阻后已自动关闭学习提示/.test(log.message)));
    }finally{await f.page.close();}
  });
  await t.test('a blocked submit checks and closes the fresh study notice before retrying with all prepared answers',async()=>{
    const f=await setup({kind:'text',event:'never-fired'});try{
      const action=f.engine.action.bind(f.engine),gate=f.engine.gate.bind(f.engine);let attempts=0;
      f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      f.engine.action=async(frame,kind,...args)=>{if(kind==='submit'&&++attempts===1){await f.frame.evaluate(()=>window.showBlocker());throw Object.assign(new Error('提交被学习提示遮挡'),{code:'LESSON_ACTION_BLOCKED'});}return action(frame,kind,...args);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(result));assert.equal(attempts,2);assert.equal(f.calls(),4);assert.equal(await f.frame.evaluate(()=>window.acks),1);assert.deepEqual(await f.frame.evaluate(()=>window.fieldWrites),[1,1,1,1]);assert.deepEqual(await f.frame.evaluate(()=>window.submissions),[answerBlockerAnswers]);
    }finally{await f.page.close();}
  });
  await t.test('recovery observes an already committed submission without clicking submit or asking AI again',async()=>{
    const f=await setup({event:'never-fired'});try{
      const action=f.engine.action.bind(f.engine),gate=f.engine.gate.bind(f.engine);let attempts=0;
      f.engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      f.engine.action=async(frame,kind,...args)=>{const result=await action(frame,kind,...args);if(kind==='submit'&&++attempts===1)throw Object.assign(new Error('提交后遮挡检查需要恢复'),{code:'LESSON_ACTION_BLOCKED'});return result;};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(result));assert.equal(attempts,1);assert.equal(f.calls(),4);assert.deepEqual(await f.frame.evaluate(()=>window.submissions),[answerBlockerAnswers]);
    }finally{await f.page.close();}
  });
  await t.test('a foreign confirmation during answer entry waits in review, then resumes the current operation without another AI call',async()=>{
    const f=await setup({mode:'active',index:1}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);const deadline=Date.now()+12000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');assert.equal(f.calls(),4);assert.equal(f.task.answered,1);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.doesNotMatch(f.task.logs.at(-1).message,/Call log|locator\.click|\u001b/);
      await f.page.locator('#close-modal').click();f.engine.controlTask(f.task.id,'resume');const result=await pending;assert.equal(result.feedback.summary,true);assert.equal(f.calls(),4);assert.deepEqual(await f.frame.evaluate(()=>window.submissions),[answerBlockerAnswers]);assert.deepEqual((await f.frame.evaluate(()=>window.selectionClicks)).map(item=>item.answer),answerBlockerAnswers);
    }finally{controller.abort();await pending?.catch(()=>{});await f.page.close();}
  });
  await t.test('stopping during an answer-control modal review retains the first committed choice without later writes or submit',async()=>{
    const f=await setup({mode:'active',index:1}),controller=new AbortController();let pending;
    try{
      pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);const deadline=Date.now()+12000;while(f.task.status!=='review'&&Date.now()<deadline)await sleep(50);assert.equal(f.task.status,'review');controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.calls(),4);assert.deepEqual((await f.frame.evaluate(()=>window.selectionClicks)).map(item=>item.answer),['track']);assert.equal(await f.frame.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal((await f.engine.pages.release(f.page)).status,'retained');
    }finally{controller.abort();await pending?.catch(()=>{});await f.page.close();}
  });
}
