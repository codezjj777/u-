import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';
import {readingQuestions,readingParagraphs,readingAnswers,readingDiscussionHTML} from './fixtures/reading-discussion.mjs';

export async function readingDiscussionBrowserCases(t,context){
  async function setup({missing=false,change=false}={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/reading-discussion');await page.setContent(readingDiscussionHTML());
    const task={id:'reading-discussion-'+Math.random(),status:'running',answered:0,pages:0,logs:[]},store={apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store),requests=[];engine.pages.track(page,'lesson',{taskId:task.id});
    engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,fetchImpl:async(_url,options)=>{
      const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content),index=readingQuestions.findIndex(question=>payload.question.includes(question));requests.push(index);assert.ok(index>=0);assert.equal(payload.blankCount,1);for(const paragraph of readingParagraphs)assert.ok(payload.passage.includes(paragraph));
      assert.match(request.messages[0].content,/open-ended discussion/i);assert.match(request.messages[0].content,/do not invent statistics/i);
      assert.deepEqual(await page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','','']);
      if(index===3&&change)await page.locator('.layout-material-container p').last().evaluate(el=>el.textContent='The original last paragraph has changed.');
      const answer=index===3&&missing?{answers:[],status:'missing_material',explanation:'Uncertain factual evidence.'}:{answers:[readingAnswers[index]],explanation:index===3?'讨论题示例，比较数据不足时使用保留表述。':''};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
    }});
    return {page,engine,task,store,requests,settings:{aiEnabled:true,autoSubmit:false,endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'}};
  }
  await t.test('the fourth open discussion receives the whole scrollable passage and all four fields fill together without submission',async()=>{
    const f=await setup();try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(f.task.answered,4);assert.deepEqual(f.requests,[0,1,2,3]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),readingAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>/第 4 题.*已附带 \d+ 字符上下文/.test(log.message)));
    }finally{await f.page.close();}
  });
  await t.test('an unresolved material report after three prepared answers keeps the entire reading page unfilled and reports the supplied context',async()=>{
    const f=await setup({missing:true});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/第 4 题/);assert.match(result.message,/已附带 \d+ 字符上下文/);assert.doesNotMatch(result.message,/需要核对音视频原文/);assert.deepEqual(f.requests,[0,1,2,3]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  await t.test('a changed final off-screen reading paragraph invalidates every prepared answer before filling',async()=>{
    const f=await setup({change:true});try{
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/题目.*变化/);assert.deepEqual(f.requests,[0,1,2,3]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });
}
