import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import * as Core from '../shared/core.mjs';
import {askModel} from '../answer-provider.mjs';
import {inlineWordBankHTML,inlineWordBankAnswers} from './fixtures/inline-word-bank.mjs';

function dom(html){
  const {window,document}=parseHTML(`<html><body>${html}</body></html>`);
  globalThis.document=document;
  globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
  return document;
}
const choice=(title,extra='')=>`<div class="question-common-abs-choice" ${extra}><div class="ques-title">${title}</div><div class="option-wrap"><div class="option isNotReview selected"><span class="caption">A</span><div class="content">First</div></div><div class="option isNotReview selected"><span class="caption">B</span><div class="content">Second</div></div><div class="option isNotReview"><span class="caption">C</span><div class="content">Third</div></div></div></div>`;

test('legacy multiple choice is recognized from local instructions even with existing selections',()=>{
  dom('<div class="abs-direction">Answer the following questions.</div>'+choice('Select two correct answers.')+choice('Choose all that apply.'));
  const questions=collectQuestionsFromDOM();
  assert.equal(questions.length,2);
  assert.deepEqual(questions.map(q=>q.type),['multiple','multiple']);
  assert.equal(questions[0].targets.length,3);
});

test('instructions and all visible reading blocks are scoped to their exercise',()=>{
  dom(`<section class="layout-container"><div class="abs-direction">Choose one answer.</div><div class="layout-material-container"><p>First paragraph.</p><p>Second paragraph.</p></div><div class="passage">The final clue.</div>${choice('Which clue matters?').replaceAll(' selected','')}</section><section class="layout-container"><div class="abs-direction">Select all that apply.</div><div class="passage">A different passage.</div>${choice('Which clues matter?')}</section><div class="passage" hidden>Stale reading.</div>`);
  const [one,two]=collectQuestionsFromDOM();
  assert.equal(one.type,'single');assert.equal(two.type,'multiple');
  assert.match(one.context,/First paragraph\. Second paragraph\. The final clue/);
  assert.doesNotMatch(one.context,/different passage|Stale/);
  assert.match(two.context,/different passage/);assert.doesNotMatch(two.context,/final clue/);
});

test('inline cloze keeps the sentence, numbered blanks and candidate word bank after writing',()=>{
  dom('<div class="layout-container"><div class="abs-direction">Complete the paragraph using the words.</div><div class="layoutBody-container has-material has-reply"><div class="option-wrapper"><span class="option">early</span><span class="option">walk</span></div><div class="question-common-abs-scoop"><div class="item"><p>We <span class="fe-scoop"><span class="question-number">1</span><span class="comp-abs-input"><input type="text"></span></span> to school <span class="fe-scoop"><span class="question-number">2</span><span class="comp-abs-input"><input type="text"></span></span> every day.</p></div></div></div></div>');
  const [question]=collectQuestionsFromDOM();assert.ok(question);
  assert.equal(question.type,'text');assert.equal(question.targets.length,2);
  assert.match(question.question,/We.*____ \(1\).*school.*____ \(2\).*every day/);
  assert.deepEqual(question.wordBank,['early','walk']);assert.deepEqual(question.options,[]);
  document.querySelector('input').value='walk';
  assert.equal(Core.questionSignature(collectQuestionsFromDOM()),Core.questionSignature([question]));
});

test('five inline blanks keep their prompt and material stable as the page mirrors each typed answer',()=>{
  for(const material of [false,true]){
    dom(inlineWordBankHTML({material}));
    const initial=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(initial.issues,[]);assert.equal(initial.questions.length,1);
    const [question]=initial.questions,expected=Core.questionSignature(initial.questions);
    assert.equal(question.targets.length,5);assert.equal(question.wordBank.length,5);
    assert.match(question.question,/____ \(1\).*____ \(2\).*____ \(3\).*____ \(4\).*____ \(5\)/);
    for(const [index,value] of inlineWordBankAnswers.entries()){
      const input=document.querySelector(`#blank-${index}`);input.value=value;input.nextElementSibling.textContent=value;
      const fresh=collectQuestionsFromDOM({includeDiagnostics:true});
      assert.deepEqual(fresh.issues,[]);assert.equal(Core.questionSignature(fresh.questions),expected,`answer ${index+1} changed the prompt`);
    }
    document.querySelector('[data-sentence="1"]').firstChild.textContent='Li Ping used to be ';
    assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),expected,'real sentence edits must still stop filling');
  }
});

