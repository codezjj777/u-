import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {askModel} from '../answer-provider.mjs';
import {questionResponseHTML,responsePrompts,responseOptions,responseAnswers,responseTranscript} from './fixtures/question-response.mjs';
function read(options={},settings={}){const {window,document}=parseHTML(questionResponseHTML(options));globalThis.document=document;globalThis.getComputedStyle=()=>({visibility:'visible'});window.HTMLElement.prototype.getClientRects=function(){return [{}];};return collectQuestionsFromDOM({...settings,includeDiagnostics:true});}
test('question-response matching identifies all six fixed questions and full fragment options',()=>{
  const report=read({transcript:true});assert.deepEqual(report.issues,[]);const q=report.questions[0];assert.equal(report.questions.length,1);assert.equal(q.questionType,'question_response_matching');assert.deepEqual(q.prompts,responsePrompts);assert.deepEqual([...q.options].sort(),[...responseOptions].sort());assert.ok(q.context.includes(responseTranscript));assert.equal(q.targets[0].items.length,6);
});
test('missing video transcript requests media without misclassifying the matching controls as unsupported',()=>{
  const report=read();assert.equal(report.questions.length,1);assert.equal(report.mediaRequests.length,1);assert.ok(report.issues.some(v=>/转写材料/.test(v)));assert.ok(!report.issues.some(v=>/未适配/.test(v)));
  const ready=read({}, {mediaTranscripts:{[report.mediaRequests[0].key]:responseTranscript}});assert.deepEqual(ready.issues,[]);assert.ok(ready.questions[0].context.includes(responseTranscript));
});
test('missing or duplicate fixed questions remain blocked and unrelated sorting instructions are not accepted',()=>{
  for(const options of [{missing:true},{duplicate:true},{directions:'Put the responses in chronological order.'}]){const report=read({transcript:true,...options});assert.equal(report.questions.length,0);assert.ok(report.issues.length);}
});
test('response matching asks for the exact conversation expressions in fixed question order',async()=>{
  const q=read({transcript:true}).questions[0];let sent;
  const answer=await askModel(q,{endpoint:'https://fixture.example.test/v1/chat/completions',model:'fixture'},'fixture',undefined,{fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:responseAnswers})}}]}));}});
  const data=JSON.parse(sent.messages[1].content);assert.equal(data.matchingType,'question_response_matching');assert.equal(data.matchingCount,6);assert.deepEqual(data.leftItems.map(v=>v.text),responsePrompts);assert.match(sent.messages[0].content,/do not finish, rewrite or join/);assert.deepEqual(answer.answers,responseAnswers);
});
