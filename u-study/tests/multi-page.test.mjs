import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM,readExerciseNavigationFromDOM} from '../platform-dom.mjs';
import {Automation,canContinueExercise} from '../automation.mjs';

const navigationHTML=(title='Before you read 1')=>`<header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">English Book</span><span class="pc-break-crumb-text">Horns of a dilemma</span><span class="pc-break-crumb-text">Before you read</span></nav><div class="pc-header-tab-activity">Before you read</div><div class="pc-task pc-header-task-activity">${title}</div></header>`;
function dom(html){const {window,document}=parseHTML(`<html><body>${html}</body></html>`);globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}
const entryKey=JSON.stringify(['id-unit4-tab',['Active reading','Before you read'],'Before you read 1']);

test('a Directions-only answer box is recognized with its full writing assignment',()=>{
  dom(navigationHTML()+'<main><div class="layout-container"><div class="layout-direction-container"><div class="abs-direction">Directions: Write down other works by O. Henry if you know any.</div></div><div class="layoutBody-container has-reply"><div class="layout-reply-container"><div class="question-common-abs-reply"><div class="answer-area"><textarea placeholder="请输入答案..."></textarea><span>0/1000</span></div></div></div></div></div></main>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);assert.equal(report.questions[0].type,'text');assert.match(report.questions[0].question,/Write down other works by O\. Henry/);assert.equal(report.questions[0].targets.length,1);
});
test('the active task tab distinguishes internal question pages from another directory leaf',()=>{
  dom(navigationHTML()+'<div class="layout-progress-container"><div class="comp-question-progress" style="width:50%"></div></div>');
  const navigation=readExerciseNavigationFromDOM();assert.equal(navigation.known,true);assert.equal(navigation.title,'Before you read 1');assert.equal(navigation.progress,50);
  const pageURL='https://ucontent.unipus.cn/pc.html#/courseware/unit4/reading/required';
  const before={navigation,pageURL};assert.equal(canContinueExercise(before,{...before},{entryKey}),true);
  document.querySelector('.pc-header-task-activity').textContent='Before you read 2';
  assert.equal(canContinueExercise(before,{navigation:readExerciseNavigationFromDOM(),pageURL},{entryKey}),false);
});
test('reused titles cannot cross books, routes or unconfirmed containers',()=>{
  dom(navigationHTML());const navigation=readExerciseNavigationFromDOM(),pageURL='https://ucontent.unipus.cn/pc.html#/courseware/unit4/reading/required',before={navigation,pageURL};
  assert.equal(canContinueExercise(before,{...before,pageURL:pageURL.replace('required','optional')},{entryKey}),false);
  assert.equal(canContinueExercise(before,{...before,navigation:{known:false,key:''}},{entryKey}),false);
  assert.equal(canContinueExercise(before,before,{entryKey:JSON.stringify(['unit4',[],'Before you read 2'])}),false);
  document.querySelector('.pc-break-crumb-text').textContent='Another book';
  assert.equal(canContinueExercise(before,{navigation:readExerciseNavigationFromDOM(),pageURL},{entryKey}),false);
});
test('a page index change is permitted only while the full exercise identity stays unchanged',()=>{
  dom(navigationHTML());const navigation=readExerciseNavigationFromDOM(),pageURL='https://ucontent.unipus.cn/pc.html?cid=one#/courseware/unit4/reading/required?questionIndex=1';
  assert.equal(canContinueExercise({navigation,pageURL},{navigation,pageURL:pageURL.replace('questionIndex=1','questionIndex=2')},{entryKey}),true);
  assert.equal(canContinueExercise({navigation,pageURL},{navigation,pageURL:pageURL.replace('cid=one','cid=two')},{entryKey}),false);
});
test('next-page waiting observes a delayed textarea and does not accept the previous question',async()=>{
  const engine=new Automation({directory:'.cache',data:{tasks:[]},changed(){}}),task={status:'running'};
  const previous={signature:'first'},next={signature:'second',questions:[{type:'text'}]};let reads=0;
  engine.readLearningState=async()=>({});engine.readExerciseFeedback=async()=>({summary:false});engine.readQuestions=async()=>++reads<3?previous:next;
  const result=await engine.waitNextExercisePage(task,{isClosed:()=>false},{},previous,new AbortController().signal,{timeout:2000});
  assert.equal(result.snapshot,next);assert.equal(reads,4);
});
test('stopping during next-page waiting cancels without accepting another question',async()=>{
  const engine=new Automation({directory:'.cache',data:{tasks:[]},changed(){}}),controller=new AbortController();controller.abort();
  await assert.rejects(engine.waitNextExercisePage({status:'running'},{},{},{},controller.signal),{name:'AbortError'});
});
test('a next button that leaves the question unchanged never looks like a finished exercise',async()=>{
  const engine=new Automation({directory:'.cache',data:{tasks:[]},changed(){}}),previous={signature:'same'};
  engine.readLearningState=async()=>({});engine.readExerciseFeedback=async()=>({summary:false});engine.readQuestions=async()=>previous;
  await assert.rejects(engine.waitNextExercisePage({status:'running'},{isClosed:()=>false},{},previous,new AbortController().signal,{timeout:5}),/后续页面尚未填答/);
});
test('manual submit mode does not save a finished leaf through a cross-task next button',async()=>{
  const question={question:'Complete this answer.',type:'text',options:[],targets:[{selector:'#answer'}]};
  const store={directory:'.cache',data:{tasks:[],bank:[{question:question.question,answer:['A complete answer.']}]},changed(){},addLog(){}};
  const engine=new Automation(store),url='https://ucontent.unipus.cn/pc.html#/courseware/unit4/required';
  const snapshot={questions:[question],signature:'one-page',pageURL:url,navigation:{known:true,key:'required',title:'Before you read 1',progress:100},frame:{evaluate:async(_fn,options)=>options.kind==='next'?{selector:'#next',count:1}:{selector:null,count:0}}};
  engine.waitQuestions=async()=>snapshot;engine.fillQuestion=engine.verifyQuestion=async()=>{};engine.action=async()=>assert.fail('manual final-save mode must not click a cross-task next button');
  const result=await engine.answerEntry({id:'manual-boundary',status:'running',entryKey,answered:0,pages:0},{url:()=>url},{autoSubmit:false},new AbortController().signal);
  assert.equal(result.review,true);
});
