import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {parseSubtitles,validateMediaURL,downloadMedia,MediaMaterials} from '../media-materials.mjs';
import {LocalSpeech} from '../local-speech.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {questionSignature} from '../shared/core.mjs';
import {videoCorrectionHTML,correctionTranscript} from './fixtures/video-statement-correction.mjs';

const transcript='Anna and Tom will go to the library. It closes at six oclock.';
const vtt='WEBVTT\n\n00:00.000 --> 00:03.000\n<v Anna>We will go to the library.\n\n00:03.000 --> 00:06.000\nIt closes at six oclock.\n';
function dom(html){const {window,document}=parseHTML(`<html><body>${html}</body></html>`);globalThis.document=document;globalThis.location={href:'https://ucontent.unipus.cn/exercise'};globalThis.getComputedStyle=el=>({display:el.style.display||'block',visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}
const exercise=extra=>`<div class="layout-container"><div class="abs-direction">Watch the conversation and decide whether the statements are true or false.</div><video src="https://media.example.test/conversation.mp4?signature=private-token">${extra||''}</video><fieldset><legend>They will go to the library.</legend><label><input type="radio" name="q">True.</label><label><input type="radio" name="q">False.</label></fieldset></div>`;
test('VTT, SRT and TTML captions retain speech and discard timing, markup and notes',()=>{
  assert.match(parseSubtitles(vtt),/Anna: We will go to the library/);
  assert.equal(parseSubtitles('1\n00:00:01,000 --> 00:00:03,000\nThey go to the library.\n'),'They go to the library.');
  assert.equal(parseSubtitles('<tt><body><p begin="1s">They <span>go to the library.</span></p></body></tt>'),'They go to the library.');
  assert.equal(parseSubtitles('WEBVTT\n\nNOTE private comment\nnot a subtitle\n\n00:00.000 --> 00:03.000\nThey go to school.\n\n00:03.000 --> 00:06.000\nThey go to school.'),'They go to school.');
  for(const value of ['<html>Please log in</html>','arbitrary error response','WEBVTT\n\nSTYLE\n::cue {color: red}'])assert.equal(parseSubtitles(value),'');
});
test('media metadata is kept out of answer text and supplied transcripts resolve the missing material issue',()=>{
  dom(exercise('<track kind="subtitles" srclang="en" src="/captions.vtt">'));
  const missing=collectQuestionsFromDOM({includeDiagnostics:true}),record=missing.mediaRequests[0];
  assert.equal(missing.mediaRequests.length,1);assert.match(record.sources[0],/private-token/);assert.match(record.tracks[0].url,/captions.vtt/);
  const ready=collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[record.key]:transcript}});
  assert.deepEqual(ready.issues,[]);assert.equal(ready.mediaRequests.length,0);assert.match(ready.questions[0].context,/closes at six/);
  assert.doesNotMatch(ready.questions[0].context,/private-token|https:/);assert.notEqual(questionSignature(missing.questions),questionSignature(ready.questions));
  document.querySelector('video').setAttribute('src','https://media.example.test/other.mp4');
  assert.equal(collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[record.key]:transcript}}).mediaRequests.length,1);
});

test('five statement-correction fields still require their video or audio when directions only say Read again',()=>{
  for(const kind of ['video','audio']){
    dom(videoCorrectionHTML({kind}));const missing=collectQuestionsFromDOM({includeDiagnostics:true});
    assert.equal(missing.questions.length,5);assert.ok(missing.questions.every(q=>q.type==='text'&&q.targets.length===1));assert.equal(missing.mediaRequests.length,1);assert.equal(missing.mediaRequests[0].kind,kind);assert.ok(missing.issues.length);
    const key=missing.mediaRequests[0].key,ready=collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[key]:correctionTranscript}});
    assert.deepEqual(ready.issues,[]);assert.equal(ready.mediaRequests.length,0);assert.ok(ready.questions.every(q=>q.context.includes(correctionTranscript)&&q.mediaKeys[0]===key));assert.ok(ready.questions.every(q=>!q.context.includes('fixture-private-token')&&!q.context.includes('03:09')));
  }
});

