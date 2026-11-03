import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {realMatchingHTML,realMatchingMap,realMatchingAnswers} from './fixtures/real-matching.mjs';

const scripts=Promise.all([
  readFile(new URL('../node_modules/react/umd/react.development.js',import.meta.url),'utf8'),
  readFile(new URL('../node_modules/prop-types/prop-types.js',import.meta.url),'utf8'),
  readFile(new URL('../node_modules/react-dom/umd/react-dom.development.js',import.meta.url),'utf8'),
  readFile(new URL('../node_modules/react-sortable-hoc/dist/react-sortable-hoc.umd.js',import.meta.url),'utf8')
]);
export async function mountRealMatching(page,options={}){
  await mountMatchingMarkup(page,realMatchingHTML(options));
}
export async function mountMatchingMarkup(page,html){await page.setContent(html);for(const content of await scripts)await page.addScriptTag({content});await page.evaluate(()=>window.mountMatching());}
export async function realMatchingBrowserCases(t,context,root){
  for(const width of [1180,850])await t.test(`real sortable at width ${width} preserves every earlier pair with wrapped sentences and nested scrolling`,async()=>{
    const page=await context.newPage();try{
      await page.setViewportSize({width,height:760});await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching');await mountRealMatching(page);
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);
      const q=report.questions[0],signature=Core.questionSignature([q]),answer=Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q),checkpoint=async()=>assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);
      try{await fillQuestion(page.mainFrame(),q,answer,{checkpoint});await verifyQuestion(page.mainFrame(),q,answer,{checkpoint});}
      catch(error){error.message+=' '+JSON.stringify(await page.evaluate(()=>({order:window.answerOrder,moves:window.moves})));throw error;}
      assert.deepEqual(await page.evaluate(()=>window.answerOrder),realMatchingMap);assert.ok(await page.evaluate(()=>window.dragEvents>0));assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  for(const rollback of ['once','last-once'])await t.test(`a ${rollback} delayed React state rollback is reconciled before accepting the complete answer`,async()=>{
    const page=await context.newPage();try{
      await page.setViewportSize({width:1180,height:760});await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching-rollback');await mountRealMatching(page,{rollback});
      const [q]=await page.evaluate(collectQuestionsFromDOM),signature=Core.questionSignature([q]),answer=Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q),checkpoint=async()=>assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);
      await fillQuestion(page.mainFrame(),q,answer,{checkpoint});await verifyQuestion(page.mainFrame(),q,answer,{checkpoint});
      assert.deepEqual(await page.evaluate(()=>window.answerOrder),realMatchingMap);assert.equal(await page.evaluate(()=>window.rollbackEvents),1);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  await t.test('a persistently reverting React state is bounded and never passes final verification or submits',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching-revert');await mountRealMatching(page,{rollback:'always'});
      const [q]=await page.evaluate(collectQuestionsFromDOM),answer=Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q);
      await assert.rejects(fillQuestion(page.mainFrame(),q,answer),/配对.*(?:回退|顺序|拖动|变化|完整)/);assert.equal(await page.evaluate(()=>window.submitted),false);assert.ok(await page.evaluate(()=>window.rollbackEvents>0&&window.dragEvents<=30));
    }finally{await page.close();}
  });
  await t.test('cancelling a real sortable gesture releases the mouse without leaving a drag helper or submitting',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching-cancel');await mountRealMatching(page);const controller=new AbortController();
      await page.exposeFunction('__cancelRealMatching',()=>controller.abort(new Error('fixture-real-cancel')));await page.evaluate(()=>{document.addEventListener('mousedown',()=>void window.__cancelRealMatching(),{once:true});document.addEventListener('mouseup',()=>{window.released=true;});});
      const [q]=await page.evaluate(collectQuestionsFromDOM),answer=Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q);await assert.rejects(fillQuestion(page.mainFrame(),q,answer,{signal:controller.signal}),/fixture-real-cancel/);assert.equal(await page.evaluate(()=>window.released),true);assert.equal(await page.locator('.sortable-helper').count(),0);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  await t.test('a pause at the pre-drag checkpoint does not consume the settling window or change the prepared answer',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching-pause');await mountRealMatching(page);
      const [q]=await page.evaluate(collectQuestionsFromDOM),signature=Core.questionSignature([q]),answer=Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q);let paused=false;
      const checkpoint=async()=>{if(!paused){paused=true;await new Promise(resolve=>setTimeout(resolve,1950));}assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);};
      await fillQuestion(page.mainFrame(),q,answer,{checkpoint});assert.deepEqual(await page.evaluate(()=>window.answerOrder),realMatchingMap);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  await t.test('a real sortable recovers, submits one complete ten-pair fixture and stores exactly one all-correct exercise',async()=>{
    const directory=path.join(root,'verified-real-matching'),store=await new Store(directory,{env:{}}).load(),page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/real-matching-learning');await mountRealMatching(page,{rollback:'once'});const engine=new Automation(store),scope={courseId:'real-book',unitId:'real-unit',entryKey:JSON.stringify(['real-unit',['Language focus'],'Exercise 1'])},task={...scope,id:'real-matching-learning',status:'running',unitLabel:'Unit 5',answered:0,pages:0,manualItems:[],logs:[]};store.data.tasks=[task];engine.pages.attach(context);engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson');return page;};let completed=false,asked=0;
      engine.refreshTaskDirectory=async()=>{if(!page.isClosed())completed=await page.evaluate(()=>window.submitted);task.requiredTotal=1;task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{key:scope.entryKey,title:'Exercise 1',path:['Language focus'],required:true,pending:!completed,completed}]};};
      engine.askModel=async q=>{asked++;return Core.parseModelAnswer(JSON.stringify({answers:realMatchingAnswers}),q);};const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail('Unexpected real matching review: '+task.logs.at(-1)?.message);return gate(task,signal);};
      await engine.runTask(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(task.status,'completed');assert.equal(asked,1);assert.equal(store.data.bank.length,1);const row=store.data.bank[0];assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,1);assert.equal(row.pages[0].questions[0].prompts.length,10);assert.deepEqual(row.pages[0].questions[0].answer,realMatchingAnswers);assert.equal(row.verification.total,10);assert.equal(row.verification.correct,10);
      await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.deepEqual(restored.data.bank,[row]);await restored.flush();
    }finally{if(!page.isClosed())await page.close();await store.flush();}
  });
}
