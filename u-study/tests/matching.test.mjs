import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import * as Core from '../shared/core.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {capturePageIdentity,fullCorrectProof} from '../exercise-learning.mjs';
import {askModel} from '../answer-provider.mjs';
import {Store} from '../store.mjs';
import {sentenceMatchingHTML,matchingAnswers,matchingPrompts,matchingWords} from './fixtures/sentence-matching.mjs';

function read(options={}){
  const {window,document}=parseHTML(sentenceMatchingHTML(options));globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
  return collectQuestionsFromDOM({includeDiagnostics:true});
}
const answer=q=>Core.parseModelAnswer(JSON.stringify({answers:q.prompts.map(prompt=>matchingAnswers[matchingPrompts.indexOf(prompt)])}),q);
const scope={courseId:'matching-book',unitId:'unit-one',entryKey:'language-focus/exercise-1'};
function record(q=read().questions[0]){
  const result=answer(q),fields=q.targets.map(({kind,key,items})=>({kind,key,items:items.map(({selector,...item})=>item)}));
  return {kind:'exercise',version:1,title:'Language focus / Exercise 1',scope,pages:[{number:1,questions:[{...q,targets:undefined,fields,wordBank:[],blankOptions:[],answer:result.answers}]}],verification:{method:'platform-all-correct',correct:10,total:10,unit:'blanks',verifiedAt:1},learnedAt:1};
}

test('recognize the screenshot as one complete ten-pair exercise with both columns and underlined words',()=>{
  const report=read();assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);assert.equal(report.hasAnswerControls,true);assert.equal(report.manualOnly,false);
  const [q]=report.questions;assert.equal(q.type,'matching');assert.equal(q.questionType,'sentence_matching');assert.equal(q.targets.length,1);assert.equal(q.targets[0].items.length,10);
  assert.deepEqual(q.prompts,matchingPrompts);assert.deepEqual(q.promptEmphasis,matchingWords.map(word=>[word]));assert.ok(q.options.every(text=>!/^[A-J]\. /.test(text)));
  assert.deepEqual(answer(q).answers,matchingAnswers);assert.equal(answer(q).ordered,true);
});

test('dragging and option-letter renumbering keep content identities stable; real left, right and emphasis edits do not',()=>{
  const q=read().questions[0],signature=Core.questionSignature([q]),capture=capturePageIdentity([q]),list=document.querySelector('.sortable-list-wrapper');
  list.prepend(list.lastElementChild);[...list.children].forEach((el,i)=>el.firstElementChild.textContent=String.fromCharCode(65+i)+'.');
  const moved=collectQuestionsFromDOM();assert.equal(Core.questionSignature(moved),signature);assert.equal(capturePageIdentity(moved),capture);
  document.querySelector('u').outerHTML='habitual';assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),signature);
  read();document.querySelector('.sequence-question-view-item-text').append(' changed');assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),signature);
  read();document.querySelector('.sequence-reply-view-item-text span:last-child').append(' changed');assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),signature);
});

test('numbered left-column fallback is complete and duplicate or missing halves block submission',()=>{
  assert.deepEqual(read({leftClass:false}).questions[0].prompts,matchingPrompts);
  for(const options of [{missing:true},{duplicate:true}]){const report=read(options);assert.equal(report.questions.length,0);assert.ok(report.issues.length);assert.equal(report.manualOnly,false);}
  read();document.querySelector('.abs-direction').textContent='Put these events in order.';const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,0);assert.ok(report.issues.some(issue=>issue.includes('未适配')));
});