test('switching directions from Watch to Read again reuses the same complete video transcript',()=>{
  dom(videoCorrectionHTML({firstPage:true}));const key=collectQuestionsFromDOM({includeDiagnostics:true}).mediaRequests[0].key;
  document.querySelector('.abs-direction').textContent='Read the following statements again. Correct the false ones.';
  const report=collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[key]:correctionTranscript}});assert.deepEqual(report.issues,[]);assert.equal(report.mediaRequests.length,0);assert.ok(report.questions.every(q=>q.context.includes(correctionTranscript)&&q.mediaKeys[0]===key));
});

test('media detection without listen verbs excludes hidden lessons, notes and word pronunciation',()=>{
  dom('<main class="layout-container"><div class="abs-direction">Explain this expression.</div><fieldset><legend>A written answer.</legend><textarea></textarea></fieldset><div hidden><video src="https://media.example.test/old.mp4"></video></div><aside><video src="https://media.example.test/notes.mp4"></video></aside><div class="word-tips"><audio src="https://media.example.test/word.mp3"></audio></div><div class="pc-slider-content"><audio src="https://media.example.test/sidebar.mp3"></audio></div></main>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,1);assert.deepEqual(report.issues,[]);assert.equal(report.mediaRequests.length,0);
});
test('loaded text track cues are used directly without activating subtitles or changing playback',()=>{
  dom(exercise());const video=document.querySelector('video');Object.defineProperty(video,'textTracks',{value:[{kind:'subtitles',cues:[{text:'They go to the library.'},{text:'It closes at six.'}]}]});
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.deepEqual(report.issues,[]);assert.equal(report.mediaRequests.length,0);assert.match(report.questions[0].context,/closes at six/);
});

test('late player metadata and supplementary audio do not invalidate an unchanged video transcript',()=>{
  dom(exercise());const video=document.querySelector('video');
  const initial=collectQuestionsFromDOM({includeDiagnostics:true}),key=initial.mediaRequests[0].key;
  Object.defineProperty(video,'currentSrc',{value:video.getAttribute('src'),configurable:true});
  video.id='generated-player-id';
  video.before(document.createElement('audio'));
  const ready=collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[key]:transcript}});
  assert.deepEqual(ready.issues,[]);assert.equal(ready.mediaRequests.length,0);assert.equal(ready.questions[0].mediaKeys[0],key);
  video.setAttribute('src','https://media.example.test/second-conversation.mp4');
  assert.equal(collectQuestionsFromDOM({includeDiagnostics:true,mediaTranscripts:{[key]:transcript}}).mediaRequests.length,1);
});

test('changing player clocks and playback menus do not become changing study material',()=>{
  dom(exercise().replace('<video','<div class="layout-material-container"><div class="videoPlayer-shell"><video').replace('</video>','</video><span class="playback-time">00:02 / 01:35</span><span class="speed-menu">倍速</span></div><p>The meeting starts at 6:00.</p></div>'));
  const missing=collectQuestionsFromDOM({includeDiagnostics:true});
  const input={includeDiagnostics:true,mediaTranscripts:{[missing.mediaRequests[0].key]:transcript}};
  const original=collectQuestionsFromDOM(input);
  document.querySelector('.playback-time').textContent='00:12 / 01:35';
  document.querySelector('.speed-menu').textContent='1.5x';
  const updated=collectQuestionsFromDOM(input);
  assert.equal(questionSignature(original.questions),questionSignature(updated.questions));
  assert.doesNotMatch(updated.questions[0].context,/00:12|01:35|倍速|1.5x/);
  assert.match(updated.questions[0].context,/meeting starts at 6:00/);
});

