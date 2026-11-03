import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';

export async function aiRecoveryBrowserCases(t,context){
  const setup=async({failures=2}={})=>{
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/ai-recovery');
    await page.setContent('<main>'+[1,2,3].map(n=>`<fieldset><legend>Question ${n}</legend><input type="text"></fieldset>`).join('')+'<button onclick="window.submitted=true">提交</button></main><script>window.submitted=false;</script>');
    const task={id:'ai-recovery-browser',status:'running',logs:[],answered:0,pages:0},store={apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(store),requests=[];let failed=0;
    engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key,signal,{...options,retryDelayMs:0,fetchImpl:async(url,options)=>{
      const prompt=JSON.parse(JSON.parse(options.body).messages[1].content),number=Number(prompt.question.match(/Question (\d)/)[1]);requests.push(number);
      if(number===3&&failed++<failures)throw Object.assign(new TypeError('fixture-private-response'),{cause:{code:'ECONNRESET'}});
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:['answer '+number]})},finish_reason:'stop'}]}));
    }});
    return {engine,page,store,task,requests,settings:{aiEnabled:true,autoSubmit:false,endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'}};
  };

  await t.test('a third-question connection reset retries in place and fills the entire page once all answers are ready',async()=>{
    const f=await setup();try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.deepEqual(f.requests,[1,2,3,3,3]);assert.equal(f.task.answered,3);assert.deepEqual(await f.page.locator('input').evaluateAll(items=>items.map(el=>el.value)),['answer 1','answer 2','answer 3']);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);assert.equal(f.task.logs.filter(log=>log.message.includes('自动重试')).length,2);assert.doesNotMatch(JSON.stringify(f.task.logs),/fixture-private-response|fixture-key/);
    }finally{await f.page.close();}
  });

  await t.test('resume after exhausted AI retries reuses the first two answers and never fills a partial page',async()=>{
    const f=await setup({failures:3});try{
      let resumes=0;const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{
        if(task.status==='review'){resumes++;assert.deepEqual(await f.page.locator('input').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);f.engine.controlTask(task.id,'resume');}
        return gate(task,signal);
      };
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.equal(resumes,1);assert.deepEqual(f.requests,[1,2,3,3,3,3]);assert.deepEqual(await f.page.locator('input').evaluateAll(items=>items.map(el=>el.value)),['answer 1','answer 2','answer 3']);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>log.message.includes('前 2 道已准备的答案')));
    }finally{await f.page.close();}
  });

  await t.test('editing a question during the AI wait invalidates pending answers before a resumed request',async()=>{
    const f=await setup({failures:3});try{
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{
        if(task.status==='review'){await f.page.locator('legend').last().evaluate(el=>el.textContent='A different question');f.engine.controlTask(task.id,'resume');}
        return gate(task,signal);
      };
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/题目或阅读材料发生变化/);assert.deepEqual(f.requests,[1,2,3,3,3]);assert.deepEqual(await f.page.locator('input').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('stopping an exhausted AI wait sends no further requests and leaves every field unchanged',async()=>{
    const f=await setup({failures:3});try{
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')f.engine.controlTask(task.id,'stop');return gate(task,signal);};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/任务已停止/);assert.deepEqual(f.requests,[1,2,3,3,3]);assert.equal(f.task.status,'stopped');assert.deepEqual(await f.page.locator('input').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
}
