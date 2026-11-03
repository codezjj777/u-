import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import * as Core from '../shared/core.mjs';
import {gradedExerciseHTML,gradedAnswer,manualAnswer,translationAnswer,descriptionAnswer,letterAnswer} from './fixtures/graded-exercise.mjs';
import {videoCorrectionHTML,correctionStatements,correctionTranscript,correctionAnswers} from './fixtures/video-statement-correction.mjs';

export async function exerciseLearningBrowserCases(t,context,root){
  const stores=new Set(),loadStore=async directory=>{const store=await new Store(directory,{env:{}}).load();stores.add(store);return store;};
  try{
  const scope={courseId:'learning-book',unitId:'id-learning-tab',entryKey:JSON.stringify(['id-learning-tab',['Practice'],'Exercise 1'])};
  function configure(store,page,{mode='correct',reverse=false,startSecond=false,reuse=false}={}){
    const engine=new Automation(store),entry={key:scope.entryKey,title:'Exercise 1',path:['Practice'],required:true,pending:true,completed:false};
    const task={...scope,id:'learning-'+mode,courseTitle:'Complete English Book',unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]};
    const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')throw new Error('Unexpected review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};
    engine.pages.attach(context);engine.courseDirectory=async()=>({page:{}});
    let completed=false;engine.refreshTaskDirectory=async()=>{if(!page.isClosed())completed=await page.evaluate(()=>window.submitted===true);task.requiredTotal=1;task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...entry,completed,pending:!completed}]};};
    engine.openRequiredEntry=async()=>{engine.pages.track(page,'lesson');return page;};
    engine.askModel=async question=>{if(reuse)assert.fail('complete bank page should avoid every AI call');return Core.parseModelAnswer(JSON.stringify({answers:mode==='manual'?['An initial AI draft.']:gradedAnswer(question)}),question);};
    return {engine,task,settings:{aiEnabled:true,autoSubmit:mode!=='manual'}};
  }
  const open=async options=>{const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/graded-learning');await page.setContent(gradedExerciseHTML(options));return page;};

  await t.test('all-correct mixed types across two pages become exactly one complete bank record and are reused after option changes',async()=>{
    const directory=path.join(root,'learn-complete'),store=await loadStore(directory),page=await open({});
    const {engine,task,settings}=configure(store,page);await engine.runTask(task,{},settings,new AbortController().signal);
    assert.equal(task.status,'completed');assert.equal(store.data.bank.length,1,JSON.stringify(task.logs));
    const row=store.data.bank[0];assert.equal(row.kind,'exercise');assert.equal(row.pages.length,2);assert.deepEqual(row.pages.map(item=>item.questions.length),[3,5]);
    assert.equal(row.verification.total,8);assert.equal(row.verification.correct,8);
    const questions=row.pages.flatMap(item=>item.questions),cloze=questions.find(q=>q.fields.length===5);
    assert.equal(cloze.answer.length,5);assert.equal(cloze.wordBank.length,5);assert.match(cloze.context,/Complete original reading material/);
    assert.equal(questions.find(q=>q.question.includes('dropdowns')).fields[0].choices.length,2);
    assert.deepEqual(questions.find(q=>q.question.includes('Translate')).answer,[translationAnswer]);
    assert.deepEqual(questions.find(q=>q.question.includes('description')).answer,[descriptionAnswer]);
    assert.deepEqual(questions.find(q=>q.question.includes('Write a letter')).answer,[letterAnswer]);
    assert.equal(questions.find(q=>q.question.includes('Write a letter')).questionType,'writing_group');
    assert.doesNotMatch(JSON.stringify(row),/data-ustudy-control|selector|https:\/\//);assert.ok(task.logs.some(log=>log.message.includes('已整题入库')));
    await store.flush();const reloaded=await loadStore(directory);assert.deepEqual(reloaded.data.bank,[row]);
    const repeatPage=await open({reverse:true}),repeat=configure(reloaded,repeatPage,{reuse:true});
    await repeat.engine.runTask(repeat.task,{},repeat.settings,new AbortController().signal);
    assert.equal(repeat.task.status,'completed');assert.equal(reloaded.data.bank.length,1);
    assert.ok(repeat.task.logs.some(log=>log.message.includes('整题题库')));await reloaded.flush();
  });

  await t.test('manual corrections are captured at the real submit click rather than saving the earlier AI draft',async()=>{
    const store=await loadStore(path.join(root,'learn-manual')),page=await open({mode:'manual'}),setup=configure(store,page,{mode:'manual'});let corrected=false;
    await page.locator('#submit').evaluate(button=>button.onclick=()=>{window.submitted=true;history.replaceState({},'',location.pathname+'#writing-result');document.getElementById('exercise').innerHTML='<h2>答题小结</h2><p>共 1 道题，客观题 0 道，主观题 1 道</p><p>总得分：100 / 100</p>';document.getElementById('footer').innerHTML='';});
    const gate=setup.engine.gate.bind(setup.engine);
    setup.engine.gate=async(task,signal)=>{if(task.status==='review'&&!corrected){corrected=true;await page.locator('#manual-answer').fill(manualAnswer);await page.locator('#submit').click();task.status='running';}return gate(task,signal);};
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
    assert.equal(setup.task.status,'completed');assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));
    assert.deepEqual(store.data.bank[0].pages[0].questions[0].answer,[manualAnswer]);assert.doesNotMatch(JSON.stringify(store.data.bank),/initial AI draft/);await store.flush();
  });

  await t.test('manual final submission still combines every earlier page into one complete exercise',async()=>{
    const store=await loadStore(path.join(root,'learn-manual-multipage')),page=await open({}),setup=configure(store,page);setup.settings.autoSubmit=false;let submitted=false;
    const gate=setup.engine.gate.bind(setup.engine);
    setup.engine.gate=async(task,signal)=>{if(task.status==='review'&&!submitted){submitted=true;await page.locator('#letter').fill('Dear Chris,\n\nThis is my manually revised complete letter.\n\nSam');await page.locator('#submit').click();task.status='running';}return gate(task,signal);};
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
    assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));assert.equal(store.data.bank[0].pages.length,2);
    assert.deepEqual(store.data.bank[0].pages[1].questions.find(q=>q.question.includes('Write a letter')).answer,['Dear Chris,\n\nThis is my manually revised complete letter.\n\nSam']);await store.flush();
  });

  await t.test('a graded video exercise keeps the complete transcript and all judgement answers without signed media URLs',async()=>{
    const store=await loadStore(path.join(root,'learn-video')),page=await open({mode:'manual'});
    const transcript='Anna and Tom go to the library. It opens at eight and closes at six. They decide to meet there tomorrow.';
    await page.setContent('<main class="layout-container"><div class="abs-direction">Watch the conversation and decide whether the statements are true or false.</div><div class="layout-material-container"><div class="videoPlayer-shell"><video width="180" height="100" src="https://media.example.test/video.mp4?token=fixture-private-token"></video><div class="transcript">'+transcript+'</div></div></div><fieldset><legend>They go to the library.</legend><label><input type="radio" name="one">True.</label><label><input type="radio" name="one">False.</label></fieldset><fieldset><legend>The library closes at nine.</legend><label><input type="radio" name="two">True.</label><label><input type="radio" name="two">False.</label></fieldset><button id="submit" onclick="window.submitted=true;document.querySelector(\'main\').innerHTML=\'<h2>答题小结</h2><p>共 2 道题，客观题 2 道，主观题 0 道</p><p>正确 (2/2)</p><p>错误 (0/2)</p><p>未作答 0</p>\'">提交</button></main>');
    const setup=configure(store,page);setup.engine.askModel=async q=>Core.parseModelAnswer(JSON.stringify({answers:[q.question.includes('at nine')?'False.':'True.']}),q);
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
    assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));const parts=store.data.bank[0].pages[0].questions;
    assert.equal(parts.length,2);assert.ok(parts.every(q=>q.context.includes(transcript)&&q.mediaKeys.length===1));
    assert.deepEqual(parts.map(q=>q.answer),[['True.'],['False.']]);assert.doesNotMatch(JSON.stringify(store.data.bank),/fixture-private-token|https:\/\//);await store.flush();
  });

  await t.test('five all-correct video statement corrections save one complete exercise including the transcript and reuse all five answers',async()=>{
    const store=await loadStore(path.join(root,'learn-video-corrections'));
    const show=async()=>{
      const page=await open({mode:'manual'});await page.setContent(videoCorrectionHTML({embedded:true}).replaceAll('Viewing and understanding','Practice').replace('>Exercise 2<','>Exercise 1<'));
      await page.locator('#submit').evaluate(button=>button.onclick=()=>{window.submitted=true;document.querySelector('main').innerHTML='<h2>答题小结</h2><p>共 5 道题，客观题 0 道，主观题 5 道</p><p>正确 (5/5)</p><p>错误 (0/5)</p><p>未作答 0</p>';button.remove();});return page;
    };
    const setup=configure(store,await show());setup.engine.askModel=async q=>Core.parseModelAnswer(JSON.stringify({answers:[correctionAnswers[correctionStatements.findIndex(statement=>q.question.includes(statement))]]}),q);
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);assert.equal(setup.task.status,'completed');assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));
    const exercise=store.data.bank[0],parts=exercise.pages[0].questions;assert.equal(exercise.kind,'exercise');assert.equal(exercise.pages.length,1);assert.equal(parts.length,5);assert.equal(exercise.verification.total,5);assert.deepEqual(parts.map(q=>q.answer[0]),correctionAnswers);assert.ok(parts.every(q=>q.context.includes(correctionTranscript)&&q.mediaKeys.length===1));assert.doesNotMatch(JSON.stringify(exercise),/fixture-private-token|https:\/\//);
    const repeat=configure(store,await show(),{reuse:true});await repeat.engine.runTask(repeat.task,{},repeat.settings,new AbortController().signal);assert.equal(repeat.task.status,'completed');assert.equal(store.data.bank.length,1);await store.flush();
  });

  await t.test('a manually verified no-selection multiple-choice answer is stored completely and can clear old selections on reuse',async()=>{
    const store=await loadStore(path.join(root,'learn-none'));
    const show=async()=>{const page=await open({mode:'manual'});await page.setContent('<main><fieldset><legend>Select all valid options; leave unselected if none.</legend><label><input type="checkbox" id="old-selection" checked>Invalid first option</label><label><input type="checkbox">Invalid second option</label></fieldset><button id="submit" onclick="window.submitted=true;document.querySelector(\'main\').innerHTML=\'<h2>答题小结</h2><p>共 1 道题，客观题 1 道，主观题 0 道</p><p>正确 (1/1)</p><p>错误 (0/1)</p><p>未作答 0</p>\'">提交</button></main>');return page;};
    const page=await show(),setup=configure(store,page,{mode:'manual'});setup.engine.askModel=async q=>Core.parseModelAnswer(JSON.stringify({answers:['Invalid first option']}),q);let submitted=false;
    const gate=setup.engine.gate.bind(setup.engine);setup.engine.gate=async(task,signal)=>{if(task.status==='review'&&!submitted){submitted=true;await page.locator('#old-selection').uncheck();await page.locator('#submit').click();task.status='running';}return gate(task,signal);};
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
    assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));assert.deepEqual(store.data.bank[0].pages[0].questions[0].answer,[]);
    const repeat=configure(store,await show(),{reuse:true});await repeat.engine.runTask(repeat.task,{},repeat.settings,new AbortController().signal);assert.equal(repeat.task.status,'completed');await store.flush();
  });

  await t.test('automatic submission captures a whole exercise across visible question frames',async()=>{
    const handler=route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><fieldset><legend>Frame ${route.request().url().endsWith('1')?'one':'two'} answer?</legend><input type="text"></fieldset></body></html>`});
    await context.route('**/learn-frame-*',handler);
    const store=await loadStore(path.join(root,'learn-frames')),page=await open({mode:'manual'});
    try{
      await page.setContent('<main><fieldset><legend>Main answer?</legend><input type="text"></fieldset><iframe src="https://ucontent.unipus.cn/learn-frame-1"></iframe><iframe src="https://ucontent.unipus.cn/learn-frame-2"></iframe><button id="submit" onclick="window.submitted=true;document.querySelector(\'main\').innerHTML=\'<h2>答题小结</h2><p>共 3 道题，客观题 3 道，主观题 0 道</p><p>正确 (3/3)</p><p>错误 (0/3)</p><p>未作答 0</p>\'">提交</button></main>');
      await page.frameLocator('iframe').first().locator('input').waitFor();
      const setup=configure(store,page);setup.engine.askModel=async q=>Core.parseModelAnswer(JSON.stringify({answers:[q.question.startsWith('Main')?'main':q.question.includes('one')?'one':'two']}),q);
      await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
      assert.equal(store.data.bank.length,1,JSON.stringify(setup.task.logs));assert.deepEqual(store.data.bank[0].pages[0].questions.map(q=>q.answer),[['main'],['one'],['two']]);await store.flush();
    }finally{await context.unroute('**/learn-frame-*',handler);if(!page.isClosed())await page.close();}
  });

  for(const scenario of [{mode:'pass'},{mode:'pending'},{startSecond:true}])await t.test(`completion does not save a non-perfect, pending or partially captured exercise: ${JSON.stringify(scenario)}`,async()=>{
    const store=await loadStore(path.join(root,'learn-reject-'+(scenario.mode||'partial'))),page=await open(scenario),setup=configure(store,page,scenario);
    await setup.engine.runTask(setup.task,{},setup.settings,new AbortController().signal);
    assert.equal(setup.task.status,'completed');assert.equal(store.data.bank.length,0,JSON.stringify(setup.task.logs));
    assert.ok(setup.task.logs.some(log=>log.message.includes('未自动入库')));await store.flush();
  });
  }finally{for(const store of stores){clearTimeout(store.saveTimer);store.saveTimer=null;}await Promise.all([...stores].map(store=>store.writeQueue));}
}
