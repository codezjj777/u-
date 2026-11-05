import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {readAudioViewFromDOM,isAudioViewEntry,finishAudioView} from '../audio-view.mjs';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {QUESTION_CONTROLS_HANDLER} from '../platform-dom.mjs';
import {audioViewHTML,audioViewTitle} from './fixtures/audio-view.mjs';

const scope={courseId:'audio-book',unitId:'audio-unit',entryKey:JSON.stringify(['audio-unit',['Section 2'],audioViewTitle]),currentEntry:audioViewTitle};
function dom(options){
  const {window,document}=parseHTML(audioViewHTML(options));globalThis.document=document;globalThis.getComputedStyle=el=>({display:el.style.display||'block',visibility:el.closest('[hidden]')?'hidden':'visible',position:el.matches('.progress-slider-thumb')?'absolute':'static',transform:el.matches('.progress-slider-thumb')&&options?.mode==='bounded-thumb'?'none':'matrix(1,0,0,1,-5,0)'});
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')||this.tagName==='AUDIO'?[]:[{}];};
  window.HTMLElement.prototype.getBoundingClientRect=function(){const base={x:0,y:0,left:0,top:0,right:400,bottom:72,width:400,height:72};if(this.matches('.question-audio'))return {...base,width:1100,right:1100};if(this.matches('.ant-slider,.progress-slider'))return {...base,x:105,left:105,right:282,top:28,bottom:40,width:this.closest('.volume')?40:177,height:12};if(this.matches('.ant-slider-handle,.progress-slider-thumb'))return {...base,left:100,right:110,top:29,bottom:39,width:10,height:10};if(this.matches('.audio-play,.btn-play'))return {...base,left:24,right:72,width:48,height:48};return base;};
  Object.assign(document.querySelector('audio'),{duration:79,currentTime:0,paused:true,ended:false,seeking:false,loop:false,readyState:4,playbackRate:1,played:{length:0},seekable:{length:1,start:()=>0,end:()=>79}});return document;
}
test('audio eligibility binds the directory unit and leaves recording tasks to the oral handler',()=>{
  assert.equal(isAudioViewEntry(scope),true);assert.equal(isAudioViewEntry({...scope,unitId:'other'}),false);
  for(const title of ['Oral practice','Speaking','录音','分角色对话'])assert.equal(isAudioViewEntry({...scope,entryKey:JSON.stringify(['audio-unit',[],title])}),false);
});
test('the compact audio player exposes its full slider and hidden native media without leaking signed resource URLs',()=>{
  const doc=dom();doc.querySelector('audio').setAttribute('src','https://example.test/listen?private-token');const state=readAudioViewFromDOM();assert.equal(state.ready,true);assert.equal(state.duration,79);assert.equal(state.currentTime,0);assert.equal(doc.querySelector(state.trackSelector).className,'ant-slider');assert.equal(doc.querySelector(state.playSelector).classList.contains('audio-play'),true);assert.doesNotMatch(JSON.stringify(state),/https:|private-token/);
  doc.querySelector('.volume').innerHTML='<div class="ant-slider"><div class="ant-slider-handle" role="slider" aria-label="Volume"></div></div>';const next=readAudioViewFromDOM();assert.equal(next.ready,true);assert.equal(doc.querySelector(next.trackSelector).closest('.volume'),null);assert.equal(doc.querySelectorAll(next.playerSelector).length,1);
});
test('the platform player binds a sibling control bar instead of filtering its slider against the full-width audio wrapper',()=>{
  const doc=dom({layout:'platform'}),state=readAudioViewFromDOM();assert.equal(state.ready,true,JSON.stringify(state.controlHints));assert.equal(state.controlsReady,true);
  assert.equal(doc.querySelector(state.playerSelector).className,'audio-control audio-control-bar');assert.equal(doc.querySelector(state.playSelector).className,'btn-play');assert.equal(doc.querySelector(state.trackSelector).className,'progress-slider');assert.equal(doc.querySelector(state.thumbSelector).className,'progress-slider-thumb progress-slider-thumb-0');
});

