import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {askModel} from '../answer-provider.mjs';
import * as Core from '../shared/core.mjs';
import {functionMatchingHTML,functionGroups,functionOptions,functionAnswers} from './fixtures/function-matching.mjs';
function read(options={}){const {window,document}=parseHTML(functionMatchingHTML(options));globalThis.document=document;globalThis.getComputedStyle=()=>({visibility:'visible'});window.HTMLElement.prototype.getClientRects=function(){return [{}];};return collectQuestionsFromDOM({includeDiagnostics:true});}
test('communicative functions preserve six numbered expressions, emphasis and two fixed number groups',()=>{
  const report=read();assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);const q=report.questions[0];assert.equal(q.type,'matching');assert.equal(q.questionType,'communicative_function_matching');assert.deepEqual(q.prompts,functionGroups);assert.deepEqual(q.options,functionOptions);assert.equal(q.targets[0].items.length,2);for(let n=1;n<=6;n++)assert.ok(q.context.includes(n+'. '));assert.match(q.context,/Emphasized: Come on!/);assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:functionAnswers}),q).answers,functionAnswers);
});
test('missing expressions, duplicate groups and unknown references block functional matching',()=>{
  for(const options of [{missingSource:true},{duplicateGroup:true},{unknownReference:true}]){const report=read(options);assert.equal(report.questions.length,0);assert.ok(report.issues.some(issue=>/交际功能/.test(issue)));}
});
test('the function model request returns one option per group instead of one per expression',async()=>{
  const q=read().questions[0];let sent;await askModel(q,{endpoint:'https://fixture.example.test/v1/chat/completions',model:'fixture'},'fixture-key',undefined,{fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:functionAnswers})}}]}));}});const data=JSON.parse(sent.messages[1].content);assert.equal(data.matchingType,'communicative_function_matching');assert.equal(data.matchingCount,2);assert.deepEqual(data.leftItems.map(item=>item.text),functionGroups);assert.match(sent.messages[0].content,/not an individual expression/);assert.match(data.passage,/The creep!/);assert.throws(()=>Core.parseModelAnswer(JSON.stringify({answers:Array(6).fill(functionOptions[0])}),q));
});
