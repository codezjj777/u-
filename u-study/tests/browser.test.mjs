import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {Store} from '../store.mjs';
import {createApp} from '../server.mjs';
import {collectQuestionsFromDOM,readLearningStateFromDOM} from '../platform-dom.mjs';
import {collectDirectoryFromDOM} from '../course-directory.mjs';
import {fillQuestion} from '../answer-writer.mjs';
import {PageLifecycle} from '../page-lifecycle.mjs';
import {buildCore} from '../build-core.mjs';
import {Automation} from '../automation.mjs';
import * as Core from '../shared/core.mjs';
import {MediaMaterials} from '../media-materials.mjs';
import {multiPageExerciseHTML} from './fixtures/multi-page-exercise.mjs';
import {inlineWordBankHTML,inlineWordBankAnswers} from './fixtures/inline-word-bank.mjs';
import {exerciseLearningBrowserCases} from './exercise-learning-browser.mjs';
import {matchingBrowserCases} from './matching-browser.mjs';
import {realMatchingBrowserCases} from './real-matching-browser.mjs';
import {partMatchingBrowserCases} from './part-matching-browser.mjs';
import {functionMatchingBrowserCases} from './function-matching-browser.mjs';
import {questionResponseBrowserCases} from './question-response-browser.mjs';
import {backgroundBrowserCases} from './background-browser.mjs';
import {studyNoticeBrowserCases} from './study-notice-browser.mjs';
import {videoFramesBrowserCases} from './video-frames-browser.mjs';
import {lessonActionsBrowserCases} from './lesson-actions-browser.mjs';
import {answerBlockerBrowserCases} from './answer-blocker-browser.mjs';
import {bankedClozeBrowserCases} from './banked-cloze-browser.mjs';
import {shutdownBrowserCases} from './shutdown-browser.mjs';
import {discussionBoardBrowserCases} from './discussion-board-browser.mjs';
import {aiRecoveryBrowserCases} from './ai-recovery-browser.mjs';
import {videoCorrectionBrowserCases} from './video-correction-browser.mjs';
import {pictureBrowserCases} from './picture-browser.mjs';
import {submissionCompletionBrowserCases} from './submission-completion-browser.mjs';
import {correctionCoverageBrowserCases} from './correction-coverage-browser.mjs';
import {textInputBrowserCases} from './text-input-browser.mjs';
import {readingDiscussionBrowserCases} from './reading-discussion-browser.mjs';
import {sentenceCreationBrowserCases} from './sentence-creation-browser.mjs';
import {vocabularyBrowserCases} from './vocabulary-browser.mjs';
import {videoViewBrowserCases} from './video-view-browser.mjs';
import {audioViewBrowserCases} from './audio-view-browser.mjs';
import {dropdownBrowserCases} from './dropdown-browser.mjs';
import {oralBrowserCases} from './oral-browser.mjs';
import {roleplayBrowserCases} from './roleplay-browser.mjs';
import {courseNavigationBrowserCases} from './course-navigation-browser.mjs';
import {courseProgressBrowserCases} from './course-progress-browser.mjs';

const fixtureHTML=`<!doctype html><html><body>
<style>#mask{position:fixed;inset:0;z-index:20;background:#ddd}fieldset{margin-top:40px}.courses-unit_taskStateContainer{position:absolute;left:250px}</style>
<div id="mask" aria-busy="true">加载中</div><div class="passage">The passage recommends walking.</div>
<fieldset id="question" hidden><legend>Choose the correct answer.</legend><label><input type="radio" name="answer" value="walk">Walk</label><label><input type="radio" name="answer" value="bus">Take the bus</label></fieldset>
<iframe src="/frame"></iframe><a id="popup" href="/popup" target="_blank">Open exercise</a>
<div class="courses-unit_unitTabBody"><div id="id-unit4-tab" class="unipus-tabs_tabItemContainer unipus-tabs_tabActive"><span title="Unit 4">Unit 4</span></div></div>
<div id="tab-unit-body-container"><div class="unipus-tabs_itemActive"><div class="courses-unit_unitNameLabel">Offline Unit</div><div class="courses-unit_taskItemContainer"><div class="courses-unit_taskNameContainer"><button class="courses-unit_taskDian">○</button><span class="courses-unit_taskTypeName">Exercise 1</span><span class="courses-unit_taskRequireIcon">必修</span></div><div class="courses-unit_taskStateContainer"><span class="courses-unit_nodePassStateTip">未开始</span></div></div></div></div>
<script>setTimeout(()=>{document.getElementById('mask').remove();document.getElementById('question').hidden=false;},350);document.querySelector('.courses-unit_taskDian').onclick=()=>document.querySelector('.courses-unit_nodePassStateTip').textContent='已完成';</script>
</body></html>`;