test('answer controls, recording widgets, embedded questions and question directions prevent audio-only handling',()=>{
  for(const markup of ['<textarea></textarea>','<input type="text">','<label><input type="radio">True</label>','<div class="ucomp-recorder"></div>','<div class="popupBox" hidden><input></div>']){
    const doc=dom();doc.querySelector('.audio-box').insertAdjacentHTML('beforeend',markup);const state=readAudioViewFromDOM();assert.equal(state.ready,false,markup);assert.equal(state.requiresReview,true,markup);
  }
  const doc=dom();doc.querySelector('.abs-direction').textContent='Listen and answer the following questions.';assert.equal(readAudioViewFromDOM().requiresReview,true);
});
test('multiple players, video content and unready or looping audio are not accepted as an audio-only completion',()=>{
  let doc=dom();doc.querySelector('main').append(doc.querySelector('.audio-box').cloneNode(true));assert.equal(readAudioViewFromDOM().requiresReview,true);
  doc=dom();doc.querySelector('main').insertAdjacentHTML('beforeend','<video></video>');assert.equal(readAudioViewFromDOM().requiresReview,true);
  for(const change of [{duration:NaN},{loop:true},{error:{code:4}}]){doc=dom();Object.assign(doc.querySelector('audio'),change);assert.equal(readAudioViewFromDOM().ready,false);}
});
test('a different audio resource changes the binding key while stale selector markers are removed',()=>{
  const doc=dom(),before=readAudioViewFromDOM();doc.querySelector('audio').setAttribute('src','other.wav');const after=readAudioViewFromDOM();assert.notEqual(before.sourceKey,after.sourceKey);assert.equal(doc.querySelector(before.playSelector),null);assert.equal(doc.querySelectorAll(after.playSelector).length,1);
});
const state=extra=>({ready:true,binding:'audio',duration:79,currentTime:0,paused:true,ended:false,seeking:false,loop:false,played:[],...extra});
test('audio seeks to the final second before playing and waits for native ended plus a played range',async()=>{
  const current=state(),actions=[];
  const result=await finishAudioView({initial:current,pollMs:1,read:async()=>{if(!current.paused){const start=current.currentTime;current.currentTime=Math.min(79,start+.25);current.played.push([start,current.currentTime]);if(current.currentTime===79){current.ended=true;current.paused=true;}}return {...current};},seek:async(_,target)=>{assert.equal(current.paused,true);actions.push(['seek',target]);current.currentTime=target;},play:async()=>{assert.equal(current.currentTime,78);actions.push(['play']);current.paused=false;}});
  assert.deepEqual(actions,[['seek',78],['play']]);assert.equal(result.seeked,true);assert.equal(current.ended,true);
});

test('native audio EOF with a terminal played range is accepted when its clock is 0.13 seconds short of metadata duration',async()=>{
  const current=state({duration:75.28,currentTime:75.15,ended:true,played:[[74.28,75.15]]});
  const result=await finishAudioView({initial:current,read:async()=>current,play:async()=>assert.fail('an ended audio must not be replayed'),seek:async()=>assert.fail('an ended audio must not be dragged again'),playTimeoutMs:5,pollMs:1});
  assert.equal(result.seeked,false);
});

test('a final-second audio play completes at native EOF even when the declared duration is slightly longer',async()=>{
  const current=state({duration:75.28}),actions=[];
  const result=await finishAudioView({initial:current,read:async()=>{if(!current.paused){const start=current.currentTime;current.currentTime=Math.min(75.15,start+.25);current.played.push([start,current.currentTime]);if(current.currentTime===75.15){current.ended=true;current.paused=true;}}return {...current};},seek:async(_,target)=>{actions.push(['seek',target]);current.currentTime=target;},play:async()=>{actions.push(['play']);current.paused=false;return {clicked:true};},playTimeoutMs:15,endTimeoutMs:15,pollMs:1});
  assert.equal(result.seeked,true);assert.deepEqual(actions,[['seek',74.28],['play']]);assert.equal(current.ended,true);
});

test('a paused audio near the declared end still needs a play and cannot be completed from its progress alone',async()=>{
  const current=state({duration:75.28,currentTime:75.15,played:[[74.28,75.15]]});let clicks=0;
  await assert.rejects(finishAudioView({initial:current,read:async()=>current,play:async()=>{clicks++;return {clicked:true};},seek:async()=>assert.fail('no repeat drag at the tail'),playTimeoutMs:5,endTimeoutMs:5,pollMs:1}),error=>error.code==='AUDIO_VIEW_REVIEW');
  assert.equal(clicks,1);assert.equal(current.ended,false);
});

test('native EOF without a played range reaching the actual endpoint cannot complete the audio',async()=>{
  const current=state({duration:75.28,currentTime:75.15,ended:true,played:[[0,1]]});
  await assert.rejects(finishAudioView({initial:current,read:async()=>current,play:async()=>{},seek:async()=>assert.fail('no repeat drag'),playTimeoutMs:5,pollMs:1}),error=>error.code==='AUDIO_VIEW_REVIEW');
});

