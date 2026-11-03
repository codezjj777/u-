import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {fillQuestion,verifyQuestion} from '../answer-writer.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import * as Core from '../shared/core.mjs';
import {dropdownHTML,dropdownAnswers,dropdownOptions} from './fixtures/dropdown-exercise.mjs';

export async function dropdownBrowserCases(t,context,root){
  const scope={courseId:'dropdown-book',unitId:'dropdown-unit',entryKey:JSON.stringify(['dropdown-unit',['Further exploration','Viewing and understanding'],'Exercise 2'])};
  const open=async options=>{const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/dropdown');await page.setContent(dropdownHTML(options));return page;};
  const read=page=>page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});
  const state=page=>page.evaluate(()=>({opens:window.openCount,clicks:window.optionClicks,trusted:window.trustedClicks,submitted:window.submitted,values:[...document.querySelectorAll('.user-answer')].map(el=>el.classList.contains('empty')?'':el.querySelector('.user-answer-text').textContent)}));
  await t.test('four dropdowns fill through trusted menu clicks despite React-style wrapper replacement and hidden stale portals',async()=>{
    const page=await open({});try{
      const initial=await read(page),[question]=initial.questions,signature=Core.questionSignature(initial.questions);assert.equal(initial.issues.length,0);assert.deepEqual(question.blankOptions,dropdownOptions);
      await fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers},{checkpoint:async()=>assert.equal(Core.questionSignature((await read(page)).questions),signature)});await verifyQuestion(page.mainFrame(),question,{answers:dropdownAnswers});
      const actual=await state(page);assert.deepEqual(actual.values,dropdownAnswers);assert.equal(actual.opens,4);assert.equal(actual.clicks,4);assert.deepEqual(actual.trusted,[true,true,true,true]);assert.equal(actual.submitted,false);assert.equal(Core.questionSignature((await read(page)).questions),signature);
      await fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers});assert.equal((await state(page)).clicks,4,'already committed values do not reopen menus');
    }finally{await page.close();}
  });
  for(const mode of ['appear','zero-width','aria-stale'])await t.test(`a ${mode} menu uses the same validated option for its trusted click`,async()=>{
    const page=await open({mode});try{
      const [question]=(await read(page)).questions;
      await fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers});await verifyQuestion(page.mainFrame(),question,{answers:dropdownAnswers});
      const actual=await state(page);assert.deepEqual(actual.values.map(value=>value.replace(/[\u200b-\u200d\ufeff]/g,'')),dropdownAnswers);assert.equal(actual.opens,4);assert.equal(actual.clicks,4);assert.deepEqual(actual.trusted,[true,true,true,true]);assert.equal(actual.submitted,false);
      assert.equal(await page.locator('[data-ustudy-dropdown-option]').count(),0);
    }finally{await page.close();}
  });
  await t.test('a background tab can finish dropdown filling while the other tab remains focused',async()=>{
    const page=await open({}),other=await context.newPage(),sessions=[];try{
      // Playwright emulates focus on every page by default. Disable that for
      // this case so hasFocus observes real tab activation instead.
      for(const target of [page,other]){const session=await context.newCDPSession(target);sessions.push(session);await session.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
      await other.setContent('<p>Other work remains in front</p>');await other.bringToFront();assert.equal(await other.evaluate(()=>document.hasFocus()),true);assert.equal(await page.evaluate(()=>document.hasFocus()),false);
      const [question]=(await read(page)).questions;await fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers});await verifyQuestion(page.mainFrame(),question,{answers:dropdownAnswers});
      assert.deepEqual((await state(page)).values,dropdownAnswers);assert.equal(await other.evaluate(()=>document.hasFocus()),true);
    }finally{for(const session of sessions)await session.detach();await other.close();await page.close();}
  });
  for(const mode of ['mismatch','duplicate','disabled','revert'])await t.test(`a ${mode} dropdown stops without repeating menu selections or submitting`,async()=>{
    const page=await open({mode});try{
      const [question]=(await read(page)).questions;await assert.rejects(fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers}),/下拉/);const actual=await state(page);assert.equal(actual.opens,1);assert.equal(actual.clicks,mode==='revert'?1:0);assert.equal(actual.submitted,false);
    }finally{await page.close();}
  });
  await t.test('unknown or changed answers are rejected before any dropdown opens',async()=>{
    const page=await open({});try{const [question]=(await read(page)).questions;await assert.rejects(fillQuestion(page.mainFrame(),question,{answers:['Unknown',...dropdownAnswers.slice(1)]}),/当前选项/);assert.equal((await state(page)).opens,0);}finally{await page.close();}
  });
  await t.test('a real stem change while opening a menu prevents choosing a stale answer',async()=>{
    const page=await open({mode:'changed-stem'});try{const initial=await read(page),signature=Core.questionSignature(initial.questions);await assert.rejects(fillQuestion(page.mainFrame(),initial.questions[0],{answers:dropdownAnswers},{checkpoint:async()=>{if(Core.questionSignature((await read(page)).questions)!==signature)throw new Error('changed stem');}}),/changed stem/);assert.equal((await state(page)).clicks,0);}finally{await page.close();}
  });
  await t.test('stopping with a menu open never clicks an option and a later manual dropdown draft is retained',async()=>{
    const page=await open({}),controller=new AbortController(),engine=new Automation({data:{}});try{
      engine.pages.attach(context);engine.pages.track(page,'lesson');const [question]=(await read(page)).questions;
      await assert.rejects(fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers},{signal:controller.signal,checkpoint:async()=>{if((await state(page)).opens)controller.abort(new Error('stop-dropdown'));}}),/stop-dropdown/);assert.equal((await state(page)).clicks,0);
      await page.evaluate(()=>document.querySelectorAll('.scoop-select-dropdown').forEach(el=>el.remove()));await fillQuestion(page.mainFrame(),question,{answers:dropdownAnswers});assert.equal((await engine.pages.release(page)).reason,'draft');assert.equal(page.isClosed(),false);
    }finally{await page.close();}
  });
  await t.test('a visible iframe dropdown uses its own portal and commits every field',async()=>{
    const page=await context.newPage();try{
      await page.route('**/dropdown-frame',route=>route.fulfill({contentType:'text/html',body:dropdownHTML({})}));await page.goto('https://ucontent.unipus.cn/offline-recognition/dropdown-parent');await page.setContent('<iframe style="width:1100px;height:800px" src="https://ucontent.unipus.cn/offline-recognition/dropdown-frame"></iframe>');const frame=page.frames().find(frame=>frame.url().endsWith('/dropdown-frame'))||await page.waitForEvent('framenavigated',{timeout:5000,predicate:frame=>frame.url().endsWith('/dropdown-frame')});
      const [question]=(await frame.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true})).questions;await fillQuestion(frame,question,{answers:dropdownAnswers});await verifyQuestion(frame,question,{answers:dropdownAnswers});assert.equal(await frame.evaluate(()=>window.optionClicks),4);
    }finally{await page.close();}
  });
  function configure(store,page,{reuse=false}={}){
    const engine=new Automation(store),entry={key:scope.entryKey,title:'Exercise 2',path:['Further exploration','Viewing and understanding'],required:true,pending:true,completed:false};let complete=false;
    const task={...scope,id:'dropdown-'+Math.random(),currentEntry:'Further exploration / Viewing and understanding / Exercise 2',courseTitle:'Offline dropdown book',unitLabel:'Unit 5',status:'running',logs:[],manualItems:[],answered:0,pages:0};
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>{if(!page.isClosed())complete=await page.evaluate(()=>window.submitted);return {ready:true,activeUnitId:scope.unitId,entries:[{...entry,completed:complete,pending:!complete}]};};engine.openRequiredEntry=async()=>page;
    const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')throw new Error('Unexpected dropdown review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};
    engine.askModel=async question=>{assert.equal(reuse,false,'whole exercise bank must supply all answers');assert.deepEqual(question.blankOptions,dropdownOptions);return Core.parseModelAnswer(JSON.stringify({answers:dropdownAnswers}),question);};store.apiKey='offline-fixture';return {engine,entry,task,settings:{aiEnabled:true,autoSubmit:true}};
  }
  await t.test('a broken dropdown with a legacy mark pauses for review and can never be remembered as an empty page',async()=>{
    const page=await open({}),store={directory:'.cache',data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});},findManualEntry:()=>({reason:'no-fillable-questions',handler:'video-view-v1'}),rememberManualEntry:async()=>assert.fail('answer controls cannot become no-answer marks')};
    try{
      const f=configure(store,page);await page.locator('.scoop-select-wrapper').first().locator('div').first().evaluate(el=>el.remove());
      const wait=f.engine.waitQuestions.bind(f.engine);f.engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:750});
      await assert.rejects(f.engine.runTask(f.task,{},f.settings,new AbortController().signal),/Unexpected dropdown review/);assert.equal(f.task.status,'review');assert.equal((await state(page)).clicks,0);assert.equal((await state(page)).submitted,false);
    }finally{await page.close();}
  });
  await t.test('an old false no-answer mark is retried, and all four platform-correct dropdown answers become one full bank row and are reused',async()=>{
    const directory=path.join(root,'dropdown-bank'),store=await new Store(directory,{env:{}}).load(),page=await open({});let repeat;
    try{
      const f=configure(store,page);await store.rememberManualEntry(f.task,{},'no-fillable-questions','video-view-v1');await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(store.findManualEntry(f.task),null);assert.equal(store.data.bank.length,1);
      const row=store.data.bank[0];assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,1);assert.equal(row.pages[0].questions[0].fields.length,4);assert.deepEqual(row.pages[0].questions[0].answer,dropdownAnswers);assert.deepEqual(row.pages[0].questions[0].blankOptions,dropdownOptions);assert.equal(row.verification.total,4);assert.equal(row.verification.unit,'blanks');await store.flush();
      const reloaded=await new Store(directory,{env:{}}).load();repeat=await open({reverse:true});const next=configure(reloaded,repeat,{reuse:true});await next.engine.runTask(next.task,{},next.settings,new AbortController().signal);assert.equal(next.task.status,'completed');assert.equal(reloaded.data.bank.length,1);await reloaded.flush();
    }finally{if(!page.isClosed())await page.close();if(repeat&&!repeat.isClosed())await repeat.close();await store.flush();}
  });
  await t.test('a preview reads four dropdowns and their transcript without selecting answers or altering the old mark',async()=>{
    const page=await open({}),store={directory:'.cache',data:{tasks:[],courses:[{id:scope.courseId}],settings:{}},changed(){},addLog(){},addActivity(){}};try{
      const f=configure(store,page);f.engine.prepareDirectory=async()=>({ready:true,activeUnitId:scope.unitId,entries:[f.entry]});f.engine.askModel=f.engine.fillQuestion=f.engine.verifyQuestion=async()=>assert.fail('read-only preview must not solve, fill or submit');
      f.engine.pages.release=async()=>({status:'retained'});
      const result=await f.engine.previewMedia({...scope,solve:false});assert.equal(result.ready,true);assert.equal(result.questions.length,1);assert.equal(result.questions[0].blankCount,4);assert.equal(result.written,false);assert.equal(result.submitted,false);assert.equal((await state(page)).opens,0);
    }finally{if(!page.isClosed())await page.close();}
  });
}
