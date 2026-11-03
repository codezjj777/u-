import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {Automation} from '../automation.mjs';
import {readExerciseFeedbackFromDOM,findActionInDOM} from '../platform-dom.mjs';
import {fullCorrectProof} from '../exercise-learning.mjs';
import {submissionSummaryHTML} from './fixtures/submission-summary.mjs';

const summary='<main class="pc-main-container"><h2>答题小结</h2><p>完成本板块内全部必修练习且客观题正确率≥60</p><div class="score"><span>84</span><span>分</span></div><p>共5道题，主观题5道</p><p>主观题 <span>已作答 (5/5)</span> <span>未作答 (0/5)</span></p></main><footer class="question-common-course-page"><button>继续学习</button></footer>';
function dom(html){const {window,document}=parseHTML('<html><body>'+html+'</body></html>');globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}

test('the actual 84-point subjective summary proves all five answers were submitted without proving all-correct',()=>{
  dom(summary);const feedback=readExerciseFeedbackFromDOM();assert.equal(feedback.summary,true);assert.equal(feedback.failed,false);assert.equal(feedback.objective,0);assert.equal(feedback.subjective,5);assert.equal(feedback.unanswered,0);assert.equal(feedback.completion.allAnswered,true);assert.equal(feedback.completion.answered,5);assert.equal(feedback.grading.score,84);assert.equal(feedback.grading.maxScore,null);assert.equal(fullCorrectProof(feedback,[{questions:Array.from({length:5},()=>({type:'text',fields:[{kind:'text'}]}))}]),null);
});

test('mixed text and nested numeric nodes preserve every 93.4-point submission count',()=>{
  const doc=dom(submissionSummaryHTML({fragmented:true,score:93.4})),source=doc.querySelector('script').textContent,markup=JSON.parse(source.match(/exercise\.innerHTML=("(?:[^"\\]|\\.)*")/)[1]);doc.querySelector('main').innerHTML=markup;doc.querySelector('footer').innerHTML='<button>继续学习</button>';
  const feedback=readExerciseFeedbackFromDOM();assert.equal(feedback.summary,true);assert.equal(feedback.total,5);assert.equal(feedback.subjective,5);assert.equal(feedback.completion.allAnswered,true);assert.equal(feedback.unanswered,0);assert.equal(feedback.grading.score,93.4);assert.ok(findActionInDOM({kind:'finish'}));
  assert.equal(fullCorrectProof(feedback,[{questions:Array.from({length:5},()=>({type:'text',fields:[{kind:'text'}]}))}]),null);
});

test('nested pending and failed grades block continuation, and hidden all-correct text cannot become a proof',()=>{
  for(const notice of ['主观题待<strong>批改</strong>','你没有达到<strong>闯关条件</strong>，请修改后再提交。']){dom(summary.replace('</main>','<p>'+notice+'</p></main>'));const feedback=readExerciseFeedbackFromDOM();assert.ok(feedback.failed||feedback.grading.pending);assert.equal(findActionInDOM({kind:'finish'}),null);}
  dom(summary.replace('</main>','<p><span hidden>全部正确</span></p><script>全部正确</script></main>'));assert.equal(readExerciseFeedbackFromDOM().grading.allCorrect,false);
  dom(summary.replace('</main>','<p>全部<strong>正确</strong></p></main>'));assert.equal(readExerciseFeedbackFromDOM().grading.allCorrect,true);
});

test('the summary continue action is distinct from directory shortcuts and never overrides an unsafe selector',()=>{
  dom('<button id="directory">继续学习</button>');assert.equal(findActionInDOM({kind:'finish'}),null);
  dom(summary);assert.equal(findActionInDOM({kind:'next'}),null);assert.equal(findActionInDOM({kind:'submit',selector:'footer button'}),null);assert.equal(findActionInDOM({kind:'finish'}),'[data-ustudy-action="finish"]');
  for(const html of [summary.replace('已作答 (5/5)','已作答 (4/5)').replace('未作答 (0/5)','未作答 (1/5)'),summary.replace('<h2>答题小结</h2>','<h2>答题小结</h2><p>你没有达到闯关条件，请修改后再提交。</p>'),summary.replace('</main>','<p>主观题待批改</p></main>')]){dom(html);assert.equal(findActionInDOM({kind:'finish'}),null);}
  dom('<aside><h2>答题小结</h2><p>已作答(5/5)</p><p>未作答(0/5)</p></aside><footer><button>继续学习</button></footer>');assert.equal(findActionInDOM({kind:'finish'}),null);
  dom(summary+'<aside><button id="shortcut">继续学习</button></aside>');assert.equal(findActionInDOM({kind:'finish',selector:'#shortcut'}),null);
});

function fixture(){
  const task={id:'submission',status:'running',entryKey:JSON.stringify(['unit',['Reading'],'Exercise 3']),logs:[]},store={directory:'.cache',data:{tasks:[task]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store),entry={key:task.entryKey,required:true,pending:true,completed:false},page={url:()=> 'https://ucontent.unipus.cn/offline-recognition/completion',bringToFront:async()=>{}};
  dom(summary);const feedback={...readExerciseFeedbackFromDOM(),frame:{},pageURL:page.url(),frameURL:page.url()};engine.readExerciseFeedback=async()=>feedback;
  return {task,engine,entry,page,feedback};
}

test('a submitted summary finishes once and waits for delayed directory completion without returning to AI',async()=>{
  const f=fixture();let reads=0,finishes=0;f.engine.refreshTaskDirectory=async()=>({entries:[{...f.entry,completed:++reads>=3}]});f.engine.finishExerciseSummary=async()=>{finishes++;return true;};
  const result=await f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,new AbortController().signal,{attempts:4,delayMs:0});assert.equal(result.matched.completed,true);assert.equal(reads,3);assert.equal(finishes,1);assert.equal(f.task.status,'running');
});

test('completion polling is bounded and never promotes a pending directory row to completed',async()=>{
  const f=fixture();let reads=0,finishes=0;f.engine.refreshTaskDirectory=async()=>{reads++;return {entries:[f.entry]};};f.engine.finishExerciseSummary=async()=>{finishes++;return true;};
  const result=await f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,new AbortController().signal,{attempts:3,delayMs:0});assert.equal(result.matched.completed,false);assert.equal(reads,3);assert.equal(finishes,1);
});

