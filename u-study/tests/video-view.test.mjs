import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {readVideoViewFromDOM,finishVideoView,dragVideoProgress,isVideoViewEntry} from '../video-view.mjs';
import {QUESTION_CONTROLS_HANDLER} from '../platform-dom.mjs';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {videoViewHTML,videoViewTitle} from './fixtures/video-view.mjs';

const scope={courseId:'video-book',unitId:'video-unit',entryKey:JSON.stringify(['video-unit',['Active reading','Analyzing writing techniques',videoViewTitle],videoViewTitle]),currentEntry:videoViewTitle};
function dom(){
  const {window,document}=parseHTML(videoViewHTML());globalThis.document=document;globalThis.getComputedStyle=el=>({display:el.style.display||'block',visibility:el.closest('[hidden]')?'hidden':'visible'});
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};window.HTMLElement.prototype.getBoundingClientRect=function(){const base={x:0,y:0,left:0,top:0,right:640,bottom:360,width:640,height:360};return this.matches('.vjs-progress-holder,.ant-slider,.rc-slider')?{...base,y:355,top:355,bottom:361,height:6,width:this.closest('.volume')?80:640}:this.matches('[role=slider],.vjs-slider-handle')?{...base,y:353,top:353,bottom:363,width:10,height:10}:this.matches('button,.iconbtn')?{...base,y:365,top:365,bottom:390,width:50,height:25}:base;};
  Object.assign(document.querySelector('video'),{duration:259,currentTime:0,paused:true,ended:false,seeking:false,loop:false,readyState:4,playbackRate:1,played:{length:0},seekable:{length:1,start:()=>0,end:()=>259}});return document;
}
test('passive video eligibility binds its unit and excludes exercise and oral task titles',()=>{
  assert.equal(isVideoViewEntry(scope),true);for(const title of ['Exercise 1','Quiz','Oral practice','口语练习'])assert.equal(isVideoViewEntry({...scope,entryKey:JSON.stringify(['video-unit',['Listening'],title])}),false);assert.equal(isVideoViewEntry({...scope,unitId:'another'}),false);
});
test('video reader identifies one scoped play button and progress bar without exposing resource addresses',()=>{
  const doc=dom();doc.querySelector('video').setAttribute('src','https://media.example.test/clip?private-signed-token');const result=readVideoViewFromDOM();assert.equal(result.ready,true);assert.equal(result.duration,259);assert.equal(result.currentTime,0);assert.equal(result.controlsReady,true);assert.equal(doc.querySelector(result.trackSelector).className,'vjs-progress-holder');assert.doesNotMatch(JSON.stringify(result),/https:|private-signed-token/);
});
test('outer Unipus controls remain usable around a hidden Video.js toolbar and an empty point-read wrapper',()=>{
  const doc=dom(),root=doc.querySelector('.video-box'),video=root.querySelector('video'),vjs=doc.createElement('div'),outer=doc.createElement('div');root.classList.remove('video-js');vjs.className='video-js vjs-controls-disabled';outer.className='question-video-point-read';root.replaceWith(outer);outer.append(root);video.replaceWith(vjs);vjs.append(video);vjs.insertAdjacentHTML('beforeend','<div hidden><button class="vjs-play-control">Hidden play</button><div class="vjs-progress-holder"></div></div>');
  const result=readVideoViewFromDOM();assert.equal(result.ready,true);assert.equal(result.requiresReview,false);assert.equal(result.controlHints.embeddedQuestion,false);assert.equal(doc.querySelector(result.playSelector).closest('.video-js'),null);assert.equal(doc.querySelector(result.playerSelector),root);
  const previous=doc.createElement('div');previous.setAttribute('data-ustudy-video-player','stale');doc.querySelector('main').append(previous);assert.equal(readVideoViewFromDOM().playerSelector,result.playerSelector);assert.equal(previous.hasAttribute('data-ustudy-video-player'),false);assert.equal(doc.querySelectorAll(result.playerSelector).length,1);
});
test('Ant sliders use their full progress rail rather than the tiny handle or a nearby volume slider',()=>{
  const doc=dom(),root=doc.querySelector('.video-box'),track=doc.querySelector('.vjs-progress-holder'),thumb=doc.querySelector('.vjs-slider-handle');track.className='ant-slider';track.removeAttribute('role');track.removeAttribute('aria-label');thumb.className='ant-slider-handle';thumb.setAttribute('role','slider');thumb.setAttribute('aria-label','视频进度');root.insertAdjacentHTML('beforeend','<div class="volume"><div class="ant-slider"><div class="ant-slider-handle" role="slider"></div></div></div>');const result=readVideoViewFromDOM();assert.equal(result.ready,true);assert.equal(doc.querySelector(result.trackSelector),track);assert.equal(doc.querySelector(result.thumbSelector),thumb);
});
test('visible answer controls and hidden embedded questions block passive handling, including questions inside the player',()=>{
  for(const html of ['<textarea></textarea>','<label><input type="radio">True</label>','<div class="popupBox" hidden><div class="option">A</div></div>']){const doc=dom();doc.querySelector('.video-box').insertAdjacentHTML('beforeend',html);const result=readVideoViewFromDOM();assert.equal(result.ready,false);assert.equal(result.requiresReview,true);}
  const doc=dom();doc.querySelector('.abs-direction').textContent='Watch and answer the following questions.';assert.equal(readVideoViewFromDOM().requiresReview,true);
});
test('multiple videos, unready metadata and looping playback cannot be counted as a finished passive video',()=>{
  let doc=dom();doc.querySelector('main').append(doc.querySelector('video').cloneNode(true));assert.equal(readVideoViewFromDOM().ready,false);
  doc=dom();doc.querySelector('video').duration=NaN;assert.equal(readVideoViewFromDOM().ready,false);doc=dom();doc.querySelector('video').loop=true;assert.equal(readVideoViewFromDOM().ready,false);
});
test('a changed media source changes the public video identity',()=>{const doc=dom(),first=readVideoViewFromDOM();doc.querySelector('video').setAttribute('src','another.webm');assert.notEqual(readVideoViewFromDOM().sourceKey,first.sourceKey);});
const state=(extra={})=>({ready:true,binding:'same-video',duration:259,currentTime:0,paused:true,ended:false,seeking:false,loop:false,played:[],...extra});
function player(){
  let current=state(),plays=0,seeks=[];
  return {get current(){return current;},get plays(){return plays;},seeks,
    read:async()=>{if(!current.paused&&!current.ended){const start=current.currentTime;current.currentTime=Math.min(current.duration,current.currentTime+.25);current.played.push([start,current.currentTime]);if(current.currentTime===current.duration){current.ended=true;current.paused=true;}}return {...current,played:[...current.played]};},
    play:async()=>{plays++;current.paused=false;},seek:async(_,target)=>{seeks.push(target);current.currentTime=target;},set:value=>{current=value;}};
}
test('a paused video is sought to duration minus one before play, then requires real ended and played-to-end observations',async()=>{
  const p=player(),phases=[],actions=[];const result=await finishVideoView({initial:p.current,read:p.read,play:async()=>{actions.push('play');assert.equal(p.current.currentTime,258);await p.play();},seek:async(...args)=>{actions.push('seek');assert.equal(p.current.paused,true);assert.equal(p.plays,0);await p.seek(...args);},pollMs:1,onProgress:phase=>phases.push(phase)});assert.equal(result.duration,259);assert.deepEqual(actions,['seek','play']);assert.deepEqual(p.seeks,[258]);assert.equal(p.plays,1);assert.equal(p.current.ended,true);assert.deepEqual(phases,['seeking','seeked','playing','waiting-end','ended']);
});
test('a paused player after seeking is resumed through its normal play callback',async()=>{
  const p=player();const seek=async(...args)=>{await p.seek(...args);p.current.paused=true;};await finishVideoView({initial:p.current,read:p.read,play:p.play,seek,pollMs:1});assert.equal(p.plays,1);assert.equal(p.current.ended,true);
});
test('near-end clocks and ended flags without played ranges do not prove completion',async()=>{
  const current=state({currentTime:259,ended:true,played:[]});await assert.rejects(finishVideoView({initial:current,read:async()=>current,play:async()=>{},seek:async()=>assert.fail('no seek'),playTimeoutMs:8,pollMs:1}),/未确认开始播放/);
});
test('failed playback and failed seeking stop without repeat play or repeat drag loops',async()=>{
  let plays=0,seeks=0;const current=state();await assert.rejects(finishVideoView({initial:current,read:async()=>current,play:async()=>{plays++;},seek:async(_,target)=>{seeks++;current.currentTime=target;},playTimeoutMs:8,pollMs:1}),/未确认开始播放/);assert.equal(plays,1);assert.equal(seeks,1);
  const p=player();await assert.rejects(finishVideoView({initial:p.current,read:p.read,play:async()=>assert.fail('cannot play after a failed seek'),seek:async()=>{},seekTimeoutMs:8,pollMs:1}),/进度条未停/);
});
test('a different video or new question before seeking prevents all player actions',async()=>{
  for(const change of [()=>state({binding:'other'}),()=>state({requiresReview:true,issue:'popup question'})]){const initial=state();let reads=0;await assert.rejects(finishVideoView({initial,read:async()=>++reads===1?initial:change(),play:async()=>assert.fail('stale play'),seek:async()=>assert.fail('stale seek'),pollMs:1}),error=>error.code==='VIDEO_VIEW_REVIEW');}
});
test('a different video or new question after play stops without a second drag',async()=>{
  for(const change of [()=>state({binding:'other'}),()=>state({requiresReview:true,issue:'popup question'})]){let current=state(),seeks=0;await assert.rejects(finishVideoView({initial:current,read:async()=>current,play:async()=>{current=change();},seek:async(_,target)=>{seeks++;current.currentTime=target;},pollMs:1}),error=>error.code==='VIDEO_VIEW_REVIEW');assert.equal(seeks,1);}
});
test('stopping after seeking prevents play, and stopping after play never repeats the drag',async()=>{
  for(const stage of ['seek','play']){const controller=new AbortController(),current=state();let seeks=0,plays=0;await assert.rejects(finishVideoView({initial:current,read:async()=>current,play:async()=>{plays++;controller.abort(new Error('stop-video'));},seek:async(_,target)=>{seeks++;current.currentTime=target;if(stage==='seek')controller.abort(new Error('stop-video'));},signal:controller.signal}),/stop-video/);assert.equal(seeks,1);assert.equal(plays,stage==='play'?1:0);}
});
test('an already-playing video is paused before seeking and restarted only after its landing is confirmed',async()=>{
  const p=player(),actions=[];p.set(state({paused:false}));await finishVideoView({initial:p.current,read:p.read,pause:async()=>{actions.push('pause');p.current.paused=true;},seek:async(...args)=>{assert.equal(p.current.paused,true);actions.push('seek');await p.seek(...args);},play:async()=>{actions.push('play');await p.play();},pollMs:1});assert.deepEqual(actions,['pause','seek','play']);assert.equal(p.current.ended,true);
});
test('the paused player waits for a seekable range before dragging and never plays if buffering remains unavailable',async()=>{
  const p=player();let reads=0;p.current.seekable=[];await finishVideoView({initial:p.current,read:async()=>{if(++reads===3)p.current.seekable=[[0,259]];return p.read();},play:p.play,seek:async(...args)=>{assert.equal(p.current.paused,true);assert.deepEqual(p.current.seekable,[[0,259]]);await p.seek(...args);},pollMs:1});assert.equal(p.current.ended,true);
  const current=state({seekable:[[0,2]]});await assert.rejects(finishVideoView({initial:current,read:async()=>current,play:async()=>assert.fail('no play before seekable'),seek:async()=>assert.fail('no drag outside seekable'),seekTimeoutMs:8,pollMs:1}),/不支持拖动/);
});
test('a subsecond video plays naturally without a negative seek target',async()=>{
  const p=player();p.set(state({duration:.8}));const result=await finishVideoView({initial:p.current,read:p.read,play:p.play,seek:async()=>assert.fail('no seek for a subsecond clip'),pollMs:1});assert.equal(result.seeked,false);assert.equal(p.current.ended,true);assert.equal(p.plays,1);
});
test('mouse seeking uses the observed frame coordinates and always releases a held pointer on cancellation',async()=>{
  for(const cancel of [false,true]){
    const controller=new AbortController(),events=[];let moves=0;
    const page={mouse:{move:async(x,y)=>{events.push(['move',x,y]);if(++moves===2&&cancel)controller.abort(new Error('stop-drag'));},down:async()=>events.push(['down']),up:async()=>events.push(['up'])}},frame={locator:()=>({scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:123,y:250,width:800,height:6})})},record={trackSelector:'#track',duration:259,currentTime:0};
    const work=dragVideoProgress(page,frame,record,258,{signal:controller.signal});if(cancel)await assert.rejects(work,/stop-drag/);else await work;assert.equal(events.at(-1)[0],'up');assert.equal(events.filter(event=>event[0]==='down').length,1);assert.ok(Math.abs(events.filter(event=>event[0]==='move')[1][1]-(123+800*258/259))<.001);
  }
});
test('an unsupported seek range cannot start a progress-bar gesture',async()=>{
  await assert.rejects(dragVideoProgress({mouse:{down:async()=>assert.fail('cannot seek outside the native range')}},{locator:()=>assert.fail('no drag locator needed')},{duration:259,seekable:[[0,2]]},258),/不支持定位/);
});
test('directory polling after native video end still requires the matching required entry to be completed',async()=>{
  const engine=new Automation({data:{tasks:[]},changed(){},addLog(){}}),entry={key:'video',required:true,completed:false};let calls=0;
  engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.action=async()=>assert.fail('passive videos have no submit action');engine.refreshTaskDirectory=async()=>({entries:[{...entry,completed:++calls===3}]});
  const result=await engine.waitTaskCompletion({status:'running'},{},{},entry,undefined,{videoComplete:true,delayMs:0});assert.equal(calls,3);assert.equal(result.matched.completed,true);
});
test('legacy no-answer marks upgrade once for the video capability while oral and other marks remain scoped',async t=>{
  const directory=await mkdtemp(path.resolve('.cache/video-view-store-')),store=await new Store(directory,{env:{}}).load();t.after(async()=>{await store.flush();await rm(directory,{recursive:true,force:true});});await store.rememberManualEntry(scope,{});
  const engine=new Automation(store),entry={key:scope.entryKey,title:videoViewTitle,path:['Writing'],required:true,pending:true,completed:false},catalog={ready:true,activeUnitId:scope.unitId,entries:[entry]};let opens=0;
  engine.courseDirectory=async()=>({page:{}});engine.refreshTaskDirectory=async()=>catalog;engine.openRequiredEntry=async()=>{opens++;return {};};engine.answerEntry=async()=>({manual:true,reason:'no-fillable-questions'});engine.pages.release=async()=>({status:'closed'});
  const task=()=>({...scope,id:Math.random().toString(),status:'running',unitLabel:'Unit 4',logs:[],manualItems:[],answered:0,pages:0});await engine.runTask(task(),{}, {},new AbortController().signal);assert.equal(opens,1);assert.equal(store.findManualEntry(scope).handler,QUESTION_CONTROLS_HANDLER);await engine.runTask(task(),{}, {},new AbortController().signal);assert.equal(opens,1);assert.equal(store.data.bank.length,0);
});