test('pre-existing draft mirrors do not become part of the regenerated inline question',()=>{
  dom(inlineWordBankHTML());const empty=Core.questionSignature(collectQuestionsFromDOM());
  dom(inlineWordBankHTML({draft:'and fill an appointment'}));
  const [question]=collectQuestionsFromDOM();assert.equal(Core.questionSignature([question]),empty);
  assert.doesNotMatch(question.question,/and fill an appointment/);assert.doesNotMatch(question.context,/and fill an appointment/);
  document.querySelector('.option-wrapper .option').textContent='a different expression';
  assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),empty,'word bank edits must still stop filling');
});

test('published blank wrappers also exclude rendered answer copies without dropping surrounding text',()=>{
  dom('<div data-ipublish-question-group-type="fill_blanks_group"><div data-question-id="published"><div class="editor-content">She <span data-dig-empty-id="one"><span class="comp-abs-input"><input></span><span class="answer-width"></span></span> to school every day.<span data-dig-empty-id="stale" hidden><input><span>old hidden answer</span></span></div></div></div>');
  const original=collectQuestionsFromDOM();assert.match(original[0].question,/She.*____ \(1\).*to school every day/);
  assert.equal(original[0].question.match(/____/g).length,1);assert.doesNotMatch(original[0].question,/old hidden answer/);
  document.querySelector('input').value='walks';document.querySelector('.answer-width').textContent='walks';
  assert.equal(Core.questionSignature(collectQuestionsFromDOM()),Core.questionSignature(original));
});

test('short stems and multi-paragraph writing prompts retain all instructions and ignore note search',()=>{
  dom('<div class="question-common-abs-reply"><div class="question-inputbox"><div class="question-inputbox-header"><p>翻译</p><p>Keep both paragraphs.</p></div><div class="question-inputbox-body"><textarea></textarea></div></div></div><div class="question-item"><h3>Go?</h3><input type="text"></div><aside><input type="search"><input type="text" placeholder="搜索笔记"></aside>');
  const questions=collectQuestionsFromDOM();assert.equal(questions.length,2);
  assert.equal(questions[0].question,'翻译 Keep both paragraphs.');assert.match(questions[1].question,/Go\?/);
});

