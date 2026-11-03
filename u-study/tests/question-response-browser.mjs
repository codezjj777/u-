import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import * as Core from '../shared/core.mjs';
import {mountMatchingMarkup} from './real-matching-browser.mjs';
import {questionResponseHTML,responsePrompts,responseOptions,responseAnswers,responseOrder,responseTranscript} from './fixtures/question-response.mjs';
export async function questionResponseBrowserCases(t,context,root){
  const open=async options=>{const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/question-response');await mountMatchingMarkup(page,questionResponseHTML(options));return page;};
  await t.test('six question-response pairs drag normally while preserving fixed questions and full response fragments',async()=>{
    const page=await open({transcript:true});try{
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);const q=report.questions[0];
      const signature=Core.questionSignature([q]),checkpoint=async()=>assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);
      const answer=Core.parseModelAnswer(JSON.stringify({answers:responseAnswers}),q);await fillQuestion(page.mainFrame(),q,answer,{checkpoint});await verifyQuestion(page.mainFrame(),q,answer,{checkpoint});
      assert.deepEqual(await page.evaluate(()=>window.answerOrder),responseOrder);assert.deepEqual((await page.evaluate(collectQuestionsFromDOM))[0].prompts,responsePrompts);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  await t.test('video material is transcribed before matching and all six platform-correct pairs enter one exercise that is reused',async()=>{
    const store=await new Store(path.join(root,'response-bank'),{env:{}}).load();
    const scope={courseId:'response-book',unitId:'response-unit',entryKey:JSON.stringify(['response-unit',['Inside view','Conversation','Conversation 1'],'Exercise 2'])};
    try{for(const reuse of [false,true]){
      const page=await open({});let done=false,resolved=0,asked=0;
      try{
        const engine=new Automation(store),task={...scope,id:'response-'+reuse,unitLabel:'Unit 1',status:'running',logs:[],answered:0,pages:0,manualItems:[]};store.data.tasks=[task];store.apiKey='fixture';engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);
        engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>page;
        engine.refreshTaskDirectory=async()=>{if(!page.isClosed())done ||= await page.evaluate(()=>window.submitted);return {ready:true,activeUnitId:scope.unitId,entries:[{key:scope.entryKey,title:'Exercise 2',path:['Inside view','Conversation','Conversation 1'],required:true,completed:done,pending:!done}]};};
        const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
        engine.media.resolve=async()=>{resolved++;return {source:'offline fixture',text:responseTranscript};};
        engine.askModel=async q=>{assert.equal(reuse,false);asked++;assert.equal(resolved,1);assert.ok(q.context.includes(responseTranscript));assert.deepEqual(q.prompts,responsePrompts);return Core.parseModelAnswer(JSON.stringify({answers:responseAnswers}),q);};
        await engine.runTask(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(task.status,'completed');assert.equal(asked,reuse?0:1);assert.equal(resolved,1);assert.equal(store.data.bank.length,1);
        const saved=store.data.bank[0],q=saved.pages[0].questions[0];assert.equal(saved.pages.length,1);assert.equal(saved.pages[0].questions.length,1);assert.equal(saved.verification.total,6);assert.equal(q.questionType,'question_response_matching');assert.deepEqual(q.prompts,responsePrompts);assert.deepEqual(q.answer,responseAnswers);assert.deepEqual([...q.options].sort(),[...responseOptions].sort());assert.ok(q.context.includes(responseTranscript));
      }finally{if(!page.isClosed())await page.close();}
    }}finally{await store.flush();}
  });
  await t.test('an incomplete response exercise never calls AI, drags or submits',async()=>{
    const page=await open({transcript:true,missing:true});try{
      const engine=new Automation({data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}}),task={id:'response-incomplete',status:'running',logs:[],answered:0,pages:0};
      engine.askModel=async()=>assert.fail('incomplete matching must not be solved');const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(result.review,true);assert.equal(await page.evaluate(()=>window.dragEvents),0);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
}