test('authored transcripts inside a player remain available when its controls are excluded',()=>{
  dom(exercise().replace('<video','<div class="layout-material-container"><div class="prism-player"><video').replace('</video>','</video><span>00:02 / 01:35</span><div class="transcript">Anna says the library closes at six.</div></div></div>'));
  const report=collectQuestionsFromDOM({includeDiagnostics:true});
  assert.deepEqual(report.issues,[]);assert.equal(report.mediaRequests.length,0);
  assert.match(report.questions[0].context,/Anna says the library closes at six/);assert.doesNotMatch(report.questions[0].context,/00:02/);
});
test('hidden conversations are not mixed into the selected audio or video material',()=>{
  dom(exercise()+'<div hidden><video src="https://media.example.test/old.mp4"></video></div>');
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.mediaRequests.length,1);assert.doesNotMatch(JSON.stringify(report.mediaRequests),/old.mp4/);
});
test('a video exercise does not transcribe supplementary word pronunciation clips',()=>{
  dom(exercise().replace('</video>','</video><audio src="https://media.example.test/word-pronunciation.mp3"></audio>'));
  const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.mediaRequests.length,1);assert.equal(report.mediaRequests[0].kind,'video');
});
test('subtitle material is preferred over downloading or transcribing the video',async()=>{
  const downloaded=[],resolver=new MediaMaterials('.cache',{download:async(url,options)=>{downloaded.push(url);assert.equal(options.subtitle,true);return Buffer.from(vtt);},speech:{transcribe:async()=>assert.fail('captions do not require speech recognition')}});
  const result=await resolver.resolve({tracks:[{url:'https://media.example.test/english.vtt',language:'en'}],sources:['https://media.example.test/video.mp4']});
  assert.equal(result.source,'音视频字幕');assert.equal(downloaded.length,1);assert.match(result.text,/six oclock/);
});
test('unavailable captions fall back to local transcription with only media bytes',async()=>{
  let calls=0;const bytes=Buffer.from('local media test');
  const resolver=new MediaMaterials('.cache',{download:async(_url,options)=>{if(options.subtitle)throw new Error('not available');return bytes;},speech:{transcribe:async body=>{calls++;assert.equal(body,bytes);return {text:transcript,source:'本地语音转写'};}}});
  assert.equal((await resolver.resolve({tracks:[{url:'https://example.test/subtitles'}],sources:['https://example.test/audio.mp3']})).text,transcript);assert.equal(calls,1);
});
test('cancellation never falls through to another caption or to speech recognition',async()=>{
  const controller=new AbortController();let reads=0;
  const resolver=new MediaMaterials('.cache',{download:async()=>{reads++;controller.abort();throw new Error('cancelled');},speech:{transcribe:async()=>assert.fail('cancelled')}});
  await assert.rejects(resolver.resolve({tracks:[{url:'https://example.test/one'},{url:'https://example.test/two'}],sources:['https://example.test/audio']},{signal:controller.signal}),{name:'AbortError'});assert.equal(reads,1);
});
test('media downloads use cookie context without API credentials and validate redirects',async()=>{
  let calls=0,disposed=0;
  const requestFactory=async options=>{assert.deepEqual(options.storageState.cookies,[{name:'session',value:'local-cookie'}]);return {get:async(url,options)=>{calls++;assert.equal(options.maxRedirects,0);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Referer,'https://ucontent.unipus.cn/');return calls===1?{status:()=>302,headers:()=>({location:'https://cdn.example.test/media.mp4'})}:{status:()=>200,headers:()=>({'content-type':'video/mp4'}),body:async()=>Buffer.from('media')};},dispose:async()=>disposed++};};
  const result=await downloadMedia('https://media.example.test/video.mp4',{context:{cookies:async()=>[{name:'session',value:'local-cookie'}]},referrer:'https://ucontent.unipus.cn/exercise?private=account',requestFactory});
  assert.equal(result.toString(),'media');assert.equal(calls,2);assert.equal(disposed,1);
  for(const url of ['http://media.example.test/video','https://user:secret@example.test/x','https://127.0.0.1/x','https://10.0.0.1/x','file:///private','blob:https://ucontent.unipus.cn/one'])assert.equal(validateMediaURL(url),null);
});
test('login HTML, oversized bodies and partial media are rejected before transcription',async()=>{
  for(const [status,headers,body] of [[200,{'content-type':'text/html'},'login'],[200,{'content-length':'999999999'},'big'],[206,{},'partial'],[200,{},'#EXTM3U\nsecret playlist']]){
    await assert.rejects(downloadMedia('https://media.example.test/video',{context:{cookies:async()=>[]},requestFactory:async()=>({get:async()=>({status:()=>status,headers:()=>headers,body:async()=>Buffer.from(body)}),dispose:async()=>{}})}),/媒体|音视频/);
  }
});
test('a CDN may return HTTP 206 when its content range contains the complete file',async()=>{
  const body=await downloadMedia('https://media.example.test/full.mp4',{context:{cookies:async()=>[]},requestFactory:async()=>({get:async()=>({status:()=>206,headers:()=>({'content-type':'video/mp4','content-range':'bytes 0-4/5'}),body:async()=>Buffer.from('media')}),dispose:async()=>{}})});
  assert.equal(body.toString(),'media');
});
test('a media redirect cannot downgrade to HTTP or use a local address',async()=>{
  for(const location of ['http://media.example.test/video','https://127.0.0.1/private']){
    let calls=0;
    await assert.rejects(downloadMedia('https://media.example.test/video',{context:{cookies:async()=>[]},requestFactory:async()=>({get:async()=>{calls++;return {status:()=>302,headers:()=>({location})};},dispose:async()=>{}})}),/跳转/);assert.equal(calls,1);
  }
});
test('a failed media request never reflects its signed resource URL into a task message',async()=>{
  await assert.rejects(downloadMedia('https://media.example.test/媒体?token=private-token',{context:{cookies:async()=>[]},requestFactory:async()=>({get:async()=>{throw new Error('request failed https://media.example.test/媒体?token=private-token');},dispose:async()=>{}})}),error=>/媒体下载失败/.test(error.message)&&!error.message.includes('private-token'));
});
test('cancelling a media download disposes its isolated request session',async()=>{
  const controller=new AbortController();let disposeCount=0,rejectRequest;
  const result=downloadMedia('https://media.example.test/audio',{signal:controller.signal,context:{cookies:async()=>[]},requestFactory:async()=>({get:async()=>{controller.abort();return new Promise((_resolve,reject)=>{rejectRequest=reject;queueMicrotask(()=>reject(new Error('disposed')));});},dispose:async()=>{disposeCount++;rejectRequest?.(new Error('disposed'));}})});
  await assert.rejects(result,{name:'AbortError'});assert.ok(disposeCount>=1);
});
test('speech caches by content, deletes raw media and keeps URLs and API keys out of the worker',async()=>{
  const root=await mkdtemp(path.resolve('.cache/speech-test-'));let calls=0;
  try{
    const executable=path.join(root,'speech','python',process.platform==='win32'?'Scripts/python.exe':'bin/python');await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'test placeholder');
    const speech=new LocalSpeech(root,{runProcess:async(_command,args,options)=>{calls++;assert.equal(args.includes('https://media.example.test'),false);assert.equal(options.env.USTUDY_API_KEY,undefined);assert.equal((await readFile(args.at(-1))).toString(),'bytes');return JSON.stringify({ok:true,text:transcript,duration:8})+'\n';}});
    assert.equal((await speech.transcribe(Buffer.from('bytes'))).source,'本地语音转写');assert.equal((await speech.transcribe(Buffer.from('bytes'))).source,'本地转写缓存');assert.equal(calls,1);
    assert.deepEqual(await readdir(path.join(root,'speech','tmp')),[]);
    const files=await readdir(path.join(root,'speech','transcripts'));assert.equal(files.length,1);assert.doesNotMatch(await readFile(path.join(root,'speech','transcripts',files[0]),'utf8'),/https:|Cookie|API_KEY/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('speech failure removes downloaded bytes and does not save an empty transcript',async()=>{
  const root=await mkdtemp(path.resolve('.cache/speech-failure-'));
  try{
    const executable=path.join(root,'speech','python',process.platform==='win32'?'Scripts/python.exe':'bin/python');await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'test');
    const speech=new LocalSpeech(root,{runProcess:async()=>{throw Object.assign(new Error('internal path and secret'),{stdout:'{"ok":false,"code":"unclear_audio"}\n'});}});
    await assert.rejects(speech.transcribe(Buffer.from('bytes')),/不清晰/);assert.deepEqual(await readdir(path.join(root,'speech','tmp')),[]);assert.deepEqual(await readdir(path.join(root,'speech','transcripts')),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