for(const repeat of [false,true])test(`an audio paused after final playback ${repeat?'stops after one failed resume':'resumes once without another seek and waits for native EOF'}`,async()=>{
  const current=state(),actions=[],phases=[];let pauses=0;
  const work=finishAudioView({initial:current,pollMs:1,playTimeoutMs:20,endTimeoutMs:30,read:async()=>{if(!current.paused){const start=current.currentTime;current.currentTime=Math.min(79,start+.2);current.played.push([start,current.currentTime]);if(current.currentTime===79){current.ended=true;current.paused=true;}else if(!pauses||repeat){current.paused=true;pauses++;}}return {...current};},seek:async(_,target)=>{actions.push('seek');current.currentTime=target;},play:async()=>{actions.push('play');current.paused=false;return {clicked:true};},onProgress:phase=>phases.push(phase)});
  if(repeat){await assert.rejects(work,/再次在末尾暂停/);assert.equal(current.ended,false);}
  else{assert.equal((await work).seeked,true);assert.equal(current.ended,true);}
  assert.deepEqual(actions,['seek','play','play']);assert.equal(phases.filter(phase=>phase==='resuming-end').length,1);
});

test('stopping at an unexpected tail pause prevents the automatic resume click',async()=>{
  const current=state(),controller=new AbortController(),actions=[];
  await assert.rejects(finishAudioView({initial:current,signal:controller.signal,pollMs:1,read:async()=>{if(!current.paused){const start=current.currentTime;current.currentTime+=.2;current.played.push([start,current.currentTime]);current.paused=true;}return {...current};},seek:async(_,target)=>{actions.push('seek');current.currentTime=target;},play:async()=>{actions.push('play');current.paused=false;},onProgress:phase=>{if(phase==='resuming-end')controller.abort(new Error('stop-tail-resume'));}}),/stop-tail-resume/);
  assert.deepEqual(actions,['seek','play']);assert.equal(current.paused,true);assert.equal(current.ended,false);
});
test('a changed audio, failed drag or stopped task cannot start the audio or claim completion',async()=>{
  let current=state(),reads=0;await assert.rejects(finishAudioView({initial:current,read:async()=>++reads===1?current:{...current,binding:'other'},seek:async()=>assert.fail('stale seek'),play:async()=>assert.fail('stale play'),pollMs:1}),error=>error.code==='AUDIO_VIEW_REVIEW');
  current=state();await assert.rejects(finishAudioView({initial:current,read:async()=>current,seek:async()=>{},play:async()=>assert.fail('failed drag cannot play'),seekTimeoutMs:5,pollMs:1}),/进度条未停/);
  const controller=new AbortController();await assert.rejects(finishAudioView({initial:current,read:async()=>current,seek:async()=>controller.abort(new Error('stop-audio')),play:async()=>assert.fail('stopped play'),signal:controller.signal}),/stop-audio/);
});
test('an ended audio clock with no played range cannot be treated as naturally finished',async()=>{
  const current=state({currentTime:79,ended:true});await assert.rejects(finishAudioView({initial:current,read:async()=>current,play:async()=>{},seek:async()=>assert.fail('no seek'),playTimeoutMs:5,pollMs:1}),/音频未确认开始播放/);
});
test('audio completion polls delayed directory saves without submitting or generating answers',async()=>{
  const engine=new Automation({data:{tasks:[]},changed(){},addLog(){}}),entry={key:scope.entryKey,required:true,completed:false};let reads=0;
  engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.action=engine.askModel=async()=>assert.fail('audio has no answer or submit');engine.refreshTaskDirectory=async()=>({entries:[{...entry,completed:++reads===3}]});
  const outcome=await engine.waitTaskCompletion({status:'running'},{},{},entry,undefined,{audioComplete:true,delayMs:0});assert.equal(outcome.matched.completed,true);assert.equal(reads,3);
});
test('a previously skipped audio page is retried once after the capability upgrade and remains scoped to its directory entry',async t=>{
  const directory=await mkdtemp(path.resolve('.cache/audio-view-memory-')),store=await new Store(directory,{env:{}}).load();t.after(async()=>{await store.flush();await rm(directory,{recursive:true,force:true});});await store.rememberManualEntry(scope,{},'no-fillable-questions','question-controls-v4');
  const engine=new Automation(store),entry={key:scope.entryKey,title:audioViewTitle,path:['Section 2'],required:true,pending:true,completed:false};let opens=0;
  engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>({ready:true,activeUnitId:scope.unitId,entries:[entry]});engine.openRequiredEntry=async()=>{opens++;return {};};engine.answerEntry=async()=>({manual:true,reason:'no-fillable-questions'});engine.pages.release=async()=>({status:'closed'});
  const task=()=>({...scope,id:Math.random().toString(),unitLabel:'Unit 1',status:'running',answered:0,pages:0,logs:[],manualItems:[]});
  await engine.runTask(task(),{},{},new AbortController().signal);assert.equal(opens,1);assert.equal(store.findManualEntry(scope).handler,QUESTION_CONTROLS_HANDLER);await engine.runTask(task(),{},{},new AbortController().signal);assert.equal(opens,1);assert.equal(store.data.bank.length,0);
});
