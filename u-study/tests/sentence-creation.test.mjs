import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {askModel} from '../answer-provider.mjs';
import {sentenceCreationHTML,sentenceCreationDirections,sentenceCreationNotes,sentenceCreationAnswers} from './fixtures/sentence-creation.mjs';

const settings={endpoint:'https://ai.example.test/v1/chat/completions',model:'grammar-fixture'},key='private-sentence-key';
const response=(content,finish_reason='stop')=>new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)},finish_reason}]}));
function questions(){
  const {window,document}=parseHTML(sentenceCreationHTML());globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return collectQuestionsFromDOM();
}

test('three numbered sentence slots all include the complete directions and grammar Notes',()=>{
  const found=questions();assert.equal(found.length,3);assert.deepEqual(found.map(question=>question.question),['1.','2.','3.']);
  for(const question of found){assert.equal(question.targets.length,1);assert.ok(question.context.includes(sentenceCreationDirections));for(const note of sentenceCreationNotes)assert.ok(question.context.includes(note));assert.doesNotMatch(question.question,/0\/1000|请输入答案/);}
});

test('sentence-creation prompts require a complete example for a bare question number',async()=>{
  const question=questions()[1];let body;
  const answer=await askModel(question,settings,key,undefined,{fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response({answers:[sentenceCreationAnswers[1]]});}});
  const payload=JSON.parse(body.messages[1].content);assert.equal(payload.question,'2.');assert.equal(payload.passage,question.context);assert.equal(payload.answerTask.kind,'original_sentence_creation');assert.equal(payload.answerTask.answerCount,1);assert.equal(payload.answerTask.exampleIndex,2);assert.equal(payload.answerTask.preferredVerb,'believed');assert.match(body.messages[0].content,/directions and grammar Notes are sufficient/);assert.match(body.messages[0].content,/Always provide the requested sentences/);assert.match(body.messages[0].content,/numbered field/);assert.doesNotMatch(body.messages[0].content,/if essential information is absent return/);assert.equal(JSON.stringify(body).includes(key),false);assert.deepEqual(answer.answers,[sentenceCreationAnswers[1]]);
});

for(const [name,content,finish] of [
  ['missing-material status',{answers:[],status:'missing_material'}],
  ['empty array',{answers:[]}],
  ['empty answer',{answers:['']}],
  ['empty content',''],
  ['wrong answer count',{answers:sentenceCreationAnswers.slice(0,2)}],
  ['invalid JSON','not a JSON answer'],
  ['a placeholder',{answers:['Insufficient information.']}],
  ['the wrong sentence pattern',{answers:['We expect people to work together.']}],
  ['an unfinished Notes example',{answers:['It is expected that the new company...']}],
  ['truncated output',{answers:[sentenceCreationAnswers[1]]},'length']
])test(`a sentence-creation ${name} is repaired once using an explicit complete-answer request`,async()=>{
  const question=questions()[1],requests=[],retries=[];let before=0;
  const answer=await askModel(question,settings,key,undefined,{retryDelayMs:0,beforeAttempt:()=>before++,onRetry:event=>retries.push(event),fetchImpl:async(_url,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?response(content,finish):response({answers:[sentenceCreationAnswers[1]]});}});
  assert.equal(requests.length,2);assert.equal(before,2);assert.equal(retries.length,1);assert.equal(retries[0].code,'AI_SENTENCE_ANSWER_REQUIRED');assert.equal(JSON.parse(requests[1].messages.at(-1).content).answerTask.answerCount,1);assert.match(JSON.parse(requests[1].messages.at(-1).content).responseValidation,/original sentence-writing exercise/);assert.equal(JSON.stringify(requests).includes(key),false);assert.deepEqual(answer.answers,[sentenceCreationAnswers[1]]);
});

test('a combined sentence task returns one complete sentence per field',async()=>{
  const question={...questions()[0],targets:[{kind:'text'},{kind:'text'},{kind:'text'}]};
  const answer=await askModel(question,settings,key,undefined,{fetchImpl:async(_url,options)=>{assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).answerTask.answerCount,3);return response({answers:sentenceCreationAnswers});}});assert.deepEqual(answer.answers,sentenceCreationAnswers);
});

test('repeated unusable sentence responses stop after one repair and remain recoverable',async()=>{
  let calls=0;await assert.rejects(askModel(questions()[0],settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;return response({answers:[],status:'missing_material'});}}),error=>error.code==='AI_SENTENCE_ANSWER_REQUIRED'&&error.retryable===true&&error.attempts===2);assert.equal(calls,2);
});

test('cancellation after a missing sentence response prevents its repair request',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(askModel(questions()[0],settings,key,controller.signal,{retryDelayMs:0,onRetry:()=>controller.abort(new Error('stop-sentence-repair')),fetchImpl:async()=>{calls++;return response({answers:[]});}}),/stop-sentence-repair/);assert.equal(calls,1);
});

test('rewriting and source-dependent questions retain missing-material handling',async()=>{
  for(const context of ['Make sentences about what happened in the recording.','Make sentences based on the passage.','Rewrite the given sentences using the structure "It is expected that ...".']){
    let calls=0;const question={question:'2.',type:'text',options:[],targets:[{kind:'text'}],context};
    await assert.rejects(askModel(question,settings,key,undefined,{fetchImpl:async(_url,options)=>{calls++;assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).answerTask,undefined);return response({answers:[],status:'missing_material'});}}),error=>error.code==='AI_MISSING_MATERIAL');assert.equal(calls,1);
  }
});

test('a sentence-writing instruction quoted in factual material is not treated as the current task',async()=>{
  for(const [question,context] of [
    ['What did the teacher ask the class to do?','Directions: Answer the following question. The teacher said, "Make sentences using this structure."'],
    ['What did the teacher ask the class to do?','Make sentences using this structure.'],
    ['2.','Directions: Answer the following question. The teacher said, "Make sentences using this structure."']
  ]){
    let calls=0;await assert.rejects(askModel({question,context,type:'text',options:[],targets:[{kind:'text'}]},settings,key,undefined,{fetchImpl:async(_url,options)=>{calls++;assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).answerTask,undefined);return response({answers:[],status:'missing_material'});}}),error=>error.code==='AI_MISSING_MATERIAL');assert.equal(calls,1);
  }
});
