import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,readInputRestrictionFromDOM,TextInputError} from '../answer-writer.mjs';
import {specialInputHTML,technologyAnswers,technologyPlainAnswers} from './fixtures/text-input.mjs';

export async function textInputBrowserCases(t,context,root){
  let sequence=0;
  const scope={courseId:'input-book',unitId:'id-input-tab',entryKey:JSON.stringify(['id-input-tab',['Active reading','Getting the idea','Exercises'],'Exercise 2'])};
  async function setup(options={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/text-input');await page.setContent(specialInputHTML(options));
    const store=await new Store(path.join(root,'text-input-'+(++sequence)),{env:{}}).load(),engine=new Automation(store),task={...scope,id:'text-input-'+sequence,status:'running',logs:[],answered:0,pages:0,manualItems:[]};store.data.tasks=[task];engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});
    let requests=0;engine.askModel=async()=>{const index=requests++;return {source:'AI',answers:[options.rejectSymbols&&index===1?'Keep meaningful α notation.':technologyAnswers[index]]};};
    return {page,store,engine,task,settings:{aiEnabled:true,autoSubmit:false},requests:()=>requests};
  }
  for(const options of [{},{notice:true},{replaceOnBlur:true}])await t.test(`three technology answers normalize layout punctuation, commit in full and never trigger character rejection: ${JSON.stringify(options)}`,async()=>{
    const f=await setup(options);try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(f.requests(),3);assert.equal(f.task.answered,3);assert.deepEqual(await f.page.locator('textarea').evaluateAll(inputs=>inputs.map(input=>input.value)),technologyPlainAnswers);assert.deepEqual(await f.page.evaluate(()=>Object.values(window.committed)),technologyPlainAnswers);assert.equal(await f.page.evaluate(()=>window.rejections),options.notice?1:0);assert.equal(await f.page.evaluate(()=>window.acks),options.notice?1:0);assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>/排版标点/.test(log.message)));
    }finally{await f.page.close();await f.store.flush();}
  });

  await t.test('the original unnormalized long dash reproduces the same validation dialog and filtered city names',async()=>{
    const f=await setup();try{
      await f.page.locator('#answer-1').fill(technologyAnswers[1]);assert.equal((await f.page.locator('[role=dialog]').innerText()).replace(/\s+/g,''),'不支持输入特殊字符哦我知道了');assert.match(await f.page.locator('#answer-1').inputValue(),/ShanghaiBeijing/);assert.equal(await f.page.evaluate(()=>window.rejections),1);
    }finally{await f.page.close();await f.store.flush();}
  });

  await t.test('a remaining unsupported meaningful symbol stops in review before later fields or submit, without deleting it from the prepared answer',async()=>{
    const f=await setup({rejectSymbols:true});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/第 2 题.*仍拒绝/);assert.equal(f.requests(),3);assert.equal(f.task.answered,1);assert.equal(await f.page.locator('#answer-2').inputValue(),'');assert.equal(await f.page.evaluate(()=>window.submissions.length),0);assert.equal(await f.page.evaluate(()=>window.acks),1);assert.equal(f.store.data.bank.length,0);assert.equal(f.store.data.manualEntryMarks.length,0);
    }finally{await f.page.close();await f.store.flush();}
  });

  await t.test('actual plain input values are captured as one full three-part bank exercise only after platform grading and directory completion',async()=>{
    const f=await setup();let written;try{
      const entry={key:scope.entryKey,title:'Exercise 2',path:['Active reading','Getting the idea','Exercises'],required:true,pending:true,completed:false};let completed=false;f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed=await f.page.evaluate(()=>window.completed);f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...entry,completed,pending:!completed}]};};
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};const release=f.engine.pages.release.bind(f.engine.pages);f.engine.pages.release=async(page,options)=>{written=await page.evaluate(()=>window.submissions);return release(page,options);};
      await f.engine.runTask(f.task,{}, {...f.settings,autoSubmit:true},new AbortController().signal);assert.equal(f.task.status,'completed');assert.deepEqual(written,[technologyPlainAnswers]);assert.equal(f.store.data.bank.length,1);const exercise=f.store.data.bank[0];assert.equal(exercise.pages.length,1);assert.equal(exercise.pages[0].questions.length,3);assert.deepEqual(exercise.pages[0].questions.map(question=>question.answer[0]),technologyPlainAnswers);assert.ok(exercise.pages[0].questions.every(question=>question.context.includes('whole material')));
    }finally{if(!f.page.isClosed())await f.page.close();await f.store.flush();}
  });

  await t.test('an editor inside an iframe acknowledges only its ancestor input-error dialog before typing',async()=>{
    const f=await setup({notice:true});try{
      await f.page.locator('#exercise').evaluate(el=>el.innerHTML='<iframe srcdoc="<fieldset><legend>Complete.</legend><textarea id=embedded></textarea></fieldset>"></iframe>');
      const frame=await (await f.page.locator('iframe').elementHandle()).contentFrame();await frame.locator('textarea').waitFor();
      const [question]=await frame.evaluate(collectQuestionsFromDOM);await fillQuestion(frame,question,{source:'AI',answers:['Shanghai–Beijing connects China’s cities.']});assert.equal(await frame.locator('textarea').inputValue(),"Shanghai-Beijing connects China's cities.");assert.equal(await f.page.evaluate(()=>window.acks),1);
    }finally{await f.page.close();await f.store.flush();}
  });

  await t.test('unknown dialogs and ambiguous or disabled character acknowledgements are preserved',async()=>{
    const f=await setup();try{
      await f.page.evaluate(()=>{const dialog=document.createElement('div');dialog.className='modal-cover';dialog.innerHTML='<div role="dialog"><p>确认提交本练习？</p><button>我知道了</button></div>';document.body.appendChild(dialog);});assert.equal(await f.page.evaluate(readInputRestrictionFromDOM),null);assert.equal(await f.page.evaluate(()=>window.acks),0);
      await f.page.locator('.modal-cover').evaluate(el=>el.remove());await f.page.evaluate(()=>window.inputNotice());await f.page.locator('[role=dialog] button').evaluate(button=>button.disabled=true);const [question]=await f.page.evaluate(collectQuestionsFromDOM);await assert.rejects(fillQuestion(f.page.mainFrame(),question,{answers:['A supported answer.']}),error=>error instanceof TextInputError);assert.equal(await f.page.locator('#answer-0').inputValue(),'');assert.equal(await f.page.evaluate(()=>window.acks),0);
    }finally{await f.page.close();await f.store.flush();}
  });

  await t.test('stopping before acknowledgement retains the validation dialog and leaves all fields untouched',async()=>{
    const f=await setup({notice:true});try{
      const controller=new AbortController();controller.abort();const [question]=await f.page.evaluate(collectQuestionsFromDOM);await assert.rejects(fillQuestion(f.page.mainFrame(),question,{answers:['A supported answer.']},{signal:controller.signal}),{name:'AbortError'});assert.equal(await f.page.evaluate(()=>window.acks),0);assert.equal(await f.page.locator('[role=dialog]').count(),1);assert.equal(await f.page.locator('#answer-0').inputValue(),'');
    }finally{await f.page.close();await f.store.flush();}
  });
}
