import assert from 'node:assert/strict';
import path from 'node:path';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {sentenceMatchingHTML,matchingPrompts,matchingMap,matchingAnswers} from './fixtures/sentence-matching.mjs';

export async function matchingBrowserCases(t,context,root){
  const open=async options=>{const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/sentence-matching');await page.setContent(sentenceMatchingHTML(options));return page;};
  const prepared=async frame=>{const report=await frame.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);const q=report.questions[0],signature=Core.questionSignature([q]),answer=Core.parseModelAnswer(JSON.stringify({answers:q.prompts.map(prompt=>matchingAnswers[matchingPrompts.indexOf(prompt)])}),q);return {q,answer,checkpoint:async()=>assert.equal(Core.questionSignature(await frame.evaluate(collectQuestionsFromDOM)),signature)};};

  for(const mode of ['pointer','html5'])await t.test(`${mode} drag commits every matching pair through browser input and survives asynchronous card re-render and letter renumbering`,async()=>{
    const page=await open({mode});try{
      const {q,answer,checkpoint}=await prepared(page.mainFrame());await fillQuestion(page.mainFrame(),q,answer,{checkpoint});await verifyQuestion(page.mainFrame(),q,answer,{checkpoint});
      const state=await page.evaluate(()=>({order:window.answerOrder,events:window.dragEvents,submitted:window.submitted}));assert.deepEqual(state.order,matchingMap);assert.ok(state.events>0);assert.equal(state.submitted,false);
    }finally{await page.close();}
  });

  await matchingRepaintBrowserCases(t,context);

  await t.test('pointer matching scrolls to off-screen cards in a visible lesson frame',async()=>{
    const page=await open({});try{
      await page.setContent('<iframe style="width:100%;height:510px;border:0"></iframe>');const frame=page.frames()[1];await frame.setContent(sentenceMatchingHTML({tall:true,pressRender:'container',repaintOnScroll:true}));
      const {q,answer,checkpoint}=await prepared(frame);await fillQuestion(frame,q,answer,{checkpoint});assert.deepEqual(await frame.evaluate(()=>window.answerOrder),matchingMap);
      assert.ok(await frame.evaluate(()=>window.scrollRepaints>0));
    }finally{await page.close();}
  });

  for(const mode of ['inert','revert'])await t.test(`a ${mode} sortable never counts as filled and cannot reach submit`,async()=>{
    const page=await open({mode});try{const {q,answer,checkpoint}=await prepared(page.mainFrame());await assert.rejects(fillQuestion(page.mainFrame(),q,answer,{checkpoint}),/配对.*(?:拖动|回退|顺序)/);assert.equal(await page.evaluate(()=>window.submitted),false);}finally{await page.close();}
  });

  await t.test('cancelling during a held drag always releases the mouse and does not submit',async()=>{
    const page=await open({});try{
      const controller=new AbortController();await page.exposeFunction('__cancelFixtureDrag',()=>controller.abort(new Error('fixture-cancelled')));await page.evaluate(()=>document.addEventListener('mousedown',()=>void window.__cancelFixtureDrag(),{once:true}));
      const {q,answer,checkpoint}=await prepared(page.mainFrame());await assert.rejects(fillQuestion(page.mainFrame(),q,answer,{checkpoint,signal:controller.signal}),/fixture-cancelled|aborted/);
      assert.equal(await page.evaluate(()=>window.pointerReleased),true);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });

  await t.test('a real sentence edit during a gesture stops the writer before any submission',async()=>{
    const page=await open({});try{
      const {q,answer,checkpoint}=await prepared(page.mainFrame());await page.evaluate(()=>document.addEventListener('mousedown',()=>setTimeout(()=>document.querySelector('.sequence-question-view-item-text').append(' changed'),30),{once:true}));
      await assert.rejects(fillQuestion(page.mainFrame(),q,answer,{checkpoint}),/Expected values/);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });

  await t.test('platform-confirmed ten-pair matching is one complete durable record and reuses every pair after both columns change order',async()=>{
    const directory=path.join(root,'learn-matching'),store=await new Store(directory,{env:{}}).load();
    const scope={courseId:'matching-book',unitId:'unit-matching',entryKey:JSON.stringify(['unit-matching',['Language focus'],'Exercise 1'])};
    const configure=(page,localStore,{reuse=false}={})=>{
      const engine=new Automation(localStore),entry={key:scope.entryKey,title:'Exercise 1',path:['Language focus'],required:true,pending:true,completed:false},task={...scope,id:'matching-'+(reuse?'repeat':'first'),courseTitle:'Complete English Book',unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]};
      const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')throw new Error('Unexpected review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};
      engine.pages.attach(context);engine.courseDirectory=async()=>({page:{}});let completed=false;engine.refreshTaskDirectory=async()=>{if(!page.isClosed())completed=await page.evaluate(()=>window.submitted===true);task.requiredTotal=1;task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...entry,completed,pending:!completed}]};};engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson');return page;};
      engine.askModel=async q=>{if(reuse)assert.fail('verified matching must use the whole-exercise bank');return Core.parseModelAnswer(JSON.stringify({answers:q.prompts.map(prompt=>matchingAnswers[matchingPrompts.indexOf(prompt)])}),q);};
      return {engine,task,settings:{aiEnabled:true,autoSubmit:true}};
    };
    try{
      const page=await open({pressRender:'sequence'}),setup=configure(page,store);await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);assert.equal(setup.task.status,'completed',JSON.stringify(setup.task.logs));assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));
      const row=store.data.bank[0],part=row.pages[0].questions[0];assert.equal(row.kind,'exercise');assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,1);assert.equal(row.verification.total,10);assert.deepEqual(part.prompts,matchingPrompts);assert.equal(part.options.length,10);assert.equal(part.fields[0].items.length,10);assert.deepEqual(part.answer,matchingAnswers);assert.doesNotMatch(JSON.stringify(row),/data-ustudy|selector/);
      await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.deepEqual(restored.data.bank,[row]);
      try{const repeat=configure(await open({reverse:true,pressRender:'container'}),restored,{reuse:true});await repeat.engine.runTask(repeat.task,{},repeat.settings,new AbortController().signal);assert.equal(repeat.task.status,'completed',JSON.stringify(repeat.task.logs));assert.equal(restored.data.bank.length,1);assert.ok(repeat.task.logs.some(log=>log.message.includes('整题题库')));assert.ok(repeat.task.logs.some(log=>log.message.includes('10 对')));}finally{await restored.flush();}
    }finally{await store.flush();}
  });
}

