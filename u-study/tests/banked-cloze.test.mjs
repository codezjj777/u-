import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import * as Core from '../shared/core.mjs';
import {askModel} from '../answer-provider.mjs';
import {bankedClozeHTML,bankedClozeDirections,bankedClozeWords,bankedClozeAnswers,bankedClozeWordAnswers} from './fixtures/banked-cloze.mjs';

function read(html=bankedClozeHTML()){
  const {window,document}=parseHTML(html);globalThis.document=document;
  globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);return report.questions[0];
}
test('a shared Directions header inside main reaches the nested cloze as explicit exercise requirements',()=>{
  const question=read();assert.equal(question.directions,'Directions: '+bankedClozeDirections);assert.match(question.context,/capital letter A-O/);assert.equal(question.targets.length,10);assert.equal(question.wordBank.length,15);
});
test('letter captions survive a raw data-option-value so the model receives the authored label-to-word mapping',()=>{
  const question=read(bankedClozeHTML({captions:true}));assert.deepEqual(question.wordBank,bankedClozeWords.map((word,i)=>String.fromCharCode(65+i)+'. '+word));
});
test('the real 364-character shared context supplies the complete A-O bank from a separate material table',()=>{
  const question=read(bankedClozeHTML({tableBank:true}));assert.equal(question.context.length,364);assert.equal(question.directions.length,176);assert.equal(question.targets.length,10);
  assert.deepEqual(question.wordBank,bankedClozeWords.map((word,i)=>String.fromCharCode(65+i)+'. '+word));assert.equal(Core.textAnswerRequirements(question).choices.length,15);
});
test('material word-bank extraction uses the printed labels even when the table cells are reordered',()=>{
  read(bankedClozeHTML({tableBank:true}));const doc=globalThis.document,cell=doc.querySelector('td');cell.parentElement.append(cell);
  const [question]=collectQuestionsFromDOM();assert.equal(question.wordBank.length,15);assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:bankedClozeWordAnswers}),question).answers,bankedClozeAnswers);
});
test('an incomplete or unlabeled material table cannot assign missing letters by cell positions',()=>{
  for(const unlabeled of [false,true]){
    read(bankedClozeHTML({tableBank:true}));const doc=globalThis.document;
    if(unlabeled)doc.querySelectorAll('td').forEach(td=>td.textContent=td.textContent.replace(/^[A-Z]\. /,''));else doc.querySelector('td').remove();
    const [question]=collectQuestionsFromDOM();assert.equal(Core.textAnswerRequirements(question).choices.length,0);
  }
});
test('conflicting complete material banks are reported instead of mixing their choices',()=>{
  read(bankedClozeHTML({tableBank:true}));const doc=globalThis.document,table=doc.querySelector('table'),clone=table.cloneNode(true);clone.querySelector('td').textContent='A. different';table.after(clone);
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.ok(report.issues.some(issue=>/多个不一致的字母词库/.test(issue)));
});
test('the actual AI payload carries complete directions and an explicit uppercase non-reusable letter answer contract',async()=>{
  const question=read();let calls=0;
  const result=await askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'},'fixture-key',undefined,{fetchImpl:async(_url,options)=>{
    calls++;const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);
    assert.equal(payload.directions,question.directions);assert.equal(payload.blankCount,10);assert.match(request.messages[0].content,/exercise directions/i);
    assert.equal(payload.answerRequirements.format,'word_bank_labels');assert.equal(payload.answerRequirements.uppercase,true);assert.equal(payload.answerRequirements.allowReuse,false);assert.deepEqual(payload.answerRequirements.choices,bankedClozeWords.map((text,i)=>({label:String.fromCharCode(65+i),text})));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:bankedClozeAnswers})}}]}));
  }});assert.equal(calls,1);assert.deepEqual(result.answers,bankedClozeAnswers);
});
test('word responses are mapped to their authored capital letters before any field write',()=>{
  const question=read();assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:bankedClozeWordAnswers}),question).answers,bankedClozeAnswers);
});
test('lowercase and complete labeled responses use authored labels without depending on word-bank display order',()=>{
  const question=read();question.wordBank.reverse();
  for(const answers of [bankedClozeAnswers.map(label=>label.toLowerCase()),bankedClozeAnswers.map((label,i)=>label+'. '+bankedClozeWordAnswers[i])])assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers}),question).answers,bankedClozeAnswers);
});
test('duplicate labels, conflicting labeled words and invented words never reach the writer',()=>{
  const question=read();
  for(const values of [[...bankedClozeAnswers.slice(0,9),'E'],['B. consultants',...bankedClozeAnswers.slice(1)],['invented',...bankedClozeAnswers.slice(1)]])assert.throws(()=>Core.parseModelAnswer(JSON.stringify({answers:values}),question),error=>error.code==='AI_ANSWER_REQUIREMENTS');
});
test('an ambiguous or unlabeled word bank stops before a provider request rather than guessing letters by position',async()=>{
  for(const wordBank of [bankedClozeWords,['A. first','A. second']]){
    const question={...read(),wordBank};let calls=0;
    await assert.rejects(askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'},'fixture-key',undefined,{fetchImpl:async()=>{calls++;throw new Error('Must not request AI.');}}),error=>error.code==='AI_WORD_BANK_LABELS_MISSING');assert.equal(calls,0);
  }
});
test('ordinary word-form blanks and dropdowns keep full word answers',()=>{
  const question={...read(),directions:'Complete the sentences with the correct form of the given words.'};
  assert.equal(Core.textAnswerRequirements(question),null);assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:bankedClozeWordAnswers}),question).answers,bankedClozeWordAnswers);
  const dropdown={...read(),targets:[{kind:'select',choices:[{text:'consultants',value:'consultants'}]}]};assert.equal(Core.textAnswerRequirements(dropdown),null);assert.deepEqual(Core.parseModelAnswer('{"answers":["consultants"]}',dropdown).answers,['consultants']);
  const uppercaseWords={...question,directions:'Fill in the blanks with the words. Write your answers in capital letters.'};assert.equal(Core.textAnswerRequirements(uppercaseWords),null);assert.deepEqual(Core.parseModelAnswer(JSON.stringify({answers:bankedClozeWordAnswers.map(word=>word.toUpperCase())}),uppercaseWords).answers,bankedClozeWordAnswers.map(word=>word.toUpperCase()));
});
test('a label outside the explicitly required A-O range cannot enter the answer contract',()=>{
  const question=read();question.wordBank.push('P. extra');assert.deepEqual(Core.textAnswerRequirements(question).choices,[]);
});
test('a change only in exercise directions invalidates the pinned question and incomplete banks cannot match',()=>{
  const question=read(),changed={...question,directions:question.directions.replace('capital letter A-O','word')};
  assert.notEqual(Core.questionSignature([question]),Core.questionSignature([changed]));
  assert.equal(Core.resolveAnswer({...question,wordBank:bankedClozeWords},{answer:bankedClozeWordAnswers}),null);
});
test('model contract errors receive one bounded repair request containing the same full directions and word mapping',async()=>{
  const question=read(),responses=[[...bankedClozeAnswers.slice(0,9),'E'],bankedClozeAnswers];let calls=0;
  const result=await askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'},'fixture-key',undefined,{retryDelayMs:0,fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body);if(calls){const repair=JSON.parse(request.messages.at(-1).content);assert.equal(repair.directions,question.directions);assert.equal(repair.blankCount,10);assert.equal(repair.answerRequirements.allowReuse,false);}
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:responses[calls++]})}}]}));
  }});assert.equal(calls,2);assert.deepEqual(result.answers,bankedClozeAnswers);
});
test('persistent format failure stops after one repair without cycling through guesses',async()=>{
  const question=read();let calls=0;
  await assert.rejects(askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'},'fixture-key',undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:Array(10).fill('E')})}}]}));}}),error=>error.code==='AI_ANSWER_REQUIREMENTS');assert.equal(calls,2);
});
test('separate exercise headers do not leak instructions into a neighboring question',()=>{
  read(bankedClozeHTML());const doc=globalThis.document;
  const first=doc.querySelector('main'),second=first.cloneNode(true);second.querySelector('.abs-direction').textContent='Use full words in the second exercise.';doc.body.append(second);
  const questions=collectQuestionsFromDOM();assert.equal(questions.length,2);assert.match(questions[0].directions,/capital letter A-O/);assert.equal(questions[1].directions,'Use full words in the second exercise.');assert.doesNotMatch(questions[1].context,/capital letter A-O/);
});
test('legacy verified records with unlabeled words remain readable without changing their original submitted evidence',()=>{
  const question=read();delete question.directions;question.wordBank=[...bankedClozeWords];
  const row={kind:'exercise',version:1,title:'Legacy Banked cloze',scope:{courseId:'book',unitId:'unit',entryKey:'cloze'},pages:[{number:1,questions:[{...question,fields:question.targets.map(({kind,key})=>({kind,key})),blankOptions:Array.from({length:10},()=>[]),answer:bankedClozeWordAnswers}]}],verification:{method:'platform-all-correct',total:10,correct:10,unit:'blanks',verifiedAt:1},learnedAt:1};
  const saved=Core.validateExercise(row);assert.deepEqual(saved.pages[0].questions[0].answer,bankedClozeWordAnswers);assert.equal(Core.matchExercisePage([read()],row.scope,Core.buildBankIndex([saved])),null);
});