test('annotation editors and note panels do not become missing answer fields',()=>{
  dom('<div class="question-common-abs-question-container"><div class="show-mark-in"><div class="mark-edit-in" contenteditable="true"></div></div><div class="pc-slider-content"><div class="v3notes"><input type="text" placeholder="请输入关键词"></div></div><div class="question-common-abs-reply"><div class="question-inputbox"><div class="question-inputbox-header">Explain the passage.</div><textarea></textarea></div></div></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,1);assert.deepEqual(report.issues,[]);
});

test('nested roots cannot silently drop a sibling answer field',()=>{
  dom('<div class="question"><h3>Complete the two parts.</h3><input type="text"><div class="question-item"><h4>Explain the second part.</h4><textarea></textarea></div></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});
  assert.equal(report.questions.reduce((n,q)=>n+q.targets.length,0),2);
  assert.deepEqual(report.issues,[]);
});

test('native dropdown blanks expose per-blank choices without becoming multiple choice',()=>{
  dom('<div class="question-item"><h3>Complete the sentence.</h3>She <select><option value="">请选择</option><option value="go">goes</option><option value="walk">walks</option></select> home.</div>');
  const [question]=collectQuestionsFromDOM();assert.ok(question);
  assert.equal(question.type,'text');assert.equal(question.targets[0].kind,'select');
  assert.deepEqual(question.blankOptions,[['goes','walks']]);
  assert.deepEqual(question.targets[0].choices,[{text:'goes',value:'go'},{text:'walks',value:'walk'}]);
});

test('ipublish groups split real questions and ignore option IDs and explanation boxes',()=>{
  dom(`<div data-ipublish-question-group-type="rich_text_read_group"><div class="editor-content"><p>A passage about exercise.</p><p>Walking helps.</p></div></div><div data-ipublish-question-group-type="single_choice_group"><div data-question-id="first"><div class="editor-content"><p>Which activity helps?</p></div><div class="answer_strongListView_x"><span class="answer_strongItem_x">A</span><div class="editor-content">Walking</div></div><div class="answer_strongListView_x"><span class="answer_strongItem_x">B</span><div class="editor-content">Sitting</div></div><div class="answer_shortAnswerWrap_x"><textarea placeholder="请输入"></textarea></div></div></div><div data-ipublish-question-group-type="fill_blanks_choice_group"><div data-question-id="second"><div class="editor-content"><p>We <span data-dig-empty-id="1"><input class="answer_answerInput_x"></span> daily.</p></div><span data-question-id="option-id" data-option-value="walk">walk</span><span data-option-value="sit">sit</span><textarea placeholder="请输入"></textarea></div></div>`);
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);
  const [choice,blank]=report.questions;assert.equal(report.questions.length,2);
  assert.equal(choice.type,'single');assert.deepEqual(choice.options,['Walking','Sitting']);
  assert.equal(choice.targets[0].kind,'ipublish-choice');assert.match(choice.context,/Walking helps/);
  assert.equal(blank.type,'text');assert.equal(blank.targets.length,1);assert.match(blank.question,/We.*____ \(1\).*daily/);
  assert.deepEqual(blank.wordBank,['walk','sit']);
});

test('ipublish true false and multiple choice use their declared type',()=>{
  dom('<div data-ipublish-question-group-type="true_false_group"><div data-question-id="tf"><div class="editor-content">Walking is healthy.</div><div class="answer_option_x">T</div><div class="answer_option_x">F</div></div></div><div data-ipublish-question-group-type="multiple_choice_group"><div data-question-id="mc"><div class="editor-content">Select useful habits.</div><div class="answer_strongListView_x"><span class="answer_strongItem_x">A</span><div class="editor-content">Walk</div></div><div class="answer_strongListView_x"><span class="answer_strongItem_x">B</span><div class="editor-content">Run</div></div></div></div>');
  const questions=collectQuestionsFromDOM();assert.equal(questions.length,2);
  assert.deepEqual(questions[0].options,['True','False']);assert.equal(questions[0].type,'single');assert.equal(questions[1].type,'multiple');
});

test('ipublish writing includes preceding assignment and skips its optional explanation',()=>{
  dom('<p data-lexical-node-type="paragraph">Write a letter about healthy habits. Use at least 100 words.</p><div data-lexical-node-type="question-block"><div data-ipublish-question-group-type="writing_group"><div data-question-id="essay"><div class="editor-content">请在此处作答</div><textarea placeholder="请输入答案"></textarea><div class="answer_shortAnswerWrap_x"><textarea placeholder="请输入"></textarea></div></div></div></div>');
  const [question]=collectQuestionsFromDOM();assert.ok(question);assert.equal(question.targets.length,1);
  assert.match(question.context,/Write a letter.*100 words/);
});

test('a required published short answer can use the same wrapper as optional explanations',()=>{
  dom('<div data-ipublish-question-group-type="short_answer_group"><div data-question-id="short"><div class="editor-content">Explain why walking helps.</div><div class="answer_shortAnswerWrap_x"><textarea placeholder="请输入答案"></textarea></div></div></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);assert.equal(report.questions[0].targets.length,1);
});

test('ordinary text prompts keep their existing bank identity while inline blanks are numbered',()=>{
  dom('<fieldset><legend>Complete the answer.</legend><input type="text"></fieldset>');
  const [question]=collectQuestionsFromDOM();assert.equal(question.question,'Complete the answer.');
  const bank=Core.buildBankIndex(Core.validateBank([{question:'Complete the answer.',answer:'school'}]));assert.equal(Core.matchAnswer(question,bank).answers[0],'school');
});

test('an unrecognized native group is still found alongside a recognized question',()=>{
  dom('<fieldset><legend>First question?</legend><label><input type="radio" name="one">Yes</label><label><input type="radio" name="one">No</label></fieldset><article><h3>Second question?</h3><div><label><input type="radio" name="two">Left</label><label><input type="radio" name="two">Right</label></div></article>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,2);assert.deepEqual(report.issues,[]);
});

test('changing blank choices, a candidate bank or question ID invalidates prepared answers',()=>{
  const question={question:'Complete the sentence.',type:'text',options:[],targets:[{kind:'select',key:'first',choices:[{text:'goes',value:'go'}]}],wordBank:['goes'],id:'first'};
  const original=Core.questionSignature([question]);
  for(const change of [{id:'second'},{wordBank:['went']},{targets:[{kind:'select',key:'first',choices:[{text:'went',value:'go'}]}]}])assert.notEqual(Core.questionSignature([{...question,...change}]),original);
});

test('mixed unsupported controls and incomplete blanks produce explicit recognition issues',()=>{
  dom('<div data-ipublish-question-group-type="fill_blanks_group"><div data-question-id="incomplete"><div class="editor-content">Fill <span data-dig-empty-id="1"><input></span> and <span data-dig-empty-id="2"></span>.</div></div></div><div data-ipublish-question-group-type="oral_personal_state_group"><button>开始录音</button></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,0);
  assert.ok(report.issues.some(issue=>/空位|空格/.test(issue)));assert.ok(report.issues.some(issue=>/oral_personal_state_group/.test(issue)));
});

test('recording-only activities are manual while mixed or unrecognized editable questions remain eligible for review',()=>{
  const oral='<div data-ipublish-question-group-type="oral_personal_state_group"><button>开始录音</button></div>';
  dom(oral);let report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.manualOnly,true);assert.equal(report.hasAnswerControls,false);
  dom(oral+'<fieldset><legend>Write your answer.</legend><textarea></textarea></fieldset>');report=collectQuestionsFromDOM({includeDiagnostics:true});
  assert.equal(report.manualOnly,false);assert.equal(report.questions.length,1);
  dom(oral+'<div><input type="text"></div>');report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.manualOnly,false);assert.equal(report.hasAnswerControls,true);
  dom('<div><input type="text"></div>');report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.manualOnly,false);assert.ok(report.issues.some(issue=>issue.includes('可作答控件')));
});

test('mixed native and published text questions are covered once without overlapping layout fallbacks',()=>{
  dom('<div class="layout-container"><fieldset><legend>Complete the first answer.</legend><input></fieldset><div data-ipublish-question-group-type="writing_group"><div data-question-id="essay"><div class="editor-content">Write the full essay.</div><textarea placeholder="Your essay"></textarea></div></div></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,2);
  assert.equal(report.questions.reduce((sum,q)=>sum+q.targets.length,0),2);
});

test('media exercises require a transcript and do not guess from choices alone',()=>{
  dom('<div class="layout-container"><div class="abs-direction">Listen to the conversation and choose the best answer.</div><audio src="test.mp3"></audio>'+choice('Where are the speakers?').replaceAll(' selected','')+'</div>');
  let report=collectQuestionsFromDOM({includeDiagnostics:true});assert.ok(report.issues.some(issue=>/听力|音频|转写/.test(issue)));
  document.querySelector('.layout-container').insertAdjacentHTML('afterbegin','<div class="transcript">They are at school.</div>');
  report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.match(report.questions[0].context,/at school/);
});

test('literal one-letter choices including true false are not mistaken for answer indexes',()=>{
  for(const options of [['T','F'],['a','b'],['I','you']]){
    const result=Core.parseModelAnswer(JSON.stringify({answers:[options[0]]}),{type:'single',options});assert.deepEqual(result.indexes,[0]);
  }
  assert.throws(()=>Core.parseModelAnswer('{"answers":["B"]}',{type:'single',options:['red','blue']}));
  const question={question:'Choose the matching letter.',type:'single',options:['A','B']};
  const index=Core.buildBankIndex(Core.validateBank([{question:question.question,options:['B','A'],answer:'A'}]));
  assert.deepEqual(Core.matchAnswer(question,index).indexes,[1]);
});

test('model responses validate object shape, blank count and dropdown membership before writing',()=>{
  for(const content of ['null','[]','{"answers":["one"]}'])assert.throws(()=>Core.parseModelAnswer(content,{type:'text',options:[],targets:[{},{}]}),/AI.*(?:格式|数量)/);
  const question={type:'text',options:[],targets:[{kind:'select',choices:[{text:'goes',value:'go'}]}]};
  assert.throws(()=>Core.parseModelAnswer('{"answers":["went"]}',question),/选项|匹配/);
});

test('AI request explicitly supplies blank count, dropdown options and word bank',async()=>{
  let request;
  const question={question:'Complete the sentence.',type:'text',options:[],targets:[{},{}],wordBank:['walk','early'],blankOptions:[[],['early','late']]};
  await askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'test'},'test-key',new AbortController().signal,{fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'{"answers":["walk","early"]}'}}]})};}});
  const data=JSON.parse(request.messages[1].content);assert.equal(data.blankCount,2);assert.deepEqual(data.wordBank,question.wordBank);assert.deepEqual(data.blankOptions,question.blankOptions);
});