test('AI receives every left half, underlined word and right option and must return a full ordered permutation',async()=>{
  const q=read().questions[0];let request;
  const actual=await askModel(q,{endpoint:'https://example.test/chat/completions',model:'fixture'},'fixture-key',undefined,{fetchImpl:async(url,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answers:matchingAnswers})}}]})};}});
  const data=JSON.parse(request.messages[1].content);assert.equal(data.matchingCount,10);assert.equal(data.options.length,10);assert.deepEqual(data.leftItems.map(item=>item.text),matchingPrompts);assert.deepEqual(data.leftItems.map(item=>item.underlinedWords),matchingWords.map(word=>[word]));assert.match(request.messages[0].content,/using every option exactly once/);assert.deepEqual(actual.answers,matchingAnswers);
  for(const values of [matchingAnswers.slice(1),Array(10).fill(matchingAnswers[0]),['C','F','H','A','I','D','B','J','G','E'],[...matchingAnswers.slice(0,9),'invented option']])assert.throws(()=>Core.parseModelAnswer(JSON.stringify({answers:values}),q),/配对数量|选项不一致/);
});

test('whole-exercise matching preserves and remaps every pair when both columns and labels change',()=>{
  const saved=Core.validateBank([record()]),index=Core.buildBankIndex(saved),q=read({reverse:true}).questions[0];
  assert.equal(saved.length,1);assert.equal(index.size,0);assert.equal(saved[0].pages[0].questions[0].prompts.length,10);assert.equal(saved[0].verification.total,10);
  const answers=Core.matchExercisePage([q],scope,index);assert.equal(answers[0].ordered,true);assert.deepEqual(answers[0].answers,[...matchingAnswers].reverse());assert.equal(answers[0].source,'整题题库');
  const changed=structuredClone(q);changed.prompts[0]+=' altered';assert.equal(Core.matchExercisePage([changed],scope,index),null);
  changed.prompts=q.prompts;changed.promptEmphasis[0]=[];assert.equal(Core.matchExercisePage([changed],scope,index),null);
  assert.equal(Core.matchExercisePage([q],{...scope,entryKey:'different'},index),null);
  const conflict=structuredClone(saved[0]);conflict.pages[0].questions[0].answer.reverse();assert.equal(Core.matchExercisePage([q],scope,Core.buildBankIndex([...saved,conflict])),null,'different permutations are conflicting answers');
});

test('matching bank schema requires complete prompt, option, emphasis, sortable fields and grading coverage',()=>{
  const row=record();assert.deepEqual(Core.validateBank(JSON.parse(JSON.stringify(Core.validateBank([row])))),Core.validateBank([row]));
  for(const mutate of [q=>q.prompts.pop(),q=>q.promptEmphasis.pop(),q=>q.answer.pop(),q=>q.fields[0].items.pop(),q=>q.fields[0].items[0].text='another option',q=>q.options[1]=q.options[0],q=>q.answer[1]=q.answer[0]]){const altered=structuredClone(row);mutate(altered.pages[0].questions[0]);assert.throws(()=>Core.validateBank([altered]),/格式无效/);}
  const proof={summary:true,total:10,objective:10,subjective:0,incorrect:0,partial:0,unanswered:0,grading:{correctRatios:[{correct:10,total:10}]}};
  assert.equal(fullCorrectProof(proof,row.pages).unit,'blanks');assert.equal(fullCorrectProof({...proof,total:9,objective:9},row.pages),null);
});

test('matching whole records deduplicate by full left-to-right mapping and persist all ten pairs atomically',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/matching-bank-'));
  try{
    const store=await new Store(directory,{env:{}}).load(),first=Core.validateExercise(record());assert.equal((await store.learnVerifiedExercise(first)).added,true);
    const reordered=Core.validateExercise(record(read({reverse:true}).questions[0]));assert.equal(Core.exerciseIdentity(first),Core.exerciseIdentity(reordered));assert.equal((await store.learnVerifiedExercise(reordered)).unchanged,true);
    assert.equal(store.data.bank.length,1);await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.deepEqual(restored.data.bank,[first]);assert.doesNotMatch(JSON.stringify(restored.data.bank),/data-ustudy|selector/);await restored.flush();
  }finally{await rm(directory,{recursive:true,force:true});}
});
