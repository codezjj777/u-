import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {submissionSummaryHTML} from './fixtures/submission-summary.mjs';

export async function submissionCompletionBrowserCases(t,context,root){
  const scope={courseId:'submitted-book',unitId:'id-submitted-tab',entryKey:JSON.stringify(['id-submitted-tab',['Active reading','Building your language'],'Exercise 3'])};
  async function setup(mode='passed',options={}){
    const store=await new Store(path.join(root,'submission-'+mode),{env:{}}).load(),engine=new Automation(store),page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/submission-'+mode);await page.setContent(submissionSummaryHTML({mode,...options}));
    const task={...scope,id:'submission-'+mode,status:'running',unitLabel:'Unit 5',logs:[],answered:0,pages:0,manualItems:[]},entry={key:scope.entryKey,title:'Exercise 3',path:['Active reading','Building your language'],required:true,pending:true,completed:false};store.data.tasks=[task];engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});
    return {store,engine,page,task,entry};
  }
  for(const [score,fragmented] of [[84,false],[93.4,true]])await t.test(`five submitted subjective answers at ${score} points finish once, survive directory delay and never enter the all-correct bank`,async()=>{
    const f=await setup('passed-'+score,{score,fragmented});let completed=false,asked=0,captured;try{
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed=await f.page.evaluate(()=>{if(window.submits)window.directoryPolls++;return window.directoryAcknowledged&&window.directoryPolls>=3;});f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...f.entry,completed,pending:!completed}]};};
      f.engine.askModel=async()=>({answers:['Submitted translation '+(++asked)],source:'AI'});
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail('valid submitted summary must continue automatically: '+task.logs.at(-1)?.message);return gate(task,signal);};
      const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{captured=await page.evaluate(()=>({submits:window.submits,continues:window.continues,polls:window.directoryPolls,values:window.submittedValues,unrequested:document.querySelector('#unrequested')?.value}));return release(page,options);};
      await f.engine.runTask(f.task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(f.task.answered,5);assert.equal(asked,5);assert.equal(captured.submits,1);assert.equal(captured.continues,1);assert.ok(captured.polls>=3);assert.equal(captured.unrequested,'');assert.equal(captured.values.length,5);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>log.message.includes('得分 '+score)));assert.ok(f.task.logs.some(log=>log.message.includes('未自动入库')));
    }finally{if(!f.page.isClosed())await f.page.close();await f.store.flush();}
  });
  for(const mode of ['failed','partial','pending'])for(const fragmented of [false,true])await t.test(`the summary continue action preserves ${mode} submissions for review with fragmented=${fragmented}`,async()=>{
    const f=await setup(mode,{fragmented,score:93.4});try{
      await f.page.locator('textarea').evaluateAll(items=>items.forEach(el=>el.value='Submitted sample answer.'));await f.page.locator('footer button').click();
      const feedback=await f.engine.readExerciseFeedback(f.page);assert.equal(await f.engine.finishExerciseSummary(f.task,f.page,feedback,new AbortController().signal),false);assert.equal(await f.page.evaluate(()=>window.continues),0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();await f.store.flush();}
  });
  await t.test('a changed active exercise blocks a stale summary continuation before it can navigate',async()=>{
    const f=await setup('stale');try{
      await f.page.locator('textarea').evaluateAll(items=>items.forEach(el=>el.value='Submitted sample answer.'));await f.page.locator('footer button').click();const feedback=await f.engine.readExerciseFeedback(f.page);
      await f.page.locator('.pc-header-task-activity').evaluate(el=>el.textContent='Exercise 2');await assert.rejects(f.engine.finishExerciseSummary(f.task,f.page,feedback,new AbortController().signal),/答题小结或当前项目已变化/);assert.equal(await f.page.evaluate(()=>window.continues),0);
    }finally{await f.page.close();await f.store.flush();}
  });
  await t.test('reopening an already submitted 84-point summary bypasses question scanning, AI and answer submission',async()=>{
    const f=await setup('reopened');try{
      await f.page.locator('textarea').evaluateAll(items=>items.forEach(el=>el.value='Previously submitted translation.'));await f.page.locator('footer button').click();
      f.engine.readQuestions=f.engine.askModel=f.engine.fillQuestion=f.engine.action=async()=>assert.fail('a saved result must not be scanned, answered or resubmitted');
      const result=await f.engine.answerEntry(f.task,f.page,{aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(result.feedback.summary,true);assert.equal(result.feedback.grading.score,84);assert.equal(result.manual,undefined);assert.equal(f.task.answered,0);assert.equal(await f.page.evaluate(()=>window.submits),1);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();await f.store.flush();}
  });
  await t.test('a 93.4-point mixed-node result can be previewed without AI, continuation, bank writes or another submit',async()=>{
    const f=await setup('preview-93.4',{fragmented:true,score:93.4});try{
      await f.page.locator('textarea').evaluateAll(items=>items.forEach(el=>el.value='Previously submitted translation.'));await f.page.locator('footer button').click();f.store.data.tasks=[];f.store.data.courses=[{id:scope.courseId}];
      f.engine.courseDirectory=async()=>({page:{}});f.engine.prepareDirectory=async()=>({ready:true,activeUnitId:scope.unitId,entries:[f.entry]});f.engine.openRequiredEntry=async()=>f.page;f.engine.pages.release=async()=>({status:'retained'});f.engine.askModel=f.engine.fillQuestion=f.engine.action=async()=>assert.fail('summary preview must remain read-only');
      const result=await f.engine.previewMedia({...scope,solve:true});assert.equal(result.kind,'submission-summary');assert.equal(result.feedback.grading.score,93.4);assert.equal(result.feedback.completion.allAnswered,true);assert.equal(result.completionReady,true);assert.equal(result.continueReady,true);assert.equal(result.continued,false);assert.equal(await f.page.evaluate(()=>window.continues),0);assert.equal(await f.page.evaluate(()=>window.submits),1);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();await f.store.flush();}
  });
  await t.test('opening or resuming a minimized lesson restores its window before question recognition',async()=>{
    const f=await setup('minimized');let session;try{
      session=await context.newCDPSession(f.page);const {windowId}=await session.send('Browser.getWindowForTarget');await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});assert.equal((await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState,'minimized');
      await f.engine.focusPage(f.page);assert.equal((await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState,'normal');assert.equal((await f.engine.readQuestions(f.page,{})).questions.length,5);
    }finally{await session?.detach();await f.page.close();await f.store.flush();}
  });
}
