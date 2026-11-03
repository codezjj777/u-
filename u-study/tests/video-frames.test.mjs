import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {VideoFrames} from '../video-frames.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {pictureBytes,pictureSources} from './fixtures/picture-exercise.mjs';
import {observationHTML,observationTranscript} from './fixtures/video-observation.mjs';
function dom(options={}){const {window,document}=parseHTML(observationHTML(options));globalThis.document=document;globalThis.getComputedStyle=()=>({visibility:'visible'});window.HTMLElement.prototype.getClientRects=function(){return [{}];};return document;}
test('eye-contact questions require video frames even when the complete transcript is supplied',()=>{
  dom({transcript:true});const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.questions.length,2);assert.equal(report.mediaRequests.length,0);assert.equal(report.videoRequests.length,1);assert.ok(report.mediaIssues.some(v=>v.includes('视频画面')));assert.ok(report.questions[0].context.includes(observationTranscript));
  dom({transcript:true,visual:false});assert.equal(collectQuestionsFromDOM({includeDiagnostics:true}).videoRequests.length,0);
});
test('sample frames enter existing image handling while a changed video cannot reuse their visual material',()=>{
  const document=dom({transcript:true}),before=collectQuestionsFromDOM({includeDiagnostics:true}),record=before.videoRequests[0];
  document.querySelector('.layout-material-container').insertAdjacentHTML('beforeend','<section data-ustudy-video-frames="'+record.key+'"><figure><figcaption>Video frame 1/1 @ 00:01.00</figcaption><img src="'+pictureSources[0]+'"></figure></section>');
  const ready=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(ready.videoRequests.length,0);assert.equal(ready.imageRequests.length,1);assert.ok(ready.questions.every(q=>q.images.length===1));assert.equal(ready.questions[0].context,before.questions[0].context);assert.ok(!ready.questions[0].context.includes('data:image'));
  document.querySelector('video').setAttribute('src','https://ucontent.unipus.cn/changed.mp4');const changed=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(changed.videoRequests.length,1);assert.equal(changed.imageRecords.length,0);
});
test('video frame extraction validates and reuses content caches and re-decodes a corrupt cached image',async()=>{
  const root=await mkdtemp(path.resolve('.cache/video-frames-unit-'));let runs=0;
  try{
    const executable=path.join(root,'speech','python',process.platform==='win32'?'Scripts/python.exe':'bin/python');await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'fixture');
    const reader=new VideoFrames(root,{download:async()=>Buffer.from('fixture media'),runProcess:async(_command,args)=>{runs++;const output=args[args.indexOf('--output')+1],count=Number(args[args.indexOf('--count')+1]);const frames=[];for(let i=0;i<count;i++){const file=`frame-${String(i).padStart(2,'0')}.png`;await writeFile(path.join(output,file),pictureBytes(i+1));frames.push({file,time:i*10});}return JSON.stringify({ok:true,duration:80,frames});}}),record={kind:'video',sources:['https://ucontent.unipus.cn/fixture.mp4']};
    const first=await reader.resolve(record,{count:3}),second=await reader.resolve(record,{count:3});assert.deepEqual(second,first);assert.equal(runs,1);assert.ok(first.every(f=>f.label.includes('Video frame')&&f.dataURL.startsWith('data:image/png;')));
    const files=await readdir(reader.directory);assert.ok(!files.some(f=>f.startsWith('tmp-')));const cache=path.join(reader.directory,files.find(f=>f.endsWith('.json'))),data=JSON.parse(await readFile(cache,'utf8'));data.frames[0].dataURL='data:image/png;base64,AAAA';await writeFile(cache,JSON.stringify(data));await reader.resolve(record,{count:3});assert.equal(runs,2);
    await assert.rejects(reader.resolve({...record,kind:'audio'}),/视频画面/);
    await assert.rejects(reader.resolve(record,{checkpoint:async()=>{throw Object.assign(new Error('changed media'),{code:'MEDIA_SNAPSHOT_CHANGED'});}}),/changed media/);
  }finally{await rm(root,{recursive:true,force:true});}
});
