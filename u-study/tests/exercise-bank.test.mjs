import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import * as Core from '../shared/core.mjs';
import {Store} from '../store.mjs';
import {fullCorrectProof} from '../exercise-learning.mjs';

const scope={courseId:'book',unitId:'unit',entryKey:JSON.stringify(['unit',['Practice'],'Exercise 1'])};
function parts(){return [
  {question:'Which option is correct?',type:'single',options:['Red','Blue'],context:'The original full reading passage.',wordBank:[],blankOptions:[],fields:[{kind:'native'},{kind:'native'}],answer:['Blue']},
  {question:'Fill both numbered blanks.',type:'text',options:[],context:'She ____ home and they ____ daily.',wordBank:['goes','walk'],blankOptions:[['goes','went'],[]],fields:[{kind:'select',key:'one',choices:[{text:'goes',value:'go'},{text:'went',value:'went'}]},{kind:'text',key:'two'}],answer:['goes','walk']},
  {question:'Write a complete letter.',type:'text',questionType:'writing_group',options:[],context:'Include all three paragraphs.',wordBank:[],blankOptions:[[]],fields:[{kind:'editable',key:'essay'}],answer:['Dear Alex,\n\nWe met at the library.\n\nYours, Sam']}
];}
const bundle=()=>({kind:'exercise',version:1,title:'Practice / Exercise 1',scope:{...scope},pages:[{number:1,questions:parts()}],verification:{method:'platform-all-correct',total:3,correct:3,unit:'questions',verifiedAt:100},learnedAt:100});
const current=row=>row.pages[0].questions.map(({fields,answer,...question})=>({...question,targets:fields.map((field,index)=>({...field,selector:'#field-'+index}))}));
const clone=value=>JSON.parse(JSON.stringify(value));

test('complete exercises round-trip every field, passage, blank, dropdown and multi-paragraph answer as one record',()=>{
  const row=bundle();row.pages[0].questions[0].context='Full material. '.repeat(6000);
  row.pages[0].questions[2].explanation='Full explanation.\n'.repeat(2000);
  const original=Core.validateBank([row]),restored=Core.validateBank(JSON.parse(JSON.stringify(original)));
  assert.equal(restored.length,1);assert.deepEqual(restored,original);assert.equal(restored[0].pages[0].questions[0].context,row.pages[0].questions[0].context);
  assert.equal(restored[0].pages[0].questions[2].explanation,row.pages[0].questions[2].explanation);
  assert.equal(Core.buildBankIndex(restored).size,0,'automatic exercises do not become standalone question rows');
});

test('complete-page matches tolerate question, option and word-bank ordering while preserving blank answer order',()=>{
  const row=bundle(),index=Core.buildBankIndex(Core.validateBank([row])),questions=current(row);
  questions[0].options.reverse();questions[1].wordBank.reverse();questions[1].targets[0].choices.reverse();questions[1].blankOptions[0].reverse();questions.reverse();
  const answers=Core.matchExercisePage(questions,scope,index);
  assert.equal(answers.length,3);assert.deepEqual(answers[0].answers,row.pages[0].questions[2].answer);
  assert.deepEqual(answers[1].answers,['goes','walk']);assert.deepEqual(answers[2].indexes,[0]);
  assert.equal(Core.matchAnswer(questions[0],index),null,'a fragment cannot independently match an exercise record');
});

test('a changed passage, missing part, changed dropdown, changed word bank or different exercise rejects the complete-page match',()=>{
  const row=bundle(),index=Core.buildBankIndex(Core.validateBank([row]));
  for(const change of [questions=>questions.pop(),questions=>questions[1].wordBank.push('new word'),questions=>questions[0].context='A different passage',questions=>questions[1].targets[0].choices[0].text='runs']){
    const questions=current(clone(row));change(questions);assert.equal(Core.matchExercisePage(questions,scope,index),null);
  }
  assert.equal(Core.matchExercisePage(current(row),{...scope,entryKey:'another leaf'},index),null);
});

test('learned literal single-letter choices remain literal after the options are reordered',()=>{
  const row=bundle();row.pages[0].questions=[{...parts()[0],options:['B','A'],answer:['A']}];row.verification.total=row.verification.correct=1;
  const saved=Core.validateBank([row]),questions=current(saved[0]);questions[0].options=['A','B'];
  assert.deepEqual(Core.matchExercisePage(questions,scope,Core.buildBankIndex(saved))[0].answers,['A']);
});

