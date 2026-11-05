import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {AIRequestError} from '../answer-provider.mjs';
import {readLearningStateFromDOM,findActionInDOM,readStudyNoticesFromDOM} from '../platform-dom.mjs';
import {finishStudyNoticeCloseFromDOM,acknowledgeStudyNoticeFromDOM,performControlAction} from '../lesson-actions.mjs';
import * as Core from '../shared/core.mjs';
import {lessonBlockerHTML,blockerAnswers} from './fixtures/lesson-blocker.mjs';

export async function studyNoticeBrowserCases(t,context){
  async function setup({late=false}={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/study-notice');await page.setContent(lessonBlockerHTML({mode:'study',late}));
    const task={id:'study-notice',status:'running',logs:[],answered:0,pages:0},store={data:{tasks:[task],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store);engine.pages.attach(context);engine.pages.track(page,'lesson');
    return {page,engine,task,settings:{aiEnabled:true,autoSubmit:true}};
  }
  await t.test('a notice arriving just after lesson entry is closed before the first question read or AI request',async()=>{
    const f=await setup({late:true});let calls=0;try{
      await f.page.evaluate(()=>setTimeout(()=>window.showBlocker(),150));
      const read=f.engine.readQuestions.bind(f.engine);f.engine.readQuestions=async(...args)=>{assert.equal(await f.page.evaluate(()=>window.acks),1,'entry notice precedes question reading');return read(...args);};
      f.engine.askModel=async question=>{calls++;assert.equal(await f.page.evaluate(()=>window.acks),1);return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(f.task.logs));assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.page.close();}
  });
  await t.test('a late study notice closes while the original AI request is still pending without requesting another answer',async()=>{
    const f=await setup({late:true});let calls=0;try{
      f.engine.askModel=async(question,_settings,_key,signal,options)=>{calls++;await options.beforeAttempt();await f.page.evaluate(()=>setTimeout(()=>window.showBlocker(),100));await f.page.waitForFunction(()=>window.acks===1,undefined,{timeout:6000});signal.throwIfAborted();assert.equal(await f.page.evaluate(()=>window.inputEvents),0);return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(f.task.logs));assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);assert.deepEqual(await f.page.evaluate(()=>window.submissions),[blockerAnswers]);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.page.close();}
  });
  await t.test('leaving the lesson during a pending AI request cancels it before editing or acknowledging the new page',async()=>{
    const f=await setup({late:true});let calls=0,aborted=false;try{
      f.engine.askModel=async(_question,_settings,_key,signal,options)=>{calls++;await options.beforeAttempt();await f.page.evaluate(()=>setTimeout(()=>{history.replaceState(null,'','/offline-recognition/another-lesson');window.showBlocker();},100));return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/目录项目已切换/);assert.equal(calls,1);assert.equal(aborted,true);assert.equal(await f.page.evaluate(()=>window.acks),0);assert.equal(await f.page.evaluate(()=>window.inputEvents),0);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);
    }finally{await f.page.close();}
  });
  await t.test('entry preflight handles a notice missed by the first loading poll before any questions are read',async()=>{
    const f=await setup();let calls=0;
    try{
      const state=f.engine.readLearningState.bind(f.engine),read=f.engine.readQuestions.bind(f.engine);let first=true;
      f.engine.readLearningState=async(...args)=>{const result=await state(...args);if(first){first=false;return {...result,studyNotice:false};}return result;};
      f.engine.readQuestions=async(...args)=>{assert.equal((await state(f.page)).studyNotice,false);return read(...args);};
      f.engine.askModel=async question=>{calls++;assert.equal(await f.page.evaluate(()=>window.acks),1);return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,JSON.stringify(result));assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);
    }finally{await f.page.close();}
  });
  await t.test('entry preflight also dismisses a study notice before using an already-read question snapshot',async()=>{
    const f=await setup();let calls=0;
    try{
      const initialSnapshot=await f.engine.readQuestions(f.page,f.settings);
      assert.ok(initialSnapshot?.questions?.length);
      f.engine.askModel=async question=>{calls++;assert.equal(await f.page.evaluate(()=>window.acks),1);return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),question);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal,{initialSnapshot});assert.equal(result.feedback?.summary,true,JSON.stringify(result));assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);
    }finally{await f.page.close();}
  });
  await t.test('one guarded operation closes repeated study notices from the front before performing its answer edit once',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{document.querySelector('input').setAttribute('data-notice-test-answer','true');const original=document.querySelector('.ant-modal-wrap');for(let index=1;index<3;index++){const clone=original.cloneNode(true);clone.style.zIndex=String(1000+index);clone.querySelector('#ack').onclick=()=>{window.acks++;clone.remove();};document.body.append(clone);}});
      await performControlAction({checkpoint:async signal=>signal?.throwIfAborted()},f.page.mainFrame(),'answer','[data-notice-test-answer]',locator=>locator.fill('retained answer'),{signal:new AbortController().signal});
      assert.equal(await f.page.evaluate(()=>window.acks),3);assert.equal(await f.page.locator('[data-notice-test-answer]').inputValue(),'retained answer');assert.equal(await f.page.evaluate(()=>window.inputEvents),1);assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);
    }finally{await f.page.close();}
  });
  await t.test('a confirmed study notice can finish a delayed leave-start phase before its answer control is used',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{document.querySelector('input').setAttribute('data-notice-test-answer','true');const style=document.createElement('style');style.textContent='@keyframes delayedNoticeExit{from{opacity:1}to{opacity:0}}.ant-zoom-leave-active{animation:delayedNoticeExit 30s linear paused}';document.head.append(style);const modal=document.querySelector('.ant-modal'),wrap=document.querySelector('.ant-modal-wrap');modal.querySelector('#ack').onclick=()=>{window.acks++;modal.classList.add('ant-zoom-leave','ant-zoom-leave-start','ant-zoom');setTimeout(()=>{modal.classList.remove('ant-zoom-leave-start');modal.classList.add('ant-zoom-leave-active');modal.addEventListener('animationend',event=>{window.nativeNoticeEnd=event.isTrusted;wrap.remove();},{once:true});modal.getAnimations();},2300);};});
      await performControlAction({checkpoint:async signal=>signal?.throwIfAborted()},f.page.mainFrame(),'answer','[data-notice-test-answer]',locator=>locator.fill('retained answer'),{signal:new AbortController().signal});
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await f.page.evaluate(()=>window.nativeNoticeEnd),true);assert.equal(await f.page.locator('[data-notice-test-answer]').inputValue(),'retained answer');assert.equal(await f.page.evaluate(()=>window.inputEvents),1);
    }finally{await f.page.close();}
  });
  await t.test('an unrelated leave-start dialog is retained and never acknowledged as a study notice',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{document.querySelector('input').setAttribute('data-notice-test-answer','true');const modal=document.querySelector('.ant-modal');modal.className='ant-modal ant-zoom-leave ant-zoom-leave-start ant-zoom';modal.innerHTML='<p>确认清空所有答案？</p><button id="danger">确认</button>';modal.querySelector('button').onclick=()=>window.dangerCalls++;});
      await assert.rejects(performControlAction({checkpoint:async signal=>signal?.throwIfAborted()},f.page.mainFrame(),'answer','[data-notice-test-answer]',locator=>locator.fill('unexpected'),{signal:new AbortController().signal}),error=>error.code==='LESSON_ACTION_BLOCKED');assert.equal(await f.page.evaluate(()=>window.dangerCalls),0);assert.equal(await f.page.evaluate(()=>window.inputEvents),0);assert.equal(await f.page.locator('.ant-modal').isVisible(),true);
    }finally{await f.page.close();}
  });
  await t.test('an initial roleless study notice is clicked once and fully dismissed before reading questions or requesting AI',async()=>{
    const f=await setup();let calls=0;
    try{
      await f.page.locator('.ant-modal').evaluate(el=>{el.removeAttribute('role');const loading=document.createElement('div');loading.setAttribute('aria-busy','true');loading.textContent='Loading';document.body.append(loading);const button=el.querySelector('#ack'),original=button.onclick;button.onclick=()=>setTimeout(()=>{original();loading.remove();},180);});
      assert.equal((await f.engine.readLearningState(f.page)).loading,true);
      const read=f.engine.readQuestions.bind(f.engine);f.engine.readQuestions=async(...args)=>{assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);return read(...args);};
      f.engine.askModel=async q=>{calls++;assert.equal(await f.page.evaluate(()=>window.acks),1);return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),q);};
      await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await f.page.evaluate(()=>window.completed),true);assert.ok(f.task.logs.some(log=>/自动确认并关闭/.test(log.message)));
    }finally{await f.page.close();}
  });
  await t.test('a roleless notice appearing during AI is dismissed before any answer is written without a second model request',async()=>{
    const f=await setup({late:true});let calls=0;
    try{
      f.engine.askModel=async q=>{calls++;await f.page.evaluate(()=>{window.showBlocker();document.querySelector('.ant-modal').removeAttribute('role');});return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),q);};
      const fill=f.engine.fillQuestion.bind(f.engine);f.engine.fillQuestion=async(...args)=>{assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);return fill(...args);};
      await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.completed),true);assert.equal(await f.page.evaluate(()=>window.acks),1);
    }finally{await f.page.close();}
  });
  await t.test('a missing-material model reply still dismisses a late study notice and retains existing draft protection without guessing or retrying',async()=>{
    const f=await setup({late:true});let calls=0;
    try{
      f.engine.pages.protect(f.page,'draft');f.engine.askModel=async()=>{calls++;await f.page.evaluate(()=>{window.showBlocker();document.querySelector('.ant-modal').removeAttribute('role');});throw new AIRequestError('材料不足',{code:'AI_MISSING_MATERIAL'});};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await f.page.evaluate(()=>window.inputEvents),0);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(f.engine.pages.records.get(f.page).protected,'draft');assert.equal((await f.engine.pages.release(f.page)).status,'retained');
    }finally{await f.page.close();}
  });
  await t.test('a retained zero-scale study notice is not mistaken for a blocking prompt',async()=>{
    const f=await setup();try{
      await f.page.locator('.ant-modal').evaluate(el=>el.style.transform='scale(0)');
      assert.equal((await f.page.evaluate(readLearningStateFromDOM)).studyNotice,false);
      assert.equal(await f.page.evaluate(findActionInDOM,{kind:'notice'}),null);
      assert.equal(await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal),false);
    }finally{await f.page.close();}
  });
  for(const alreadyClosing of [false,true])await t.test(`a background notice with unavailable innerText and a paused exit animation ${alreadyClosing?'already closing':'normally acknowledged'} is closed by its own animation handler`,async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{
        const style=document.createElement('style');style.textContent='@keyframes noticeExit { from {opacity:1} to {opacity:0} } .ant-zoom-leave-active {animation:noticeExit 30s linear paused}';document.head.append(style);
        const modal=document.querySelector('.ant-modal'),button=modal.querySelector('#ack');Object.defineProperty(button,'innerText',{get:()=>''});
        button.onclick=()=>{window.acks++;modal.classList.add('ant-zoom-leave-active');modal.addEventListener('animationend',()=>{window.closedByAnimation=true;modal.remove();},{once:true});modal.getAnimations();};
      });
      assert.equal((await f.page.evaluate(readLearningStateFromDOM)).studyNotice,true);assert.ok(await f.page.evaluate(findActionInDOM,{kind:'notice'}));
      assert.equal(await f.page.evaluate(finishStudyNoticeCloseFromDOM,{}),0,'an unopened/active dialog is never accelerated');
      if(alreadyClosing)await f.page.locator('#ack').click();
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await f.page.evaluate(()=>window.closedByAnimation),true);assert.equal((await f.page.evaluate(readLearningStateFromDOM)).studyNotice,false);
    }finally{await f.page.close();}
  });
  await t.test('stacked identical study notices are dismissed from the top without the state/action ambiguity of duplicate buttons',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{
        const original=document.querySelector('.ant-modal-wrap'),clone=original.cloneNode(true);clone.style.zIndex='1001';clone.querySelector('#ack').onclick=()=>{window.acks++;clone.remove();};document.body.append(clone);
      });
      assert.equal((await f.page.evaluate(readStudyNoticesFromDOM)).count,2);
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),2);assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);assert.equal(await f.page.evaluate(()=>window.inputEvents),0);
    }finally{await f.page.close();}
  });
  await t.test('an offscreen retained study notice does not block a visible notice or reappear as a false active prompt after it closes',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{const clone=document.querySelector('.ant-modal-wrap').cloneNode(true);clone.style.cssText='left:-20000px;right:auto;width:600px;';document.body.append(clone);});
      const before=await f.page.evaluate(readStudyNoticesFromDOM);assert.equal(before.count,1);assert.equal(before.offscreen,1);
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);assert.equal((await f.page.evaluate(readStudyNoticesFromDOM)).offscreen,1);
    }finally{await f.page.close();}
  });
  await t.test('a replacement study portal appearing during close confirmation is acknowledged before declaring the page clear',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{
        const original=document.querySelector('.ant-modal-wrap'),button=original.querySelector('#ack');button.onclick=()=>{
          window.acks++;original.remove();setTimeout(()=>{const next=original.cloneNode(true);next.querySelector('#ack').onclick=()=>{window.acks++;next.remove();};document.body.append(next);},150);
        };
      });
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),2);assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);
    }finally{await f.page.close();}
  });
  await t.test('study notices in parent and child frames are both closed within the same confirmation instead of waiting on the second',async()=>{
    const f=await setup();try{
      const childReady=f.page.waitForEvent('framenavigated',{predicate:frame=>frame.url().includes('study-notice-child'),timeout:5000});
      await f.page.evaluate(()=>{const iframe=document.createElement('iframe');iframe.style.cssText='width:600px;height:420px';iframe.src='https://ucontent.unipus.cn/offline-recognition/study-notice-child';document.body.prepend(iframe);});
      const child=await childReady;
      assert.ok(child);await child.setContent(lessonBlockerHTML({mode:'study',late:false}));
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await child.evaluate(()=>window.acks),1);assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);
    }finally{await f.page.close();}
  });
  await t.test('a persistent study prompt reports counts and retains the page instead of announcing successful dismissal',async()=>{
    const f=await setup();try{
      await f.page.locator('#ack').evaluate(el=>el.onclick=()=>window.acks++);
      await assert.rejects(f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal,{timeout:350,maxClicks:1}),error=>{assert.match(error.message,/仍有 1 个可见学习提示/);assert.equal(error.noticeDiagnostics[0].count,1);return true;});
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(f.task.logs.some(log=>/已自动确认并关闭/.test(log.message)),false);assert.ok(f.engine.pages.records.get(f.page).protected);
    }finally{await f.page.close();}
  });
  for(const interruptions of [1,2])await t.test(`${interruptions} study-notice close interruption(s) after AI preserve generated answers with review only after the retry fails`,async()=>{
    const f=await setup({late:true});let calls=0,reviews=0,blocked=0;
    try{
      const dismiss=f.engine.dismissStudyNotice.bind(f.engine),gate=f.engine.gate.bind(f.engine);
      f.engine.dismissStudyNotice=async(...args)=>{if(calls&&blocked<interruptions){blocked++;throw Object.assign(new Error('fixture prompt still closing'),{code:'LESSON_ACTION_BLOCKED'});}return dismiss(...args);};
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){reviews++;assert.equal(blocked,2);assert.equal(calls,1);assert.equal(await f.page.evaluate(()=>window.inputEvents),0);task.status='running';}return gate(task,signal);};
      f.engine.askModel=async q=>{calls++;return Core.parseModelAnswer(JSON.stringify({answers:blockerAnswers}),q);};
      await f.engine.answerEntryAttempt(f.task,f.page,{...f.settings,autoSubmit:false},new AbortController().signal);
      assert.equal(reviews,interruptions===1?0:1);assert.equal(blocked,interruptions);assert.equal(calls,1);assert.deepEqual(await f.page.locator('#exercise input').evaluateAll(items=>items.map(el=>el.value)),blockerAnswers);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);
    }finally{await f.page.close();}
  });
  await t.test('current-lesson diagnostics read only the owned task page and never acknowledge, navigate or expose lesson text',async()=>{
    const f=await setup();try{
      f.task.status='failed';f.engine.context=context;f.engine.pages.track(f.page,'lesson',{taskId:f.task.id});const before=await f.page.content();
      const report=await f.engine.inspectCurrentLesson({taskId:f.task.id});assert.equal(report.ready,true);assert.equal(report.written,false);assert.equal(report.submitted,false);assert.equal(report.pages.length,1);assert.equal(report.pages[0].frames[0].count,1);
      assert.equal(await f.page.content(),before);assert.equal(await f.page.evaluate(()=>window.acks),0);assert.equal(JSON.stringify(report).includes(blockerAnswers[0]),false);
      await assert.rejects(f.engine.inspectCurrentLesson({taskId:'unknown-task'}),/对应任务/);
    }finally{await f.page.close();}
  });
  await t.test('a moving study button in a background tab is normally acknowledged without waiting for animation stability or taking focus',async()=>{
    const f=await setup(),observer=await context.newPage();try{
      await observer.goto('https://ucontent.unipus.cn/offline-recognition/notice-focus-observer');await observer.bringToFront();
      await f.page.evaluate(()=>{const style=document.createElement('style');style.textContent='@keyframes noticeMotion {from {transform:translateX(0)} to {transform:translateX(12px)}} .ant-modal {animation:noticeMotion 600ms linear infinite alternate}';document.head.append(style);});
      assert.equal(await observer.evaluate(()=>document.visibilityState),'visible');
      await f.engine.dismissStudyNotice(f.task,f.page,new AbortController().signal);
      assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(await observer.evaluate(()=>document.visibilityState),'visible');assert.equal((await f.engine.readLearningState(f.page)).studyNotice,false);
    }finally{await observer.close();await f.page.close();}
  });
  await t.test('standard notice acknowledgement refuses an unrelated or covered confirmation button',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{const cover=document.createElement('div');cover.id='foreign-dialog';cover.setAttribute('role','dialog');cover.style.cssText='position:fixed;inset:0;z-index:2000;background:white';cover.innerHTML='<p>请接受新的授权协议</p><button id="permission-ack">我知道了</button>';cover.querySelector('button').onclick=()=>window.dangerCalls++;document.body.append(cover);});
      assert.equal(await f.page.evaluate(acknowledgeStudyNoticeFromDOM,{selector:'#ack'}),false);assert.equal(await f.page.evaluate(acknowledgeStudyNoticeFromDOM,{selector:'#permission-ack'}),false);assert.equal(await f.page.evaluate(()=>window.acks+window.dangerCalls),0);
    }finally{await f.page.close();}
  });
}
