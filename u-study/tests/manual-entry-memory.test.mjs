import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {createApp} from '../server.mjs';
import {accessToken,accessHeaders} from './fixtures/local-access.mjs';

const scope={courseId:'book-one',unitId:'unit-one',entryKey:JSON.stringify(['unit-one',['Reading in detail','Vocabulary'],'Phrases']),currentEntry:'Reading in detail / Vocabulary / Phrases'};
async function fixture(t){
  const directory=await mkdtemp(path.resolve('.cache/manual-entry-memory-'));
  const store=await new Store(directory,{env:{}}).load();
  t.after(async()=>{await store.flush();await rm(directory,{recursive:true,force:true});});
  return {store,directory};
}
function engineFor(store){
  const engine=new Automation(store),entry={key:scope.entryKey,title:'Phrases',path:['Reading in detail','Vocabulary'],required:true,pending:true,completed:false};
  const directory={ready:true,activeUnitId:scope.unitId,entries:[entry]},page={url:()=> 'https://ucontent.unipus.cn/exercise',isClosed:()=>false,reload:async()=>{}};
  engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>directory;engine.openRequiredEntry=async()=>page;engine.pages.release=async()=>({status:'closed'});
  return {engine,page,directory};
}
const task=()=>({...scope,id:Math.random().toString(36),unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]});

test('a confirmed manual leaf is remembered and later skipped without opening, scanning or asking AI, including after restart',async t=>{
  const {store,directory}=await fixture(t),{engine}=engineFor(store);let scans=0;
  engine.answerEntry=async()=>{scans++;return {manual:true,reason:'no-fillable-questions'};};
  const first=task();await engine.runTask(first,{}, {},new AbortController().signal);
  assert.equal(scans,1);assert.equal(store.data.manualEntryMarks.length,1);assert.equal(first.status,'partial');assert.equal(first.requiredCompleted,0);
  assert.ok(first.logs.some(log=>log.message.includes('已标记待手动处理')));
  const nextStore=await new Store(directory,{env:{}}).load(),{engine:next}=engineFor(nextStore);
  next.openRequiredEntry=next.answerEntry=next.askModel=async()=>assert.fail('remembered content must be skipped from the directory');
  const later=task();await next.runTask(later,{}, {},new AbortController().signal);
  assert.equal(later.status,'partial');assert.equal(later.requiredCompleted,0);assert.deepEqual(later.manualItems,[scope.currentEntry]);
  assert.ok(later.logs.some(log=>log.message.includes('已跳过已标记手动项目')));await nextStore.flush();
});

test('manual memory matches the full course, unit, directory entry and question-selector configuration',async t=>{
  const {store}=await fixture(t);await store.rememberManualEntry(scope,{});await store.rememberManualEntry(scope,{});
  assert.equal(store.data.manualEntryMarks.length,1);assert.ok(store.findManualEntry(scope,{}));
  for(const different of [{courseId:'another-book'},{unitId:'another-unit'},{entryKey:JSON.stringify(['unit-one',['Another chapter'],'Phrases'])}])assert.equal(store.findManualEntry({...scope,...different},{}),null);
  assert.equal(store.findManualEntry(scope,{questionSelector:'.new-question'}),null);
  assert.equal(store.publicState().manualEntryCount,1);assert.equal(store.publicState().manualEntryMarks,undefined);
});

test('oral-only pages are remembered but material, loading and missing-answer failures are not',async t=>{
  const {store}=await fixture(t),{engine}=engineFor(store);
  engine.waitQuestions=async()=>({manualOnly:true,questions:[],issues:['oral activity']});
  engine.askModel=async()=>assert.fail('oral recording does not use the text-answer API');
  await engine.runTask(task(),{}, {},new AbortController().signal);
  assert.equal(store.data.manualEntryMarks[0].reason,'oral-only');await store.clearManualEntries();
  for(const message of ['网络异常','页面一直停在「加载中」','题库未匹配到答案','题目或阅读材料发生变化']){
    engine.answerEntry=async()=>{throw new Error(message);};
    await assert.rejects(engine.runTask(task(),{}, {},new AbortController().signal),new RegExp(message));
    assert.equal(store.data.manualEntryMarks.length,0);
  }
});

