import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';
import {videoCorrectionHTML,correctionDirections,correctionStatements,correctionTranscript,correctionAnswers} from './fixtures/video-statement-correction.mjs';

export async function videoCorrectionBrowserCases(t,context){
  async function setup(options={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/video-correction');await page.setContent(videoCorrectionHTML(options));
    const task={id:'video-correction',status:'running',logs:[],answered:0,pages:0},store={apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(store),requests=[];let reads=0;
    engine.media.resolve=async(record,options)=>{reads++;assert.equal(record.kind,options.kind||'video');return {text:correctionTranscript,source:'本地测试原文'};};
    engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,retryDelayMs:0,fetchImpl:async(url,options)=>{
      const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content),index=correctionStatements.findIndex(statement=>payload.question.includes(statement));assert.ok(index>=0);assert.equal(payload.type,'text');assert.equal(payload.blankCount,1);assert.ok(payload.passage.includes(correctionTranscript));assert.ok(payload.passage.includes(correctionDirections));assert.match(request.messages[0].content,/never True\/False/);assert.doesNotMatch(payload.passage,/fixture-private-token|03:09/);requests.push(index);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:[correctionAnswers[index]]})}}]}));
    }});
    if(options.kind==='audio')engine.media.resolve=async record=>{reads++;assert.equal(record.kind,'audio');return {text:correctionTranscript,source:'本地测试原文'};};
    return {page,engine,task,store,requests,reads:()=>reads,settings:{aiEnabled:true,autoSubmit:false,endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'}};
  }

  for(const kind of ['video','audio'])await t.test(`Read-again correction tasks use the full ${kind} transcript for all five text fields before any write`,async()=>{
    const f=await setup({kind});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.equal(f.reads(),1);assert.deepEqual(f.requests,[0,1,2,3,4]);assert.equal(f.task.answered,5);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),correctionAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });

  await t.test('a cached video transcript survives Watch-to-Read instructions on the next exercise page',async()=>{
    const f=await setup({firstPage:true});try{
      const signal=new AbortController().signal,first=await f.engine.readQuestions(f.page,f.settings);await f.engine.prepareMedia(f.task,f.page,first,f.settings,signal);assert.equal(f.reads(),1);
      await f.page.locator('.abs-direction').evaluate((el,value)=>el.textContent=value,correctionDirections);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,signal);assert.equal(result.review,true);assert.equal(f.reads(),1);assert.equal(f.requests.length,5);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),correctionAnswers);
    }finally{await f.page.close();}
  });

  await t.test('unreadable media blocks every AI request, input write and automatic skip',async()=>{
    const f=await setup();try{
      f.engine.media.resolve=async()=>{throw new Error('本测试没有可读取音轨。');};f.engine.askModel=async()=>assert.fail('missing media must not reach AI');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/音视频原文准备未完成/);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),Array(5).fill(''));assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.task.answered,0);
    }finally{await f.page.close();}
  });

  await t.test('an AI empty-answer report after transcription becomes explicit material review with no guessed answers',async()=>{
    const f=await setup();try{
      let requests=0;f.engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,retryDelayMs:0,fetchImpl:async()=>{requests++;return new Response(JSON.stringify({choices:[{message:{content:'{"answers":[],"explanation":"missing material"}'}}]}));}});
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/材料/);assert.doesNotMatch(result.message,/格式无效/);assert.equal(requests,1);assert.equal(f.reads(),1);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),Array(5).fill(''));assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
}