export async function matchingRepaintBrowserCases(t,context){
  for(const pressRender of ['cards','container','sequence'])await t.test(`matching rebinds by content when ${pressRender} are replaced on mouse-down before the first move`,async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/sentence-matching');await page.setContent(sentenceMatchingHTML({pressRender}));
      const [question]=await page.evaluate(collectQuestionsFromDOM),signature=Core.questionSignature([question]),answer=Core.parseModelAnswer(JSON.stringify({answers:matchingAnswers}),question);
      const checkpoint=async()=>assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),signature);
      await fillQuestion(page.mainFrame(),question,answer,{checkpoint});await verifyQuestion(page.mainFrame(),question,answer,{checkpoint});
      const state=await page.evaluate(()=>({order:window.answerOrder,repaints:window.pressRepaints,submitted:window.submitted}));assert.deepEqual(state.order,matchingMap);assert.ok(state.repaints>0);assert.equal(state.submitted,false);
    }finally{await page.close();}
  });

  await t.test('matching succeeds without temporary DOM marks and scopes repeated option pools to their fixed left column',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/sentence-matching');await page.setContent(sentenceMatchingHTML());
      await page.evaluate(()=>{const other=document.querySelector('.sequence-view').cloneNode(true);other.id='other-matching';other.querySelector('.sequence-question-view-item-text').append(' A different question.');document.getElementById('exercise').append(other);});
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,2);
      const question=report.questions[0],answer=Core.parseModelAnswer(JSON.stringify({answers:matchingAnswers}),question);
      await page.evaluate(()=>{for(const node of document.querySelectorAll('*'))for(const attribute of [...node.attributes])if(attribute.name.startsWith('data-ustudy-'))node.removeAttribute(attribute.name);});
      await fillQuestion(page.mainFrame(),question,answer);await verifyQuestion(page.mainFrame(),question,answer);
      assert.deepEqual(await page.evaluate(()=>window.answerOrder),matchingMap);assert.deepEqual(await page.locator('#other-matching .sequence-reply-view-item-text').evaluateAll(items=>items.map(el=>Number(el.dataset.optionId))),[1,2,0,3,4,5,6,7,8,9]);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });

  await t.test('identical matching groups are rejected as ambiguous before any drag',async()=>{
    const page=await context.newPage();try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/sentence-matching');await page.setContent(sentenceMatchingHTML());
      const [question]=await page.evaluate(collectQuestionsFromDOM),answer=Core.parseModelAnswer(JSON.stringify({answers:matchingAnswers}),question);
      await page.evaluate(()=>document.getElementById('exercise').append(document.querySelector('.sequence-view').cloneNode(true)));
      await assert.rejects(fillQuestion(page.mainFrame(),question,answer),/容器已变化/);assert.equal(await page.evaluate(()=>window.dragEvents),0);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
}