test('a leaf containing answered pages is not remembered as an entirely manual leaf',async t=>{
  const {store}=await fixture(t),{engine}=engineFor(store);
  engine.answerEntry=async()=>({manual:true,rememberable:false});
  await engine.runTask(task(),{}, {},new AbortController().signal);assert.equal(store.data.manualEntryMarks.length,0);
  const previous={signature:'first',pageURL:'https://ucontent.unipus.cn/exercise',navigation:{known:true,key:'same-leaf',title:'Phrases'}},next={...previous,signature:'second'};
  let calls=0;engine.answerEntryAttempt=async()=>++calls===1?{nextPage:true,snapshot:previous,signature:'first'}:{manual:true};
  engine.waitNextExercisePage=async()=>({snapshot:next});
  const result=await Automation.prototype.answerEntry.call(engine,task(),{}, {},new AbortController().signal);
  assert.equal(result.manual,true);assert.equal(result.rememberable,false);
});

test('clearing manual memory survives restart and makes the next run scan the entry again',async t=>{
  const {store,directory}=await fixture(t);await store.rememberManualEntry(scope,{});
  assert.deepEqual(await store.clearManualEntries(),{cleared:1,manualEntryCount:0});
  const reloaded=await new Store(directory,{env:{}}).load(),{engine}=engineFor(reloaded);let scans=0;
  engine.answerEntry=async()=>{scans++;return {manual:true};};await engine.runTask(task(),{}, {},new AbortController().signal);
  assert.equal(scans,1);assert.equal(reloaded.data.manualEntryMarks.length,1);await reloaded.flush();
});

test('older saved states acquire empty manual memory without losing courses or configuration',async t=>{
  const {store,directory}=await fixture(t);await store.flush();
  const file=path.join(directory,'state.json'),saved=JSON.parse(await readFile(file,'utf8'));delete saved.manualEntryMarks;saved.settings.autoSubmit=true;
  await writeFile(file,JSON.stringify(saved));const reloaded=await new Store(directory,{env:{}}).load();
  assert.deepEqual(reloaded.data.manualEntryMarks,[]);assert.equal(reloaded.data.settings.autoSubmit,true);
});

test('a failed disk write does not pretend that a manual mark was saved',async t=>{
  const {store}=await fixture(t),persist=store.persist.bind(store);store.persist=async()=>{throw new Error('disk failure');};
  await assert.rejects(store.rememberManualEntry(scope,{}),error=>error.status===507);
  assert.equal(store.data.manualEntryMarks.length,0);store.persist=persist;
});

test('clearing manual memory keeps local-origin protection and rejects active task and sync races',async t=>{
  const {store}=await fixture(t),{engine}=engineFor(store);await store.rememberManualEntry(scope,{});
  const server=createApp({store,automation:engine,port:0,accessToken});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.shutdown());
  const base=`http://127.0.0.1:${server.address().port}`,send=(origin=base)=>fetch(base+'/api/manual-entries/clear',{method:'POST',headers:{...accessHeaders,'Content-Type':'application/json','X-UStudy':'1',Origin:origin},body:'{}'});
  assert.equal((await send('https://foreign.example.test')).status,403);
  store.data.tasks=[task()];assert.equal((await send()).status,409);store.data.tasks=[];
  store.syncing=true;assert.equal((await send()).status,409);store.syncing=false;
  assert.equal(store.data.manualEntryMarks.length,1);
  const result=await send();assert.equal(result.status,200);assert.deepEqual(await result.json(),{cleared:1,manualEntryCount:0});
});