test('isolated real-browser integration',async t=>{
  await buildCore();const directory=await mkdtemp(path.resolve('.cache/browser-test-'));
  const store=await new Store(path.join(directory,'data'),{env:{}}).load();
  const logs=Array.from({length:150},(_,i)=>({message:`Log ${i}: ${'x'.repeat(80)}`,timestamp:i+1,level:'info'}));
  store.data.tasks=Array.from({length:50},(_,i)=>({id:'task-'+i,status:i===0?'running':'completed',courseTitle:'Offline course',logs:logs.map(log=>({...log})),answered:0,pages:0}));
  const server=createApp({store,automation:{busy:()=>false},port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/frame'?'<fieldset><legend>Fill the missing word.</legend><input type="text"></fieldset>':req.url==='/popup'?'<h1>Offline exercise popup</h1>':fixtureHTML);});
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,fixtureBase=`http://127.0.0.1:${fixture.address().port}`;
  let context;
  try{
    context=await chromium.launchPersistentContext(path.join(directory,'browser'),{channel:process.env.USTUDY_TEST_BROWSER||'msedge',headless:true,chromiumSandbox:true,timeout:20000,args:['--disable-features=MediaSessionService,HardwareMediaKeyHandling,AudioFocusEnforcement']});
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith('https://ucontent.unipus.cn/offline-tab-test/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><p>Offline exercise</p><textarea id="answer"></textarea><div contenteditable="true" id="essay"></div></body></html>'});
      if(url.startsWith('https://ucontent.unipus.cn/offline-recognition/')){
        const name=new URL(url).pathname.split('/').pop();
        const body=name==='main'?'<div class="question-item"><h3>Complete the main question.</h3><input id="main-answer"></div><iframe src="one"></iframe><iframe src="two"></iframe><div hidden><iframe src="stale"></iframe></div><button id="submit" onclick="window.submitted=true">提交</button>':`<div class="question-item"><h3>Complete the ${name} question.</h3><input id="${name}-answer"></div>`;
        return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><body>${body}</body></html>`});
      }
      return url.startsWith(base+'/')||url.startsWith(fixtureBase+'/')?route.continue():route.abort();
    });
    await context.addInitScript(()=>localStorage.setItem('ustudy-demo','false'));
    await t.test('large SSE histories stay connected, log nodes survive updates and reading focus is retained',async()=>{
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);await page.locator('.task-live-log .log-line').first().waitFor({state:'attached'});
      await page.locator('[data-view="tasks"]').first().click();
      await page.evaluate(()=>{const box=document.querySelector('.task-live-log');box.scrollTop=0;window.savedLog=box;window.savedLine=box.firstElementChild;});
      await page.locator('[data-task-action="stop"]').focus();
      store.data.tasks[0].answered=1;store.data.tasks[0].logs=store.data.tasks[0].logs.slice(1);store.data.tasks[0].logs.push({message:'Latest browser update',timestamp:999,level:'info'});store.changed({persist:false});
      await page.getByText('Latest browser update',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.savedLog===document.querySelector('.task-live-log')),true);
      assert.equal(await page.evaluate(()=>document.querySelector('.task-live-log').scrollTop),0);
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.taskAction),'stop');
      assert.deepEqual(errors,[]);await page.close();
    });
    await t.test('complete bank export downloads every part and preserves the importable exercise format',async()=>{
      const previous=store.data.bank;
      const exercise=Core.validateExercise({kind:'exercise',version:1,title:'Exported full exercise',scope:{courseId:'book',unitId:'unit',entryKey:'leaf'},pages:[{number:1,questions:[{question:'Write both answers.',type:'text',options:[],context:'Complete exported material.',wordBank:['first','second'],blankOptions:[[],[]],fields:[{kind:'text'},{kind:'text'}],answer:['first','second']}]}],verification:{method:'platform-all-correct',total:2,correct:2,unit:'blanks',verifiedAt:1},learnedAt:1});
      store.data.bank=[exercise];store.changed({persist:false});const page=await context.newPage();
      try{
        await page.goto(base);await page.locator('button[data-action="settings"]').first().click();
        await page.locator('#export-bank').waitFor({state:'visible'});
        assert.match(await page.locator('#bank-status').textContent(),/1.*1/);
        const completed=page.waitForEvent('download');await page.locator('#export-bank').click();const download=await completed;
        const file=path.join(directory,'exported-question-bank.json');await download.saveAs(file);
        const exported=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(exported,[exercise]);assert.deepEqual(Core.validateBank(exported),[exercise]);
      }finally{store.data.bank=previous;store.changed({persist:false});await page.close();}
    });
    await t.test('delayed inputs, iframe questions, popup navigation and directory status work in a real layout',async()=>{
      const page=await context.newPage();await page.goto(fixtureBase);
      assert.equal((await page.evaluate(readLearningStateFromDOM)).loading,true);
      assert.deepEqual(await page.evaluate(collectQuestionsFromDOM,{questionSelector:'#question'}),[]);
      await page.locator('#mask').waitFor({state:'detached'});
      const questions=await page.evaluate(collectQuestionsFromDOM,{questionSelector:'#question'});assert.equal(questions.length,1);assert.match(questions[0].context,/walking/);
      await fillQuestion(page.mainFrame(),questions[0],{indexes:[0],answers:['Walk']});assert.equal(await page.locator('input[value=walk]').isChecked(),true);
      const embedded=page.frames().find(frame=>frame.url().endsWith('/frame'));const blanks=await embedded.evaluate(collectQuestionsFromDOM,{questionSelector:'fieldset'});
      await fillQuestion(embedded,blanks[0],{answers:['walking']});assert.equal(await embedded.locator('input').inputValue(),'walking');
      let directoryState=await page.evaluate(collectDirectoryFromDOM);assert.equal(directoryState.entries[0].pending,true);
      await page.locator(directoryState.entries[0].selector).click();directoryState=await page.evaluate(collectDirectoryFromDOM);assert.equal(directoryState.entries[0].completed,true);
      const popupWait=page.waitForEvent('popup');await page.locator('#popup').click();const popup=await popupWait;await popup.waitForLoadState();assert.equal(popup.url(),fixtureBase+'/popup');await popup.close();await page.close();
    });
    await t.test('all visible frames are filled once and the parent submit button is found',async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/main');
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}};
      const engine=new Automation(localStore),snapshot=await engine.readQuestions(page,{});
      assert.equal(snapshot.questions.length,3);assert.equal(snapshot.frames.length,3);assert.deepEqual(snapshot.issues,[]);
      localStore.data.bank=Core.validateBank(snapshot.questions.map((q,i)=>({question:q.question,answer:'answer '+i})));
      engine.waitSubmissionFeedback=async()=>({summary:false,failed:false});
      const task={id:'offline-frames',status:'running',answered:0,pages:0,logs:[]};
      const result=await engine.answerEntryAttempt(task,page,{autoSubmit:true},new AbortController().signal);
      assert.equal(task.answered,3);assert.equal(await page.evaluate(()=>window.submitted),true,JSON.stringify({result,logs:task.logs}));
      for(const [i,question] of snapshot.questions.entries())assert.equal(await snapshot.questionFrames[i].locator(question.targets[0].selector).inputValue(),'answer '+i);
      const stale=page.frames().find(frame=>frame.url().endsWith('/stale'));assert.equal(await stale.locator('input').inputValue(),'');await page.close();
    });
    await t.test('text, native dropdown and rich text commit on blur and preserve their question signature',async()=>{
      const page=await context.newPage();await page.setContent('<fieldset><legend>Complete the answers.</legend><input id="word"><select id="dropdown"><option value="">请选择</option><option value="walk">walks</option><option value="run">runs</option></select><div id="editor" contenteditable="true"></div></fieldset><script>window.commits=0;document.querySelectorAll("input,select,[contenteditable]").forEach(el=>el.addEventListener("blur",()=>window.commits++));</script>');
      const [question]=await page.evaluate(collectQuestionsFromDOM);assert.equal(question.targets.length,3);
      await fillQuestion(page.mainFrame(),question,{answers:['school','walks','A short paragraph.']});
      assert.equal(await page.locator('#word').inputValue(),'school');assert.equal(await page.locator('#dropdown').inputValue(),'walk');assert.equal(await page.locator('#editor').innerText(),'A short paragraph.');assert.ok(await page.evaluate(()=>window.commits)>=3,'commits='+await page.evaluate(()=>window.commits));
      assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),Core.questionSignature([question]));await page.close();
    });
    await t.test('ipublish blanks fire real keyboard events and commit their numbered answers',async()=>{
      const page=await context.newPage();await page.setContent('<div data-ipublish-question-group-type="fill_blanks_group"><div data-question-id="blanks"><div class="editor-content"><p>We <span data-dig-empty-id="one"><input class="answer_answerInput_x" id="first"></span> to school <span data-dig-empty-id="two"><input class="answer_answerInput_x" id="second"></span>.</p></div></div></div><script>window.keys=0;window.committed={};document.querySelectorAll("input").forEach(el=>{el.addEventListener("keydown",()=>window.keys++);el.addEventListener("blur",()=>window.committed[el.id]=el.value);});</script>');
      const report=await page.evaluate(collectQuestionsFromDOM,{includeDiagnostics:true});assert.deepEqual(report.issues,[]);
      const [question]=report.questions;assert.equal(question.targets.length,2);assert.equal(question.targets[0].inputMode,'keyboard');
      await fillQuestion(page.mainFrame(),question,{answers:['walk','early']});assert.deepEqual(await page.evaluate(()=>window.committed),{first:'walk',second:'early'});assert.ok(await page.evaluate(()=>window.keys)>9);
      assert.equal(Core.questionSignature(await page.evaluate(collectQuestionsFromDOM)),Core.questionSignature([question]));await page.close();
    });
    await t.test('five inline word-bank blanks fill through mirrored width text and an existing draft',async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/inline-word-bank');
      await page.setContent(inlineWordBankHTML({draft:'and fill an appointment'}));
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(localStore);
      const before=await engine.readQuestions(page,{});assert.equal(before.questions.length,1);assert.equal(before.questions[0].targets.length,5);
      let requests=0;
      engine.askModel=async question=>{
        requests++;assert.equal(question.wordBank.length,5);assert.doesNotMatch(question.question,/and fill an appointment/);
        return Core.parseModelAnswer(JSON.stringify({answers:inlineWordBankAnswers}),question);
      };
      const task={id:'five-inline-blanks',status:'running',answered:0,pages:0,logs:[]};
      const result=await engine.answerEntryAttempt(task,page,{autoSubmit:false,aiEnabled:true},new AbortController().signal);
      assert.equal(result.review,true);assert.equal(requests,1);assert.equal(task.answered,1);assert.equal(task.pages,1);
      assert.deepEqual(await page.locator('.comp-abs-input input').evaluateAll(elements=>elements.map(el=>el.value)),inlineWordBankAnswers);
      assert.deepEqual(await page.locator('.input-value-measure').allTextContents(),inlineWordBankAnswers);
      assert.equal(await page.evaluate(()=>window.commits),5);assert.equal((await engine.readQuestions(page,{})).signature,before.signature);
      assert.equal(await page.evaluate(()=>window.submitted),undefined);await page.close();
    });
    await t.test('an actual material edit during an inline fill still stops before later blanks or submission',async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/changed-inline-material');
      await page.setContent(inlineWordBankHTML());
      await page.locator('#blank-0').evaluate(el=>el.addEventListener('input',()=>{document.querySelector('[data-sentence="1"]').firstChild.textContent='A different sentence: ';}));
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(localStore);
      engine.askModel=async question=>Core.parseModelAnswer(JSON.stringify({answers:inlineWordBankAnswers}),question);
      const task={id:'changed-inline-material',status:'running',answered:0,pages:0,logs:[]};
      await assert.rejects(engine.answerEntryAttempt(task,page,{autoSubmit:true,aiEnabled:true},new AbortController().signal),/题目或阅读材料发生变化/);
      assert.equal(await page.locator('#blank-1').inputValue(),'');assert.equal(task.pages,0);
      assert.equal(await page.evaluate(()=>window.submitted),undefined);await page.close();
    });
    await t.test('a controlled input that reverts after blur is rejected',async()=>{
      const page=await context.newPage();await page.setContent('<div class="question-item"><h3>Complete the answer.</h3><input onblur="setTimeout(()=>this.value=\'\',25)"></div>');
      const [question]=await page.evaluate(collectQuestionsFromDOM);
      await assert.rejects(fillQuestion(page.mainFrame(),question,{answers:['lost answer']}),/回退|未写入成功/);await page.close();
    });
    await t.test('a later question cannot clear an earlier answer and then submit the page',async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/standalone');
      await page.setContent('<div class="question-item"><h3>First answer?</h3><input id="first"></div><div class="question-item"><h3>Second answer?</h3><input id="second" oninput="document.getElementById(\'first\').value=\'\'"></div><button onclick="window.submitted=true">提交</button>');
      const localStore={data:{tasks:[],bank:Core.validateBank([{question:'First answer?',answer:'one'},{question:'Second answer?',answer:'two'}])},changed(){},addLog(task,message){task.logs.push({message});}};
      const engine=new Automation(localStore),task={id:'verify-all',status:'running',logs:[],answered:0,pages:0};
      await assert.rejects(engine.answerEntryAttempt(task,page,{autoSubmit:true},new AbortController().signal),/先前填写的答案/);
      assert.equal(await page.evaluate(()=>window.submitted),undefined);assert.equal(task.pages,0);await page.close();
    });
    await t.test('legacy multiple choice clears previous selections and waits for asynchronous state updates',async()=>{
      const page=await context.newPage();await page.setContent('<div class="abs-direction">Select two correct answers.</div><div class="question-common-abs-choice"><div class="ques-title">Which habits help?</div><div class="option-wrap"><div class="option isNotReview selected"><div class="content">Sitting</div></div><div class="option isNotReview"><div class="content">Walking</div></div><div class="option isNotReview"><div class="content">Running</div></div></div></div><script>document.querySelectorAll(".option").forEach(el=>el.onclick=()=>setTimeout(()=>el.classList.toggle("selected"),20));</script>');
      const [question]=await page.evaluate(collectQuestionsFromDOM);assert.equal(question.type,'multiple');
      await fillQuestion(page.mainFrame(),question,{answers:['Walking','Running'],indexes:[1,2]});
      assert.deepEqual(await page.locator('.option').evaluateAll(elements=>elements.map(el=>el.classList.contains('selected'))),[false,true,true]);await page.close();
    });
    await t.test('published single choice uses the selected state on its option row',async()=>{
      const page=await context.newPage();await page.setContent('<div data-ipublish-question-group-type="single_choice_group"><div data-question-id="choice"><div class="editor-content">Choose a healthy activity.</div><div class="answer_strongListView_x"><span class="answer_strongItem_x">A</span><div class="editor-content">Walking</div></div><div class="answer_strongListView_x"><span class="answer_strongItem_x">B</span><div class="editor-content">Sitting</div></div></div></div><script>document.querySelectorAll("[class*=strongListView]").forEach(row=>row.onclick=()=>{document.querySelectorAll("[class*=strongListView]").forEach(el=>el.classList.remove("answer_selected_x"));row.classList.add("answer_selected_x");});</script>');
      const [question]=await page.evaluate(collectQuestionsFromDOM);assert.equal(question.targets[0].kind,'ipublish-choice');
      await fillQuestion(page.mainFrame(),question,{answers:['Walking'],indexes:[0]});assert.equal(await page.locator('.answer_selected_x').innerText(),'A\nWalking');await page.close();
    });
    for(const material of ['subtitles','audio','late-player'])await t.test(`video true-false answers use ${material} once for the whole exercise`,async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/video');
      await page.setContent('<div class="layout-container"><div class="abs-direction">Watch the conversation and decide whether the statements are true or false.</div><video src="https://media.example.test/conversation.mp4?token=private-token">'+(material==='subtitles'?'<track kind="subtitles" srclang="en" src="https://media.example.test/conversation.vtt">':'')+'</video><fieldset><legend>They will go to the library.</legend><label><input id="first-true" name="one" type="radio">True.</label><label><input name="one" type="radio">False.</label></fieldset><fieldset><legend>The library closes at nine.</legend><label><input name="two" type="radio">True.</label><label><input id="second-false" name="two" type="radio">False.</label></fieldset></div>');
      const text='Anna and Tom will go to the library. The library closes at six oclock.';
      if(material==='late-player')await page.locator('video').evaluate(el=>{const shell=document.createElement('div');shell.className='xgplayer';el.before(shell);shell.append(el);const clock=document.createElement('span');clock.className='playback-time';clock.textContent='00:02 / 01:35';shell.append(clock);Object.defineProperty(el,'currentSrc',{value:'',configurable:true});});
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(localStore);
      let downloads=0,transcriptions=0,questions=0;
      engine.media=new MediaMaterials(directory,{download:async(_url,options)=>{downloads++;return options.subtitle?Buffer.from('WEBVTT\n\n00:00.000 --> 00:08.000\n'+text+'\n'):Buffer.from('local video bytes');},speech:{transcribe:async bytes=>{transcriptions++;assert.equal(bytes.toString(),'local video bytes');if(material==='late-player')await page.locator('video').evaluate(el=>{el.before(document.createElement('audio'));el.id='new-generated-id';Object.defineProperty(el,'currentSrc',{value:'https://cdn.example.test/same-conversation.mp4',configurable:true});document.querySelector('.playback-time').textContent='00:12 / 01:35';});return {text,source:'本地语音转写'};}}});
      engine.askModel=async question=>{questions++;assert.match(question.context,/library closes at six/);assert.doesNotMatch(question.context,/private-token|https:/);return Core.parseModelAnswer(JSON.stringify({answers:[/at nine/.test(question.question)?'False.':'True.']}),question);};
      const task={id:'offline-media-'+material,status:'running',answered:0,pages:0,logs:[]};
      const result=await engine.answerEntryAttempt(task,page,{autoSubmit:false,aiEnabled:true},new AbortController().signal);
      assert.equal(result.review,true,JSON.stringify(task.logs));assert.equal(task.answered,2);assert.equal(questions,2);assert.equal(downloads,1);assert.equal(transcriptions,material==='subtitles'?0:1);
      assert.equal(await page.locator('#first-true').isChecked(),true);assert.equal(await page.locator('#second-false').isChecked(),true);assert.doesNotMatch(JSON.stringify(task.logs),/private-token/);await page.close();
    });
    await t.test('changing the video while preparing its transcript stops before AI or answer writes',async()=>{
      const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/change-video');
      await page.setContent('<div class="layout-container"><div class="abs-direction">Watch the video and answer the question.</div><video src="https://media.example.test/first.mp4"></video><fieldset><legend>They go to school.</legend><label><input name="one" type="radio">True.</label><label><input name="one" type="radio">False.</label></fieldset></div>');
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(localStore);
      engine.media.resolve=async()=>{await page.locator('video').evaluate(el=>{el.src='https://media.example.test/second.mp4';});return {text:'They go to the library.',source:'测试转写'};};
      engine.askModel=async()=>assert.fail('changed media must not be answered');
      const task={id:'changed-video',status:'running',answered:0,pages:0,logs:[]};
      const result=await engine.answerEntryAttempt(task,page,{autoSubmit:true,aiEnabled:true},new AbortController().signal);
      assert.equal(result.review,true);assert.match(result.message,/发生变化/);assert.equal(task.answered,0);assert.equal(await page.locator('input:checked').count(),0);await page.close();
    });
    for(const mode of ['manual','automatic','early-submit','other-leaf','cycle'])await t.test(`multiple-choice to Directions-only text pagination: ${mode}`,async()=>{
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto('https://ucontent.unipus.cn/offline-recognition/multipage');
      await page.setContent(multiPageExerciseHTML({boundary:mode==='other-leaf',cycle:mode==='cycle',delay:mode==='manual'?700:0,earlySubmit:mode==='early-submit'}));
      assert.deepEqual(errors,[]);
      const localStore={data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(localStore);let requests=0;
      engine.askModel=async question=>{
        requests++;
        if(question.type==='multiple')return Core.parseModelAnswer(JSON.stringify({answers:['The Gift of the Magi','The Last Leaf']}),question);
        assert.match(question.question,/Write down other works by O\. Henry/);
        return Core.parseModelAnswer(JSON.stringify({answers:['The Ransom of Red Chief and After Twenty Years.']}),question);
      };
      const task={id:'multipage-'+mode,unitId:'id-unit4-tab',entryKey:JSON.stringify(['id-unit4-tab',['Active reading','Before you read'],'Before you read 1']),status:'running',answered:0,pages:0,logs:[]};
      const result=await engine.answerEntry(task,page,{autoSubmit:mode!=='manual',aiEnabled:true},new AbortController().signal);
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>window.prematureSubmit),undefined);
      assert.deepEqual(await page.evaluate(()=>window.savedChoices),['The Gift of the Magi','The Last Leaf']);
      if(mode==='other-leaf'){
        assert.equal(requests,1);assert.equal(task.answered,1);assert.equal(await page.locator('#second-answer').inputValue(),'');assert.equal(await page.evaluate(()=>window.submitted),false);assert.match(result.message,/不属于/);
      }else if(mode==='cycle'){
        assert.equal(requests,2);assert.equal(task.answered,2);assert.equal(result.review,true);assert.match(result.message,/重复返回/);assert.equal(await page.evaluate(()=>window.nextClicks),2);
      }else{
        assert.equal(requests,2);assert.equal(task.answered,2);assert.equal(task.pages,2);assert.ok(task.logs.some(log=>/继续填写第 2 页/.test(log.message)));
        if(mode==='manual'){
          assert.equal(await page.locator('#second-answer').inputValue(),'The Ransom of Red Chief and After Twenty Years.');assert.equal(await page.evaluate(()=>window.submitted),false);assert.equal(result.review,true);
        }else{
          assert.equal(await page.evaluate(()=>window.submitted),true);assert.equal(await page.evaluate(()=>window.savedText),'The Ransom of Red Chief and After Twenty Years.');assert.equal(result.feedback.summary,true);
        }
      }
      await page.close();
    });
    await aiRecoveryBrowserCases(t,context);
    await videoCorrectionBrowserCases(t,context);
    await pictureBrowserCases(t,context,directory);
    await submissionCompletionBrowserCases(t,context,directory);
    await correctionCoverageBrowserCases(t,context,directory);
    await textInputBrowserCases(t,context,directory);
    await lessonActionsBrowserCases(t,context,directory);
    await answerBlockerBrowserCases(t,context);
    await bankedClozeBrowserCases(t,context,directory);
    await shutdownBrowserCases(t,context,directory);
    await discussionBoardBrowserCases(t,context,directory);
    await readingDiscussionBrowserCases(t,context);
    await sentenceCreationBrowserCases(t,context);
    await vocabularyBrowserCases(t,context,directory);
    await videoViewBrowserCases(t,context,directory);
    await audioViewBrowserCases(t,context,directory);
    await courseNavigationBrowserCases(t,context);
    await oralBrowserCases(t,context,directory);
    await roleplayBrowserCases(t,context,directory);
    await questionResponseBrowserCases(t,context,directory);
    await backgroundBrowserCases(t,context);
    await studyNoticeBrowserCases(t,context);
    await videoFramesBrowserCases(t,context,directory);
    await dropdownBrowserCases(t,context,directory);
    await exerciseLearningBrowserCases(t,context,directory);
    await matchingBrowserCases(t,context,directory);
    await realMatchingBrowserCases(t,context,directory);
    await partMatchingBrowserCases(t,context,directory);
    await functionMatchingBrowserCases(t,context,directory);
    await courseProgressBrowserCases(t,context,directory);
    for(const type of ['video','oral'])await t.test(`a ${type}-only lesson is remembered and the next run never opens or scans it`,async()=>{
      const localDirectory=path.join(directory,'manual-'+type),localStore=await new Store(localDirectory,{env:{}}).load();
      const entry={key:JSON.stringify(['unit-memory',['Listening'],type]),title:type,path:['Listening'],required:true,pending:true,completed:false};
      const snapshot={ready:true,activeUnitId:'unit-memory',entries:[entry]};
      const makeTask=()=>({id:'memory-'+type,courseId:'memory-course',unitId:'unit-memory',unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]});
      const engine=new Automation(localStore),page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/manual-'+type);
      await page.setContent(type==='oral'?'<div data-ipublish-question-group-type="oral_personal_state_group"><p>Read the following sentences aloud.</p><button>开始录音</button></div>':'<div class="abs-direction">Watch the video.</div><video width="200" height="100"></video>');
      engine.pages.attach(context);engine.pages.track(page,'lesson');engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>snapshot;engine.openRequiredEntry=async()=>page;
      const wait=engine.waitQuestions.bind(engine);engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:1400});
      engine.askModel=async()=>assert.fail('pure content does not request answers');
      const first=makeTask();await engine.runTask(first,{}, {},new AbortController().signal);
      assert.equal(localStore.data.manualEntryMarks.length,1);assert.equal(first.status,'partial');assert.equal(first.requiredCompleted,0);assert.equal(page.isClosed(),true);await localStore.flush();
      const reloaded=await new Store(localDirectory,{env:{}}).load(),later=new Automation(reloaded);
      later.courseDirectory=async()=>({page:{}});later.refreshTaskDirectory=async()=>snapshot;
      later.openRequiredEntry=later.answerEntry=later.askModel=async()=>assert.fail('remembered pure content must be skipped from the directory');
      const second=makeTask();await later.runTask(second,{}, {},new AbortController().signal);
      assert.equal(second.status,'partial');assert.ok(second.logs.some(log=>/已跳过已标记/.test(log.message)));await reloaded.flush();
    });
    await t.test('repeated empty lessons are closed in the real browser and typed drafts remain open',async()=>{
      const pages=new PageLifecycle();pages.attach(context);const initial=context.pages().length;let peak=initial;
      for(let i=0;i<12;i++){
        const page=await context.newPage();pages.track(page,'lesson');await page.goto('https://ucontent.unipus.cn/offline-tab-test/'+i);
        peak=Math.max(peak,context.pages().length);assert.equal((await pages.release(page)).status,'closed');
      }
      assert.equal(peak,initial+1);assert.equal(context.pages().length,initial);
      const draft=await context.newPage();pages.track(draft,'lesson');await draft.goto('https://ucontent.unipus.cn/offline-tab-test/draft');
      await draft.locator('#answer').fill('Keep my draft');await draft.locator('#answer').evaluate(el=>{el.hidden=true;});assert.equal((await pages.release(draft)).reason,'draft');assert.equal(await draft.locator('#answer').inputValue(),'Keep my draft');
      await draft.close();assert.equal(pages.hasDraft(),false);
      const essay=await context.newPage();pages.track(essay,'lesson');await essay.goto('https://ucontent.unipus.cn/offline-tab-test/essay');
      await essay.locator('#essay').fill('Keep this rich text answer');assert.equal((await pages.release(essay)).reason,'draft');assert.equal(essay.isClosed(),false);await essay.close();
    });
  }finally{
    await context?.close();await server.shutdown();await new Promise(resolve=>fixture.close(resolve));clearTimeout(store.saveTimer);await store.writeQueue;await rm(directory,{recursive:true,force:true});
  }
});
