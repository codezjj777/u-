import assert from 'node:assert/strict';
import path from 'node:path';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {mountMatchingMarkup} from './real-matching-browser.mjs';
import {partMatchingHTML,partMatchingPrompts,partMatchingMap,partMatchingAnswers,partMatchingParagraphs} from './fixtures/part-matching.mjs';

export async function partMatchingBrowserCases(t,context,root){
  for(const [width,rollback] of [[1180,'none'],[850,'once']])await t.test(`text-part matching at width ${width} moves only answer cards and retains paragraph ranges through ${rollback} rollback`,async()=>{
    const page=await context.newPage();try{
      await page.setViewportSize({width,height:760});await page.goto('https://ucontent.unipus.cn/offline-recognition/part-matching');await mountMatchingMarkup(page,partMatchingHTML({rollback}));
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);const [q]=report.questions;assert.equal(q.questionType,'main_idea_matching');assert.deepEqual(q.prompts,partMatchingPrompts);assert.ok(q.context.includes(partMatchingParagraphs[7]));
      const labels=await page.locator('.sortable-list-question-no').allTextContents(),signature=Core.questionSignature([q]),answer=Core.parseModelAnswer(JSON.stringify({answers:partMatchingAnswers}),q),checkpoint=async()=>assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);
      await fillQuestion(page.mainFrame(),q,answer,{checkpoint});await verifyQuestion(page.mainFrame(),q,answer,{checkpoint});
      assert.deepEqual(await page.evaluate(()=>window.answerOrder),partMatchingMap);assert.deepEqual(await page.locator('.sortable-list-question-no').allTextContents(),labels);assert.ok(await page.evaluate(()=>window.dragEvents>0));assert.equal(await page.evaluate(()=>window.submitted),false);
      if(rollback==='once')assert.equal(await page.evaluate(()=>window.rollbackEvents),1);
    }finally{await page.close();}
  });
  await t.test('an unstable text-part matching order never passes verification or submits',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/part-matching-revert');await mountMatchingMarkup(page,partMatchingHTML({rollback:'always'}));
      const [q]=await page.evaluate(collectQuestionsFromDOM),answer=Core.parseModelAnswer(JSON.stringify({answers:partMatchingAnswers}),q);
      await assert.rejects(fillQuestion(page.mainFrame(),q,answer),/配对.*(?:回退|顺序|拖动|变化|完整)/);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  await t.test('a verified three-part exercise stores the whole reading and all pairs once, then reuses them after the part order changes',async()=>{
    const directory=path.join(root,'part-matching-bank'),store=await new Store(directory,{env:{}}).load(),scope={courseId:'part-book',unitId:'part-unit',entryKey:JSON.stringify(['part-unit',['Getting the idea'],'Exercise 1'])};
    try{
      for(const reverse of [false,true]){
        const page=await context.newPage();let completed=false,asked=0;
        try{
          await page.goto('https://ucontent.unipus.cn/offline-recognition/part-matching-bank');await mountMatchingMarkup(page,partMatchingHTML({reverse}));
          const task={...scope,id:'part-'+reverse,unitLabel:'Unit 2',status:'running',answered:0,pages:0,logs:[],manualItems:[]},engine=new Automation(store);store.apiKey='fixture-key';store.data.tasks=[task];engine.pages.attach(context);
          engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);return page;};
          engine.refreshTaskDirectory=async()=>{if(!page.isClosed())completed ||= await page.evaluate(()=>window.submitted);task.requiredTotal=1;task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{key:scope.entryKey,title:'Exercise 1',path:['Getting the idea'],required:true,pending:!completed,completed}]};};
          engine.askModel=async q=>{asked++;assert.equal(reverse,false,'the complete exercise must reuse its verified bank');assert.ok(q.context.includes(partMatchingParagraphs[7]));return Core.parseModelAnswer(JSON.stringify({answers:partMatchingAnswers}),q);};
          const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail('Unexpected matching review: '+task.logs.at(-1)?.message);return gate(task,signal);};
          await engine.runTask(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(task.status,'completed');assert.equal(asked,reverse?0:1);assert.equal(store.data.bank.length,1);
          const row=store.data.bank[0],question=row.pages[0].questions[0];assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,1);assert.equal(row.verification.total,3);assert.deepEqual(question.prompts,partMatchingPrompts);assert.deepEqual(question.answer,partMatchingAnswers);assert.ok(question.context.includes(partMatchingParagraphs[7]));assert.equal(question.questionType,'main_idea_matching');
        }finally{if(!page.isClosed())await page.close();}
      }
      await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.deepEqual(restored.data.bank,store.data.bank);await restored.flush();
    }finally{await store.flush();}
  });
}
