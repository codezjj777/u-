import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';
import {sentenceCreationHTML,sentenceCreationAnswers} from './fixtures/sentence-creation.mjs';

export async function sentenceCreationBrowserCases(t,context){
  async function setup(){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/sentence-creation');await page.setContent(sentenceCreationHTML());
    const task={id:'sentence-creation',status:'running',logs:[],answered:0,pages:0},store={data:{tasks:[task],bank:[]},apiKey:'fixture-sentence-key',changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(store);
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});return {page,task,store,engine,settings:{aiEnabled:true,autoSubmit:false,endpoint:'https://ai.example.test/v1/chat/completions',model:'sentence-fixture'}};
  }
  for(const recoverAfterReview of [false,true])await t.test(`a numbered sentence task ${recoverAfterReview?'retains its first prepared answer across review':'repairs an empty second AI answer'} before filling all three boxes`,async()=>{
    const f=await setup(),calls=[0,0,0];let reviewed=0,bad=true;try{
      f.engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,retryDelayMs:0,fetchImpl:async(_url,request)=>{
        const body=JSON.parse(request.body),payload=JSON.parse(body.messages[1].content),index=payload.answerTask.exampleIndex-1;calls[index]++;
        assert.equal(payload.answerTask.kind,'original_sentence_creation');assert.equal(payload.answerTask.answerCount,1);assert.match(body.messages[0].content,/Always provide the requested sentences/);
        const missing=index===1&&(recoverAfterReview?bad:calls[index]===1),answer=missing?{answers:[],status:'missing_material'}:{answers:[sentenceCreationAnswers[index]]};
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
      }});
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review'){reviewed++;assert.equal(recoverAfterReview,true,JSON.stringify(task.logs));assert.deepEqual(await f.page.locator('textarea').evaluateAll(fields=>fields.map(field=>field.value)),['','','']);assert.equal(calls[0],1);bad=false;task.status='running';}return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.equal(f.task.answered,3);assert.equal(f.task.pages,1);assert.deepEqual(await f.page.locator('textarea').evaluateAll(fields=>fields.map(field=>field.value)),sentenceCreationAnswers);assert.equal(await f.page.evaluate(()=>window.submissions),0);assert.deepEqual(calls,recoverAfterReview?[1,3,1]:[1,2,1]);assert.equal(reviewed,recoverAfterReview?1:0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  await t.test('stopping a sentence repair prevents later AI calls, field writes and submission',async()=>{
    const f=await setup(),controller=new AbortController();let calls=0;try{
      f.engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,retryDelayMs:0,onRetry:event=>{options.onRetry?.(event);controller.abort(new Error('stop-sentence-task'));},fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"answers":[],"status":"missing_material"}'}}]}));}});
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),/stop-sentence-task/);assert.equal(calls,1);assert.deepEqual(await f.page.locator('textarea').evaluateAll(fields=>fields.map(field=>field.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submissions),0);
    }finally{await f.page.close();}
  });
}
