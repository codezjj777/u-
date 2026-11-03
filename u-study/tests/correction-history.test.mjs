import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCorrectionAttempt,analyzeCorrectionHistory,correctionPromptFor,protectCorrectionAnswer} from '../correction-history.mjs';
import {Automation} from '../automation.mjs';

const original=['couch potatoes','characteristics','risks','mouse potatoes'];
const regressed=['couch potato','characteristics','risks','mouse potato'];
function snapshot(count=4){return {signature:'same-outline',questions:[{question:'Complete the outline.',type:'text',options:[],targets:Array.from({length:count},()=>({kind:'text'}))}]};}
function attempt(page,answers,correct,extra={}){return captureCorrectionAttempt(page,[answers],{summary:true,failed:true,total:answers.length,objective:answers.length,subjective:0,correct,incorrect:answers.length-correct,partial:0,unanswered:0,...extra});}

test('2/4 then 0/4 preserves the former correct plurals and identifies the unchanged wrong blanks',()=>{
  const page=snapshot(),analysis=analyzeCorrectionHistory(page,[attempt(page,original,2),attempt(page,regressed,0)]),rule=analysis.rules[0];
  assert.equal(analysis.contradictory,false);assert.equal(analysis.verifiedParts,2);assert.deepEqual(rule.knownCorrectAnswers,[{index:1,answer:original[0]},{index:4,answer:original[3]}]);
  assert.deepEqual(rule.knownIncorrectAnswers.find(item=>item.index===2).answers,['characteristics']);assert.deepEqual(rule.knownIncorrectAnswers.find(item=>item.index===3).answers,['risks']);
  const prompt=correctionPromptFor(analysis,0);assert.equal(prompt.history.length,2);assert.deepEqual(prompt.history.map(item=>item.grading.correct),[2,0]);assert.deepEqual(prompt.history[0].answers,original);assert.equal(prompt.history[0].gradingScope,'whole-exercise');
  const protectedAnswer=protectCorrectionAnswer(page.questions[0],{answers:['couch potato','description','disadvantages','mouse potato'],source:'AI'},rule);
  assert.equal(protectedAnswer.protectedParts,2);assert.deepEqual(protectedAnswer.answer.answers,['couch potatoes','description','disadvantages','mouse potatoes']);
  assert.match(protectCorrectionAnswer(page.questions[0],{answers:original},rule).issue,/第 2、3 个作答项/);
});

test('one aggregate score alone never labels particular ambiguous blanks correct or wrong',()=>{
  const page=snapshot(),analysis=analyzeCorrectionHistory(page,[attempt(page,original,2)]);assert.equal(analysis.verifiedParts,0);assert.deepEqual(analysis.rules[0].knownIncorrectAnswers,[]);
});

test('a score decrease equal to the number of changed parts proves only those changed parts',()=>{
  const page=snapshot(5),one=['a','b','c','d','e'],two=['x','b','c','d','y'],analysis=analyzeCorrectionHistory(page,[attempt(page,one,4),attempt(page,two,2)]);
  assert.deepEqual(analysis.rules[0].knownCorrectAnswers,[{index:1,answer:'a'},{index:5,answer:'e'}]);assert.equal(analysis.verifiedParts,2);assert.deepEqual(analysis.rules[0].knownIncorrectAnswers.map(item=>item.index),[1,5]);
});

test('an incorrect response graded as one multi-blank question does not condemn each blank',()=>{
  const page=snapshot(),record=captureCorrectionAttempt(page,[original],{summary:true,total:1,objective:1,subjective:0,correct:0,incorrect:1}),analysis=analyzeCorrectionHistory(page,[record]),rule=analysis.rules[0];
  assert.deepEqual(rule.knownIncorrectAnswers,[]);assert.deepEqual(rule.knownIncorrectResponses,[original]);assert.match(protectCorrectionAnswer(page.questions[0],{answers:original},rule).issue,/完整答案相同/);
  assert.equal(protectCorrectionAnswer(page.questions[0],{answers:[...original.slice(0,3),'a supported alternative']},rule).issue,undefined);
});

test('mixed subjective, partial, unanswered and missing counts cannot support per-blank inference',()=>{
  const page=snapshot();
  for(const extra of [{total:8,objective:4,subjective:4},{partial:1},{unanswered:1},{incorrect:null},{objective:null}]){
    const analysis=analyzeCorrectionHistory(page,[attempt(page,original,0,extra)]);assert.equal(analysis.verifiedParts,0);assert.deepEqual(analysis.rules[0].knownIncorrectAnswers,[]);
  }
});

