import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {askModel} from '../answer-provider.mjs';
import {readingQuestions,readingParagraphs,readingAnswers,readingDiscussionHTML} from './fixtures/reading-discussion.mjs';

const settings={endpoint:'https://ai.example.test/v1/chat/completions',model:'discussion-fixture'},key='private-provider-key';
const response=content=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));

function questions(){const {window,document}=parseHTML(readingDiscussionHTML());globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return collectQuestionsFromDOM();}

test('all four short answers include the same complete reading including the off-screen final paragraph',()=>{
  const found=questions();assert.equal(found.length,4);assert.equal(new Set(found.map(question=>question.context)).size,1);
  for(const question of found){for(const paragraph of readingParagraphs)assert.ok(question.context.includes(paragraph));assert.doesNotMatch(question.context,/Sidebar material/);assert.equal(question.targets.length,1);}
});

test('text-only reading discussion requests allow qualified comparisons without requiring invented survey evidence',async()=>{
  const question=questions()[3];let calls=0,request;
  const result=await askModel(question,settings,key,undefined,{fetchImpl:async(_url,options)=>{
    calls++;request=JSON.parse(options.body);
    return response({answers:[readingAnswers[3]],explanation:'开放式讨论参考答案，使用保留表述，不声称有比较调查数据。'});
  }});const system=request.messages[0].content,payload=JSON.parse(request.messages[1].content);assert.match(system,/open-ended discussion/i);assert.match(system,/general knowledge/i);assert.match(system,/comparative (?:data|measurements)/i);assert.match(system,/do not (?:invent|fabricate) (?:statistics|survey)/i);assert.match(system,/missing_material/);assert.equal(payload.question,question.question);assert.equal(payload.passage,question.context);assert.equal(payload.blankCount,1);assert.equal(calls,1);assert.deepEqual(result.answers,[readingAnswers[3]]);
});

test('personal-experience guidance applies to ordinary text answers without assuming learner history',async()=>{
  const question=questions()[0];let request;const result=await askModel(question,settings,key,undefined,{fetchImpl:async(_url,options)=>{
    request=JSON.parse(options.body);
    return response({answers:[readingAnswers[0]],explanation:'个人经验部分为可调整的示例。'});
  }});const system=request.messages[0].content;assert.match(system,/personal.experience/i);assert.match(system,/adaptable sample/i);assert.match(system,/learner.*(?:history|experience)/i);assert.equal(result.answers.length,1);
});

test('discussion guidance does not manufacture an answer when essential passage or audio facts are actually missing',async()=>{
  let calls=0;await assert.rejects(askModel({question:'What reason did the speaker give for leaving?',type:'text',options:[],targets:[{kind:'text'}],context:'Discuss the recording.'},settings,key,undefined,{fetchImpl:async()=>{calls++;return response({answers:[],status:'missing_material',explanation:key});}}),error=>error.code==='AI_MISSING_MATERIAL'&&!error.message.includes(key));assert.equal(calls,1);
});