test('a platform-verified multiple-choice answer may explicitly select none without admitting empty single-choice or text answers',()=>{
  const row=bundle();row.pages[0].questions=[{...parts()[0],type:'multiple',answer:[]}];row.verification.total=row.verification.correct=1;
  const saved=Core.validateBank([row]),answer=Core.matchExercisePage(current(saved[0]),scope,Core.buildBankIndex(saved))[0];assert.deepEqual(answer.answers,[]);assert.deepEqual(answer.indexes,[]);
  row.pages[0].questions[0].type='single';assert.throws(()=>Core.validateBank([row]),/整题/);
});

test('incomplete or truncated exercise records are rejected instead of silently dropping parts',()=>{
  for(const change of [row=>delete row.pages[0].questions[0].context,row=>row.pages[0].questions[1].answer.pop(),row=>row.pages[0].questions[1].blankOptions.pop(),row=>row.pages[0].questions[0].answer=['A'],row=>row.pages[0].number=2,row=>row.verification.correct=2,row=>row.pages[0].questions[1].fields[0].choices={}]){
    const row=bundle();change(row);assert.throws(()=>Core.validateBank([row]),/整题/);
  }
});

test('all-correct proof distinguishes completion, passing, objective-only grading, pending work and incomplete coverage',()=>{
  const pages=bundle().pages,feedback={summary:true,failed:false,total:3,objective:2,subjective:1,correct:3,incorrect:0,partial:0,unanswered:0,grading:{correctRatios:[{correct:3,total:3}],pending:false}};
  assert.equal(fullCorrectProof(feedback,pages).correct,3);
  for(const change of [{failed:true},{incorrect:1},{partial:1},{unanswered:1},{total:7},{total:null},{grading:{pending:true,correctRatios:[{correct:3,total:3}]}},{grading:{correctRatios:[{correct:2,total:2}]}},{grading:{}},{grading:{correctRatios:[{correct:3,total:3},{correct:1,total:2}]}},{grading:{correctRatios:[{correct:3,total:3}],score:95,maxScore:100}}])assert.equal(fullCorrectProof({...feedback,...change},pages),null);
  assert.ok(fullCorrectProof({...feedback,grading:{score:100,maxScore:100,correctRatios:[]}},pages));
  const cloze={number:1,questions:[parts()[1]]};assert.equal(fullCorrectProof({...feedback,total:2,objective:2,subjective:0,grading:{correctRatios:[{correct:2,total:2}]}},[cloze]).unit,'blanks');
});

test('verified exercises are atomically deduplicated, indexed and retained across restart without changing legacy rows',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/exercise-bank-'));
  try{
    const store=await new Store(directory,{env:{}}).load();store.data.bank=Core.validateBank([{question:'An older imported question?',answer:'yes'}]);
    const row=bundle();assert.equal((await store.learnVerifiedExercise(row)).added,true);const index=store.getBankIndex();
    row.pages[0].questions[2].answer=['A newly graded complete letter.'];row.learnedAt=200;
    assert.equal((await store.learnVerifiedExercise(row)).added,false);assert.equal(store.data.bank.length,2);assert.equal(store.publicState().exerciseBankCount,1);assert.notEqual(store.getBankIndex(),index);
    await store.flush();const reloaded=await new Store(directory,{env:{}}).load();assert.equal(reloaded.data.bank.length,2);
    assert.deepEqual(Core.matchExercisePage(current(row),scope,reloaded.getBankIndex())[2].answers,['A newly graded complete letter.']);await reloaded.flush();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('failed learned-bank writes keep the prior complete exercise and its index intact',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/exercise-bank-failure-'));const store=await new Store(directory,{env:{}}).load();
  try{
    await store.learnVerifiedExercise(bundle());const before=clone(store.data.bank),index=store.getBankIndex(),persist=store.persist.bind(store);
    store.persist=async()=>{throw new Error('disk unavailable');};const changed=bundle();changed.pages[0].questions[2].answer=['A different fully graded letter.'];
    await assert.rejects(store.learnVerifiedExercise(changed),error=>error.status===507);assert.deepEqual(store.data.bank,before);assert.equal(store.getBankIndex(),index);
    store.persist=persist;await store.flush();
  }finally{clearTimeout(store.saveTimer);await store.writeQueue;await rm(directory,{recursive:true,force:true});}
});

test('identical all-correct exercises reuse the existing complete record without rewriting the bank file',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/exercise-bank-deduplicate-'));const store=await new Store(directory,{env:{}}).load();
  try{
    const row=bundle();await store.learnVerifiedExercise(row);const bank=store.data.bank,index=store.getBankIndex();
    const changed=clone(row);changed.learnedAt=200;changed.verification.verifiedAt=200;
    assert.equal((await store.learnVerifiedExercise(changed)).unchanged,true);assert.equal(store.data.bank,bank);assert.equal(store.getBankIndex(),index);await store.flush();
  }finally{clearTimeout(store.saveTimer);await store.writeQueue;await rm(directory,{recursive:true,force:true});}
});