test('contradictory grades discard every inferred answer instead of inventing proof',()=>{
  const page=snapshot(),analysis=analyzeCorrectionHistory(page,[attempt(page,original,2),attempt(page,original,0)]);assert.equal(analysis.contradictory,true);assert.equal(analysis.verifiedParts,0);assert.deepEqual(analysis.rules[0].knownCorrectAnswers,[]);
});

test('only matching, stable click-time captures can enter the grading history',()=>{
  const page={...snapshot(),pageURL:'https://ucontent.unipus.cn/one',navigation:{key:'one'}};
  assert.equal(captureCorrectionAttempt(page,null,{summary:true}),null);assert.equal(attempt(page,original,0,{gradingStable:false}),null);assert.equal(attempt(page,original,0,{grading:{pending:true}}),null);
  assert.equal(attempt(page,original,0,{pageURL:'https://ucontent.unipus.cn/two'}),null);assert.equal(attempt(page,original,0,{navigationKey:'two'}),null);
  assert.equal(analyzeCorrectionHistory({...page,signature:'other-exercise'},[attempt(page,original,0)]).history.length,0);
  const captured=[...original],record=attempt(page,captured,0);captured[0]='changed draft';assert.deepEqual(record.answers[0],original);
});

test('choice and matching constraints never create duplicate options or label individual checkboxes wrong',()=>{
  const question={question:'Match.',type:'matching',prompts:['one','two','three','four'],promptEmphasis:[[],[],[],[]],options:['A sentence','B sentence','C sentence','D sentence'],targets:[{kind:'sortable'}]};
  const guarded=protectCorrectionAnswer(question,{answers:['B sentence','A sentence','C sentence','D sentence']},{knownCorrectAnswers:[{index:1,answer:'A sentence'}],knownIncorrectAnswers:[],knownIncorrectResponses:[]});assert.match(guarded.issue,/配对或选项冲突/);
  const page={signature:'checkboxes',questions:[{type:'multiple',question:'Select all.',options:['Alpha','Beta','Gamma'],targets:[]}]},record=captureCorrectionAttempt(page,[['Alpha','Beta']],{summary:true,total:1,objective:1,subjective:0,correct:0,incorrect:1});
  const rule=analyzeCorrectionHistory(page,[record]).rules[0];assert.deepEqual(rule.knownIncorrectAnswers,[]);assert.equal(protectCorrectionAnswer(page.questions[0],{answers:['Alpha']},rule).issue,undefined);
});

test('history stays bounded and large grouped exercises use linear constraint propagation',()=>{
  const page=snapshot(500),one=Array.from({length:500},(_,i)=>'old '+i),two=one.map((value,i)=>i<250?'new '+i:value),started=performance.now();
  const analysis=analyzeCorrectionHistory(page,[attempt(page,one,250),attempt(page,two,0)]);assert.equal(analysis.verifiedParts,250);assert.ok(performance.now()-started<1000);assert.equal(analyzeCorrectionHistory(page,Array(10).fill(attempt(page,one,250))).history.length,3);
});

test('submission feedback waits for provisional zero counts to settle and remains cancellable',async()=>{
  const engine=new Automation({data:{tasks:[]},changed(){}}),task={status:'running'};let reads=0;
  engine.readExerciseFeedback=async()=>{const correct=++reads<=3?0:2;return {summary:true,failed:true,total:4,objective:4,subjective:0,correct,incorrect:4-correct};};
  const result=await engine.waitSubmissionFeedback(task,{},new AbortController().signal,{timeout:500,settleMs:100,pollMs:20});assert.equal(result.correct,2);assert.equal(result.gradingStable,true);assert.ok(reads>=5);
  engine.readExerciseFeedback=async()=>({summary:true,failed:true,total:4,objective:4,subjective:0,correct:reads++%4,incorrect:0});
  const unsettled=await engine.waitSubmissionFeedback(task,{},new AbortController().signal,{timeout:80,settleMs:50,pollMs:10});assert.equal(unsettled.gradingStable,false);
  const controller=new AbortController();controller.abort();await assert.rejects(engine.waitSubmissionFeedback(task,{},controller.signal),{name:'AbortError'});
});
