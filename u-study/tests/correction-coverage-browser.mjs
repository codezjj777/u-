import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';
import {outlineCorrectionHTML,outlineInitialAnswers,outlineCorrectedAnswers} from './fixtures/outline-correction.mjs';

export async function correctionCoverageBrowserCases(t,context,root){
  const scope={courseId:'outline-book',unitId:'id-outline-tab',entryKey:JSON.stringify(['id-outline-tab',['Active reading','Getting the idea'],'Exercise 1'])};
  let sequence=0;
  async function setup(options={}){
    const store=await new Store(path.join(root,'outline-'+(++sequence)),{env:{}}).load(),engine=new Automation(store),page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/outline-correction');await page.setContent(outlineCorrectionHTML(options));
    const task={...scope,id:'outline-'+sequence,status:'running',unitLabel:'Test Unit',logs:[],answered:0,pages:0,manualItems:[]},entry={key:scope.entryKey,title:'Exercise 1',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false};store.data.tasks=[task];store.apiKey='fixture-key';engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});
    const requests=[];engine.askModel=(question,settings,key,signal,requestOptions)=>askModel(question,settings,key,signal,{...requestOptions,fetchImpl:async(_url,request)=>{
      const payload=JSON.parse(JSON.parse(request.body).messages[1].content);assert.equal(payload.type,'text');assert.equal(payload.blankCount,4);assert.match(payload.passage,/Synthetic reading passage/);requests.push(payload);
      const regressed=['couch potato',outlineInitialAnswers[1],outlineInitialAnswers[2],'mouse potato'];
      const answers=options.regression?(requests.length===1?outlineInitialAnswers:requests.length===2?regressed:options.regression==='refuse'||options.regression==='retry'&&requests.length===3?outlineInitialAnswers:['couch potato',outlineCorrectedAnswers[1],outlineCorrectedAnswers[2],'mouse potato']):options.unchanged||requests.length===1?outlineInitialAnswers:options.outcome==='always-failed'?['couch potatoes','origins '+requests.length,'effects '+requests.length,'mouse potatoes']:outlineCorrectedAnswers;
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers})}}]}));
    }});
    return {store,engine,page,task,entry,requests,settings:{aiEnabled:true,autoSubmit:true,endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'}};
  }
  async function complete(f){
    let capture,completed=false;f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
    f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed=await f.page.evaluate(()=>window.completed);f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...f.entry,completed,pending:!completed}]};};
    const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
    const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{capture=await page.evaluate(()=>({submissions:window.submissions,revisions:window.revisions,continues:window.continues}));return release(page,options);};
    await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);return capture;
  }

  for(const kind of ['text','select'])await t.test(`four ${kind} blanks graded as objective questions revise automatically and are saved as one complete all-correct exercise`,async()=>{
    const f=await setup({kind});let capture;try{
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;let completed=false;
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed=await f.page.evaluate(()=>window.completed);f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...f.entry,completed,pending:!completed}]};};
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
      const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{capture=await page.evaluate(()=>({submissions:window.submissions,revisions:window.revisions,continues:window.continues,unrequested:document.querySelector('#unrequested')?.value}));return release(page,options);};
      await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].correction.previousAnswers,outlineInitialAnswers);assert.match(f.requests[1].correction.feedback,/客观题 4 道，正确 2 道，错误 2 道/);
      assert.deepEqual(capture.submissions,[outlineInitialAnswers,outlineCorrectedAnswers]);assert.equal(capture.revisions,1);assert.equal(capture.continues,1);assert.equal(capture.unrequested,'');
      assert.equal(f.store.data.bank.length,1);const row=f.store.data.bank[0];assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,1);assert.equal(row.pages[0].questions[0].fields.length,4);assert.deepEqual(row.pages[0].questions[0].answer,outlineCorrectedAnswers);assert.equal(row.verification.total,4);assert.equal(row.verification.unit,'blanks');assert.match(row.pages[0].questions[0].context,/Synthetic reading passage/);
    }finally{if(!f.page.isClosed())await f.page.close();await f.store.flush();}
  });

  for(const options of [{unchanged:true},{revision:'partial'},{revision:'other'},{outcome:'always-failed'}])await t.test(`failed outline correction retains bounded review without incorrect bank entries: ${JSON.stringify(options)}`,async()=>{
    const f=await setup(options);try{
      await f.engine.beginExerciseLearning(f.task,f.page,f.settings);const result=await f.engine.answerEntry(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(f.store.data.bank.length,0);assert.equal(f.store.data.manualEntryMarks.length,0);
      const counts=await f.page.evaluate(()=>({submissions:window.submissions.length,revisions:window.revisions,continues:window.continues}));assert.equal(counts.continues,0);
      if(options.outcome){assert.equal(counts.submissions,3);assert.equal(counts.revisions,2);assert.equal(f.requests.length,3);assert.match(result.message,/2 次自动修改上限/);}
      else{assert.equal(counts.submissions,1);assert.equal(counts.revisions,1);assert.equal(f.requests.length,options.unchanged?2:1);assert.match(result.message,options.unchanged?/停止重复提交/:options.revision==='partial'?/尚不能对应小结中的全部题目/:/活动题目与小结不一致/);}
    }finally{await f.engine.disposeExerciseLearning(f.task.id);await f.page.close();await f.store.flush();}
  });

  for(const regression of ['guard','retry'])await t.test(`2/4 then 0/4 uses both actual grades, restores proven correct plurals and completes the whole exercise: ${regression}`,async()=>{
    const f=await setup({regression,provisional:regression==='guard'});try{
      const captured=await complete(f);assert.equal(f.task.status,'completed');assert.equal(f.requests.length,regression==='retry'?4:3);assert.equal(captured.submissions.length,3);assert.equal(captured.revisions,2);assert.equal(captured.continues,1);assert.deepEqual(captured.submissions[2],outlineCorrectedAnswers);
      const correction=f.requests[2].correction;assert.deepEqual(correction.history.map(item=>item.grading.correct),[2,0]);assert.deepEqual(correction.knownCorrectAnswers,[{index:1,answer:'couch potatoes'},{index:4,answer:'mouse potatoes'}]);assert.ok(correction.knownIncorrectAnswers.some(item=>item.index===2&&item.answers.includes(outlineInitialAnswers[1])));assert.ok(correction.knownIncorrectAnswers.some(item=>item.index===3&&item.answers.includes(outlineInitialAnswers[2])));
      if(regression==='retry')assert.match(f.requests[3].correction.validationFeedback,/评分排除|未达标/);
      assert.equal(f.store.data.bank.length,1);assert.deepEqual(f.store.data.bank[0].pages[0].questions[0].answer,outlineCorrectedAnswers);assert.equal(f.store.data.bank[0].verification.total,4);
    }finally{if(!f.page.isClosed())await f.page.close();await f.store.flush();}
  });

  await t.test('repeated known-wrong replies are bounded before any further input or submission',async()=>{
    const f=await setup({regression:'refuse'});try{
      await f.engine.beginExerciseLearning(f.task,f.page,f.settings);const result=await f.engine.answerEntry(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(f.requests.length,4);assert.equal(await f.page.evaluate(()=>window.submissions.length),2);assert.equal(f.store.data.bank.length,0);assert.match(result.message,/停止重复提交|仍未得到符合评分记录/);
    }finally{await f.engine.disposeExerciseLearning(f.task.id);await f.page.close();await f.store.flush();}
  });

  await t.test('correction history uses values captured at the submit click instead of the earlier AI draft',async()=>{
    const f=await setup();try{
      // Mutate at the actual click, after preflight checks, to verify submitted-value capture.
      await f.page.evaluate(()=>{const changeAtSubmit=event=>{if(event.target.closest('#footer button')?.textContent!=='提交')return;document.querySelector('#blank-0').value='couch potato';document.removeEventListener('click',changeAtSubmit,true);};document.addEventListener('click',changeAtSubmit,true);});
      await f.engine.beginExerciseLearning(f.task,f.page,f.settings);const result=await f.engine.answerEntry(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback.failed,false);assert.equal(f.requests[1].correction.history[0].answers[0],'couch potato');assert.equal(f.requests[1].correction.previousAnswers[0],'couch potato');assert.equal(f.requests[1].correction.history[0].grading.correct,1);assert.equal(f.store.data.bank.length,0);
    }finally{await f.engine.disposeExerciseLearning(f.task.id);await f.page.close();await f.store.flush();}
  });
}
