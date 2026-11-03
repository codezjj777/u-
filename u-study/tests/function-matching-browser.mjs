import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {mountMatchingMarkup} from './real-matching-browser.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import {functionMatchingHTML,functionGroups,functionAnswers} from './fixtures/function-matching.mjs';

export async function functionMatchingBrowserCases(t,context,root){
  await t.test('communicative matching swaps two function cards while retaining six expressions and both number groups',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/function-matching');await mountMatchingMarkup(page,functionMatchingHTML());
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);const [q]=report.questions;assert.deepEqual(q.prompts,functionGroups);const answer=Core.parseModelAnswer(JSON.stringify({answers:functionAnswers}),q),before=await page.locator('.question-common-abs-material').innerText();
      await fillQuestion(page.mainFrame(),q,answer);await verifyQuestion(page.mainFrame(),q,answer);assert.deepEqual(await page.evaluate(()=>window.answerOrder),[1,0]);assert.equal(await page.locator('.question-common-abs-material').innerText(),before);assert.deepEqual((await page.evaluate(collectQuestionsFromDOM))[0].prompts,functionGroups);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
  for(const startFirst of [false,true])await t.test(`complete function exercise is submitted once and saved with every page and all six source expressions: previous text page=${startFirst}`,async()=>{
    const store=await new Store(path.join(root,'function-bank-'+startFirst),{env:{}}).load(),scope={courseId:'function-book',unitId:'function-unit',entryKey:JSON.stringify(['function-unit',['Inside view','Conversation','Conversation 1'],'Exercise 2'])};
    try{
      for(const reverse of [false,true]){
        const page=await context.newPage();let done=false,asked=0,captured;
        try{
          await page.goto('https://ucontent.unipus.cn/offline-recognition/function-bank');await mountMatchingMarkup(page,functionMatchingHTML({startFirst,reverse}));
          const engine=new Automation(store),task={...scope,id:'function-'+reverse,unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]};store.data.tasks=[task];store.apiKey='fixture-key';engine.pages.attach(context);engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);return page;};
          engine.refreshTaskDirectory=async()=>{if(!page.isClosed())done ||= await page.evaluate(()=>window.submitted);task.requiredTotal=1;task.requiredCompleted=done?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{key:scope.entryKey,title:'Exercise 2',path:['Inside view','Conversation','Conversation 1'],required:true,completed:done,pending:!done}]};};
          const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
          engine.askModel=async q=>{asked++;assert.equal(reverse,false,'verified whole exercise must reuse all pages');return Core.parseModelAnswer(JSON.stringify({answers:q.type==='matching'?functionAnswers:['Meaning for '+q.question]}),q);};
          const release=engine.pages.release.bind(engine.pages);engine.pages.release=async(page,options)=>{captured=await page.evaluate(()=>({order:window.answerOrder,next:window.nextClicks,texts:window.savedExpressions}));return release(page,options);};
          await engine.runTask(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(task.status,'completed');assert.equal(asked,reverse?0:startFirst?7:1);assert.deepEqual(captured.order,reverse?[0,1]:[1,0]);assert.equal(captured.next,startFirst?1:0);assert.equal(captured.texts.length,startFirst?6:0);assert.equal(store.data.bank.length,1);
          const saved=store.data.bank[0];assert.equal(saved.pages.length,startFirst?2:1);assert.equal(saved.verification.total,startFirst?8:2);const matching=saved.pages.at(-1).questions[0];assert.equal(matching.questionType,'communicative_function_matching');assert.deepEqual(matching.prompts,functionGroups);assert.deepEqual(matching.answer,functionAnswers);for(const phrase of ['Oh, Kate!','The creep!','a fortune','a long shot','Come on!'])assert.ok(matching.context.includes(phrase));
        }finally{if(!page.isClosed())await page.close();}
      }
      await store.flush();const restored=await new Store(store.directory,{env:{}}).load();assert.deepEqual(restored.data.bank,store.data.bank);await restored.flush();
    }finally{await store.flush();}
  });
  await t.test('incomplete function references never request AI, drag options or submit',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/function-incomplete');await mountMatchingMarkup(page,functionMatchingHTML({missingSource:true}));
      const store={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store),task={id:'function-incomplete',status:'running',answered:0,pages:0,logs:[]};engine.askModel=async()=>assert.fail('incomplete material must not be answered');
      const result=await engine.answerEntryAttempt(task,page,{autoSubmit:true,aiEnabled:true},new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/交际功能/);assert.equal(await page.evaluate(()=>window.dragEvents),0);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
}
