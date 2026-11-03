import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {readPageActivityFromDOM} from '../page-lifecycle.mjs';
import * as Core from '../shared/core.mjs';
import {dropdownHTML,dropdownMarkup,dropdownOptions,dropdownAnswers} from './fixtures/dropdown-exercise.mjs';

function dom(html=dropdownHTML()){
  const {window,document}=parseHTML(/<html/i.test(html)?html:'<html><body>'+html+'</body></html>');globalThis.document=document;
  const hidden=el=>{for(let node=el;node;node=node.parentElement)if(node.matches('[hidden],[aria-hidden=true]')||node.style.display==='none'||node.style.visibility==='hidden')return true;return false;};
  globalThis.getComputedStyle=el=>({display:el.style.display||'block',visibility:hidden(el)?'hidden':'visible'});
  window.HTMLElement.prototype.getClientRects=function(){return hidden(this)?[]:[{}];};return document;
}
test('all four legacy dropdowns retain their full statements and separate candidate lists as one complete exercise',()=>{
  const doc=dom(),report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,1);assert.equal(report.hasAnswerControls,true);assert.equal(report.manualOnly,false);
  const [question]=report.questions;assert.equal(question.type,'text');assert.equal(question.targets.length,4);assert.deepEqual(question.blankOptions,dropdownOptions);assert.match(question.question,/QDC offers.*____ \(1\).*____ \(2\).*____ \(3\).*____ \(4\).*before registration/);assert.doesNotMatch(question.question,/点击选择|styles of dance/);assert.match(question.context,/Offline test material/);
  for(const [i,target] of question.targets.entries()){assert.equal(target.kind,'unipus-select');assert.equal(doc.querySelectorAll(target.selector).length,1);assert.equal(target.key,String(i));}
});
test('draft text, hidden measuring labels and repeated reads never change the authored dropdown identity',()=>{
  const doc=dom(),original=Core.questionSignature(collectQuestionsFromDOM());for(const wrapper of doc.querySelectorAll('.scoop-select-wrapper')){wrapper.querySelector('.user-answer').classList.remove('empty');wrapper.querySelector('.user-answer-text').textContent='A manually chosen answer';}assert.equal(Core.questionSignature(collectQuestionsFromDOM()),original);
  const wrapper=doc.querySelector('.scoop-select-wrapper'),replacement=wrapper.cloneNode(true);replacement.removeAttribute('data-ustudy-control');wrapper.replaceWith(replacement);assert.equal(Core.questionSignature(collectQuestionsFromDOM()),original);
  replacement.querySelector('i').textContent='A different candidate';assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),original);
});
test('missing or duplicate dropdown choices cause review instead of a no-answer classification',()=>{
  for(const mode of ['missing','duplicate','trigger']){const doc=dom(),wrapper=doc.querySelector('.scoop-select-wrapper');if(mode==='missing')wrapper.querySelector('div').remove();if(mode==='duplicate')wrapper.querySelectorAll('i')[1].textContent=wrapper.querySelector('i').textContent;if(mode==='trigger')wrapper.querySelector('.ant-dropdown-trigger').remove();const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.hasAnswerControls,true);assert.equal(report.manualOnly,false);assert.ok(report.issues.some(issue=>/下拉/.test(issue)));}
});
test('unknown custom comboboxes remain answer controls even without a recognized question',()=>{
  for(const control of ['<div role="combobox">点击选择</div>','<span class="digEmptySelectView_selectTrigger_x">Select</span>','<div class="ant-select-selector">Select</div>']){dom('<main class="layout-container">'+control+'</main>');const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.hasAnswerControls,true);assert.equal(report.manualOnly,false);assert.ok(report.issues.length);}
});
test('sidebar dropdowns are excluded and mixed text plus dropdown fields are both retained',()=>{
  dom('<aside>'+dropdownMarkup()+'</aside><main class="layout-container"><div class="question-item">Write <input type="text"></div>'+dropdownMarkup()+'</main>');const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.questions.length,2);assert.equal(report.questions.reduce((n,q)=>n+q.targets.length,0),5);
});
test('video dropdown exercises request their own transcript and never become passive videos',()=>{
  dom(dropdownHTML({embedded:false}));const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.hasAnswerControls,true);assert.equal(report.mediaRequests.length,1);assert.equal(report.questions[0].mediaKeys.length,1);assert.equal(report.mediaIssues.length,1);
});
test('a selected custom dropdown is a protected draft even after a browser restoration',()=>{
  const doc=dom();assert.equal(readPageActivityFromDOM().draft,false);const trigger=doc.querySelector('.user-answer');trigger.classList.remove('empty');trigger.querySelector('.user-answer-text').textContent=dropdownAnswers[0];assert.equal(readPageActivityFromDOM().draft,true);
});
test('the entire four-blank dropdown exercise round-trips through the bank and matches reordered options',()=>{
  dom();const [question]=collectQuestionsFromDOM(),scope={courseId:'dropdown-book',unitId:'dropdown-unit',entryKey:'dropdown-entry'};
  const row={kind:'exercise',version:1,title:'Viewing and understanding / Exercise 2',scope,pages:[{number:1,questions:[{...question,fields:question.targets.map(({kind,key,choices})=>({kind,key,choices})),wordBank:[],answer:dropdownAnswers}]}],verification:{method:'platform-all-correct',total:4,correct:4,unit:'blanks',verifiedAt:1},learnedAt:1};
  const [saved]=Core.validateBank([row]);assert.equal(saved.pages[0].questions[0].fields.length,4);assert.doesNotMatch(JSON.stringify(saved),/data-ustudy|selector/);dom(dropdownHTML({reverse:true}));assert.deepEqual(Core.matchExercisePage(collectQuestionsFromDOM(),scope,Core.buildBankIndex([saved]))[0].answers,dropdownAnswers);
  const invalid=structuredClone(saved);delete invalid.pages[0].questions[0].fields[0].choices;assert.throws(()=>Core.validateBank([invalid]));
});
