import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {VOCABULARY_HANDLER,isVocabularyEntry,readVocabularyFromDOM,advanceVocabularyCards} from '../vocabulary-cards.mjs';
import {vocabularyHTML} from './fixtures/vocabulary-cards.mjs';

function dom(options){const {window,document}=parseHTML(vocabularyHTML(options));globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}
const scope={courseId:'vocabulary-book',unitId:'unit-vocabulary',entryKey:JSON.stringify(['unit-vocabulary',['Active reading','Reading in detail','Vocabulary'],'New words']),currentEntry:'Vocabulary / New words'};
const card=(current=1,total=59)=>({ready:true,binding:'same-entry',current,total,key:String(current),completed:false});
const end=total=>({...card(total,total),completed:true,key:'complete'});

test('vocabulary eligibility uses the complete unit and directory path, including phrases and proper nouns',()=>{
  assert.equal(isVocabularyEntry(scope),true);
  for(const title of ['Phrases','Proper nouns'])assert.equal(isVocabularyEntry({...scope,entryKey:JSON.stringify(['unit-vocabulary',['Reading in detail','Vocabulary'],title])}),true);
  for(const entryKey of ['broken',JSON.stringify(['other-unit',['Vocabulary'],'New words']),JSON.stringify(['unit-vocabulary',['Reading'],'New words']),JSON.stringify(['unit-vocabulary',['Vocabulary'],'Exercise 1'])])assert.equal(isVocabularyEntry({...scope,entryKey}),false);
});
test('the preloaded offscreen completion slide does not complete a vocabulary task at 1/59',()=>{
  dom();const result=readVocabularyFromDOM();assert.equal(result.ready,true);assert.equal(result.current,1);assert.equal(result.total,59);assert.equal(result.completed,false);assert.equal(document.querySelector(result.selector).className,'action next');
});
test('59/59 still requires the final next click, while the active completion slide is recognized separately',()=>{
  dom({initial:58});assert.equal(readVocabularyFromDOM().completed,false);dom({initial:59});const result=readVocabularyFromDOM();assert.equal(result.ready,true);assert.equal(result.completed,true);assert.equal(result.total,59);assert.equal(result.selector,undefined);
});
test('vocabulary recognition rejects mismatched counters, duplicate active cards, answer fields and disabled next controls',()=>{
  for(const change of [doc=>doc.querySelector('.ratio').textContent='2/59',doc=>doc.querySelectorAll('.swiper-vocabulary-slide')[1].classList.add('swiper-slide-active'),doc=>doc.querySelector('main').insertAdjacentHTML('beforeend','<textarea></textarea>'),doc=>doc.querySelector('.action.next').classList.add('disabled')]){const doc=dom();change(doc);assert.equal(readVocabularyFromDOM().ready,false);assert.equal(doc.querySelector('[data-ustudy-vocabulary-next]'),null);}
});
test('generic next buttons and hidden vocabulary groups cannot start the vocabulary handler',()=>{
  const doc=dom();doc.querySelector('.question-vocabulary').setAttribute('hidden','');doc.body.insertAdjacentHTML('beforeend','<div class="ratio">1/59</div><button>下一个</button>');assert.equal(readVocabularyFromDOM(),null);
});
test('exactly 59 normal next actions are needed for 59 cards and the completion page is never clicked again',async()=>{
  let current=card(),clicks=0;const result=await advanceVocabularyCards({initial:current,read:async()=>({...current}),click:async()=>{clicks++;current=current.current===59?end(59):card(current.current+1);},pollMs:1});
  assert.equal(result.moves,59);assert.equal(clicks,59);assert.equal(result.total,59);
  await advanceVocabularyCards({initial:current,read:async()=>current,click:async()=>assert.fail('completed page has no next action')});
});
test('a stalled next action stops after one click instead of guessing completion or clicking forever',async()=>{
  let clicks=0;const current=card();await assert.rejects(advanceVocabularyCards({initial:current,read:async()=>current,click:async()=>{clicks++;},pollMs:2,stepTimeoutMs:15}),/未确认词卡推进/);assert.equal(clicks,1);
});
test('vocabulary progress jumps, total changes and entry changes stop before another action',async()=>{
  for(const change of [()=>card(3),()=>card(2,60),()=>({...card(2),binding:'another-entry'})]){
    let current=card(),clicks=0;await assert.rejects(advanceVocabularyCards({initial:current,read:async()=>current,click:async()=>{clicks++;current=change();},pollMs:1}),error=>error.code==='VOCABULARY_REVIEW');assert.equal(clicks,1);
  }
});
test('pausing a vocabulary checkpoint does not consume the page advancement timeout',async()=>{
  let current=card(1,1),checks=0;
  const result=await advanceVocabularyCards({initial:current,read:async()=>current,click:async()=>{current=end(1);},checkpoint:async()=>{if(++checks===3)await new Promise(resolve=>setTimeout(resolve,40));},stepTimeoutMs:12,pollMs:1});assert.equal(result.moves,1);
});
test('stopping immediately after a vocabulary click prevents any subsequent action',async()=>{
  const controller=new AbortController();let clicks=0;
  await assert.rejects(advanceVocabularyCards({initial:card(),read:async()=>card(),click:async()=>{clicks++;controller.abort(new Error('stop-vocabulary'));},signal:controller.signal}),/stop-vocabulary/);assert.equal(clicks,1);
});
async function fixture(t){const directory=await mkdtemp(path.resolve('.cache/vocabulary-store-')),store=await new Store(directory,{env:{}}).load();t.after(async()=>{await store.flush();await rm(directory,{recursive:true,force:true});});return {store,directory};}
function engineFor(store){
  const engine=new Automation(store),entry={key:scope.entryKey,title:'New words',path:['Active reading','Reading in detail','Vocabulary'],required:true,pending:true,completed:false},directory={ready:true,activeUnitId:scope.unitId,entries:[entry]},page={isClosed:()=>false};
  engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async task=>{task.requiredTotal=1;task.requiredCompleted=entry.completed?1:0;return directory;};engine.openRequiredEntry=async()=>page;engine.pages.release=async()=>({status:'closed'});engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.askModel=engine.fillQuestion=async()=>assert.fail('vocabulary does not generate or fill answers');
  const task=()=>({...scope,id:Math.random().toString(),unitLabel:'Unit 4',status:'running',logs:[],manualItems:[],answered:0,pages:0});return {engine,entry,page,task};
}
test('old manual vocabulary marks are retried once and an unsupported new variant remains remembered after restart',async t=>{
  const {store,directory}=await fixture(t);await store.rememberManualEntry(scope,{});const {engine,task}=engineFor(store);let scans=0;
  engine.answerEntry=async()=>{scans++;return {manual:true,reason:'oral-only'};};await engine.runTask(task(),{}, {},new AbortController().signal);assert.equal(scans,1);assert.equal(store.findManualEntry(scope).handler,VOCABULARY_HANDLER);await store.flush();
  const restored=await new Store(directory,{env:{}}).load(),later=engineFor(restored);later.engine.openRequiredEntry=async()=>assert.fail('newly unsupported variant should remain remembered');await later.engine.runTask(later.task(),{}, {},new AbortController().signal);await restored.flush();
});
test('directory-confirmed vocabulary completion removes only its old manual mark and never creates a question bank row',async t=>{
  const {store}=await fixture(t),other={...scope,entryKey:JSON.stringify(['unit-vocabulary',['Listening'],'Video'])};await store.rememberManualEntry(scope,{});await store.rememberManualEntry(other,{});
  const {engine,entry,task}=engineFor(store);engine.answerEntry=async()=>{entry.completed=true;return {vocabularyDone:true,total:59};};const run=task();await engine.runTask(run,{}, {},new AbortController().signal);
  assert.equal(run.status,'completed');assert.equal(run.answered,0);assert.equal(store.findManualEntry(scope),null);assert.ok(store.findManualEntry(other));assert.equal(store.data.bank.length,0);
});
test('the vocabulary completion page waits for the directory without clicking lesson or submit actions',async()=>{
  const engine=new Automation({data:{tasks:[]},changed(){},addLog(){}}),entry={key:'vocabulary',required:true,completed:false};let refreshes=0;
  engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.action=async()=>assert.fail('no submit or summary navigation for vocabulary');engine.refreshTaskDirectory=async()=>({entries:[{...entry,completed:++refreshes===3}]});
  const result=await engine.waitTaskCompletion({status:'running'},{},{},entry,undefined,{vocabularyComplete:true,delayMs:0});assert.equal(result.matched.completed,true);assert.equal(refreshes,3);
});
test('manual vocabulary handler versions and selective deletion are validated and atomic',async t=>{
  const {store,directory}=await fixture(t);await store.rememberManualEntry(scope,{},'no-fillable-questions',VOCABULARY_HANDLER);await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.equal(restored.findManualEntry(scope).handler,VOCABULARY_HANDLER);await restored.flush();
  await assert.rejects(store.rememberManualEntry({...scope,entryKey:'another'}, {},'no-fillable-questions','unknown-handler'),/处理器/);
  const persist=store.persist.bind(store);store.persist=async()=>{throw new Error('fixture disk failure');};await assert.rejects(store.forgetManualEntry(scope));assert.ok(store.findManualEntry(scope));store.persist=persist;
});