test('a result that hydrates its counts after the first directory read continues without a manual retry',async()=>{
  const f=fixture();let feedbackReads=0,polls=0,finishes=0;f.engine.readExerciseFeedback=async()=>++feedbackReads===1?{...f.feedback,total:null,completion:undefined}:f.feedback;f.engine.refreshTaskDirectory=async()=>({entries:[{...f.entry,completed:++polls>=2}]});f.engine.finishExerciseSummary=async()=>{finishes++;return true;};
  const result=await f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,undefined,{delayMs:0});assert.equal(result.matched.completed,true);assert.equal(result.feedback.completion.allAnswered,true);assert.equal(finishes,1);assert.equal(feedbackReads,2);
});

test('an initially missing result footer is retried within the bounded catalog checks and clicked successfully once',async()=>{
  const f=fixture();let polls=0,attempts=0;f.engine.refreshTaskDirectory=async()=>({entries:[{...f.entry,completed:++polls===4}]});f.engine.finishExerciseSummary=async()=>++attempts===2;
  const result=await f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,undefined,{delayMs:0});assert.equal(result.matched.completed,true);assert.equal(attempts,2);
});

test('a different result during hydration cannot replace the result belonging to the selected exercise',async()=>{
  const f=fixture();let reads=0;f.feedback.navigationKey='same-entry';f.engine.readExerciseFeedback=async()=>++reads===1?{...f.feedback,total:null,completion:undefined}:{...f.feedback,navigationKey:'another-entry'};f.engine.refreshTaskDirectory=async()=>({entries:[f.entry]});f.engine.finishExerciseSummary=async()=>assert.fail('no click for another result');await assert.rejects(f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,undefined,{delayMs:0}),/当前项目已变化/);
});

test('a failed summary blocks continuation and directory polling, and stopping cancels the wait',async()=>{
  const f=fixture();f.engine.readExerciseFeedback=async()=>({...f.feedback,failed:true});f.engine.refreshTaskDirectory=async()=>assert.fail('a failed summary cannot be superseded by a stale directory');f.engine.finishExerciseSummary=async()=>assert.fail('must not advance failed exercise');
  const result=await f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,new AbortController().signal);assert.equal(result.feedback.failed,true);
  const controller=new AbortController();controller.abort(new Error('fixture-stop'));await assert.rejects(f.engine.waitTaskCompletion(f.task,{},f.page,f.entry,controller.signal),/fixture-stop/);
});
