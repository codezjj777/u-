import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {askModel} from '../answer-provider.mjs';
import * as Core from '../shared/core.mjs';
import {partMatchingHTML,partMatchingPrompts,partMatchingAnswers,partMatchingParagraphs} from './fixtures/part-matching.mjs';

function read(options={}){const {window,document}=parseHTML(partMatchingHTML(options));globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return collectQuestionsFromDOM({includeDiagnostics:true});}

test('singular part-to-main-idea matching keeps all Roman labels, paragraph ranges and the full passage',()=>{
  const report=read();assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);const [q]=report.questions;
  assert.equal(q.type,'matching');assert.equal(q.questionType,'main_idea_matching');assert.deepEqual(q.prompts,partMatchingPrompts);assert.deepEqual(q.promptEmphasis,[[],[],[]]);assert.equal(q.targets[0].items.length,3);for(const paragraph of partMatchingParagraphs)assert.ok(q.context.includes(paragraph));assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:partMatchingAnswers}),q).answers,partMatchingAnswers);
});

test('a standalone reading renderer supplies full matching material while missing or duplicate pairs remain blocked',()=>{
  const [q]=read({fallbackMaterial:true}).questions;assert.ok(q.context.includes(partMatchingParagraphs[7]));
  for(const options of [{noMaterial:true},{missing:true},{duplicate:true}]){const report=read(options);assert.equal(report.questions.length,0);assert.ok(report.issues.length);}
});

test('part matching sends all three paragraph references and the ending to the configured model as one ordered task',async()=>{
  const [q]=read().questions;let payload;
  const answer=await askModel(q,{endpoint:'https://fixture.example.test/chat/completions',model:'fixture'},'fixture-key',undefined,{fetchImpl:async(_url,init)=>{payload=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answers:partMatchingAnswers})}}]})};}});
  const sent=JSON.parse(payload.messages[1].content);assert.equal(sent.matchingType,'main_idea_matching');assert.equal(sent.matchingCount,3);assert.deepEqual(sent.leftItems.map(item=>item.text),partMatchingPrompts);assert.ok(sent.passage.includes(partMatchingParagraphs[7]));assert.deepEqual(answer.answers,partMatchingAnswers);
});
