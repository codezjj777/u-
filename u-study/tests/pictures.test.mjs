import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {imageAsset,verifyBankImages,ImageMaterials} from '../image-materials.mjs';
import {askModel} from '../answer-provider.mjs';
import {Store} from '../store.mjs';
import * as Core from '../shared/core.mjs';
import {pictureBytes,pictureSources,pictureLabels,pictureAnswers,pictureExerciseHTML} from './fixtures/picture-exercise.mjs';

const assets=[1,2,3].map(seed=>imageAsset(pictureBytes(seed),{width:96,height:64})),pictures=assets.map((asset,index)=>({...asset,label:pictureLabels[index]}));
const settings={endpoint:'https://ai.example.test/v1/chat/completions',model:'vision-fixture'};
function dom(){const {window,document}=parseHTML(pictureExerciseHTML());globalThis.document=document;globalThis.getComputedStyle=el=>({display:'block',visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}
function bank(){return {kind:'exercise',version:1,title:'Active reading / Before you read',scope:{courseId:'pictures',unitId:'one',entryKey:'before'},pages:[{number:1,questions:pictureAnswers.map((answer,index)=>({question:'Picture question '+index,type:'text',options:[],context:'Look at the photos and title.',wordBank:[],blankOptions:[[]],fields:[{kind:'text'}],answer:[answer],images:pictures.map(({digest,label})=>({digest,label}))}))}],imageAssets:assets,verification:{method:'platform-all-correct',total:3,correct:3,unit:'questions',verifiedAt:1},learnedAt:1};}
const live=row=>row.pages[0].questions.map(({fields,...q})=>({...q,targets:fields,images:q.images.map(ref=>({...row.imageAssets.find(asset=>asset.digest===ref.digest),label:ref.label}))}));

test('look-at-photos recognizes all three pictures and labels for every answer without copying resource URLs into text',()=>{
  dom();const missing=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(missing.questions.length,3);assert.equal(missing.imageRequests.length,3);assert.deepEqual(missing.imageRequests.map(ref=>ref.label),pictureLabels);assert.ok(missing.issues.length);assert.equal(missing.manualOnly,false);assert.ok(missing.questions.every(q=>q.images.length===3&&!q.context.includes('data:image')));
  const ready=collectQuestionsFromDOM({includeDiagnostics:true,imageDigests:Object.fromEntries(missing.imageRequests.map((ref,index)=>[ref.key,assets[index].digest]))});assert.deepEqual(ready.issues,[]);assert.equal(ready.imageRequests.length,0);
});

test('picture collection excludes notes, hidden material, avatars and images inside answer editors',()=>{
  const doc=dom();doc.querySelector('main').insertAdjacentHTML('beforeend','<aside><img src="notes.png"></aside><div hidden><img src="old.png"></div><img class="avatar" src="avatar.png"><div contenteditable="true"><img src="answer.png"></div>');const report=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(report.imageRequests.length,3);
});

test('picture content signatures change for changed pictures or labels but remain stable when a typed answer changes',()=>{
  dom();const before=Core.questionSignature(collectQuestionsFromDOM());document.querySelector('textarea').value='A complete answer.';assert.equal(Core.questionSignature(collectQuestionsFromDOM()),before);document.querySelector('figcaption').textContent='Photo B';assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),before);dom();document.querySelector('img').setAttribute('src',pictureSources[2]);assert.notEqual(Core.questionSignature(collectQuestionsFromDOM()),before);
});

test('late header images do not change authored material identities or image locators',()=>{
  dom();const before=collectQuestionsFromDOM({includeDiagnostics:true}),signature=Core.questionSignature(before.questions);
  document.querySelector('header').insertAdjacentHTML('afterbegin',`<img alt="A late cover" src="${pictureSources[2]}">`);
  const after=collectQuestionsFromDOM({includeDiagnostics:true});assert.equal(Core.questionSignature(after.questions),signature);assert.deepEqual(after.imageRecords.map(image=>image.selector),before.imageRecords.map(image=>image.selector));
});

test('vision requests send real image blocks with labels and preserve ordinary text-only payloads',async()=>{
  let request;const result=await askModel({question:'Describe the photos.',type:'text',options:[],targets:[{}],images:pictures},settings,'fixture-key',undefined,{fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'{"answers":["A sample description."]}'}}]}));}});
  const content=request.messages[1].content;assert.equal(content.length,4);assert.deepEqual(JSON.parse(content[0].text).images.map(image=>image.label),pictureLabels);assert.deepEqual(content.slice(1).map(image=>image.image_url.url),pictureSources);assert.ok(content.slice(1).every(image=>image.type==='image_url'&&image.image_url.detail==='high'));assert.deepEqual(result.answers,['A sample description.']);
});

test('unsupported, missing and corrupt image requests never fall back to guessing from text',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw new Error('must not send');},q={question:'Describe.',type:'text',options:[],targets:[{}],images:pictures};
  await assert.rejects(askModel(q,{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro'},'fixture-key',undefined,{fetchImpl}),/不支持图片/);
  for(const images of [[{label:'A',digest:assets[0].digest}],pictures.map(image=>({...image,dataURL:'https://example.test/private-token'}))])await assert.rejects(askModel({...q,images},settings,'fixture-key',undefined,{fetchImpl}),/图片/);assert.equal(calls,0);
  await assert.rejects(askModel(q,settings,'fixture-key',undefined,{fetchImpl:async()=>{calls++;return new Response('fixture-private-key',{status:400});}}),error=>error.code==='AI_VISION_REQUEST_ERROR'&&!error.message.includes('fixture-private-key'));assert.equal(calls,1);
});

test('a whole exercise embeds pictures once and matches only the complete image content and labels',()=>{
  const row=Core.validateExercise(bank()),index=Core.buildBankIndex([row]),questions=live(row);assert.equal(row.imageAssets.length,3);assert.equal(row.pages[0].questions.length,3);assert.deepEqual(Core.matchExercisePage(questions,row.scope,index).map(answer=>answer.answers[0]),pictureAnswers);assert.equal(Core.matchAnswer(questions[0],Core.buildBankIndex([{question:questions[0].question,answer:'A text-only fragment.'}])),null);
  for(const change of [q=>q[0].images[0].digest='f'.repeat(64),q=>q[0].images[0].label='B.',q=>q[0].images.pop()]){const altered=structuredClone(questions);change(altered);assert.equal(Core.matchExercisePage(altered,row.scope,index),null);}
});

test('picture bank validation rejects dangling assets, missing images, bad hashes and non-image payloads',()=>{
  for(const change of [row=>row.imageAssets.pop(),row=>row.pages[0].questions[0].images[0].digest='f'.repeat(64),row=>row.imageAssets.push({...assets[0]}),row=>row.imageAssets[0].dataURL='data:text/html;base64,PGh0bWw+' ]){const row=structuredClone(bank());change(row);assert.throws(()=>Core.validateExercise(row));}
  const row=structuredClone(bank());row.imageAssets[0].dataURL=pictureSources[1];assert.throws(()=>verifyBankImages([row]),/校验失败/);assert.doesNotThrow(()=>verifyBankImages([bank()]));
});

test('original image content is captured and verified without waiting for element screenshots or screen geometry',async()=>{
  let source=pictureBytes(1),downloads=0;const context={},locator={count:async()=>1,evaluate:async()=>({loaded:true,width:96,height:64,url:'https://images.example.test/photo.png?private-token'}),screenshot:async()=>assert.fail('original images never need an element screenshot')},record={selector:'#photo',label:'A.',referrer:'https://ucontent.unipus.cn/' ,frame:{locator:()=>locator}},reader=new ImageMaterials({download:async(url,options)=>{downloads++;assert.equal(options.context,context);assert.equal(options.referrer,record.referrer);assert.equal(options.maxBytes,8*1024*1024);assert.equal(options.apiKey,undefined);return source;}});
  const result=await reader.capture(record,{context});assert.equal(downloads,1);assert.equal(result.digest,assets[0].digest);assert.equal(result.verification.mode,'original');await reader.verify(record,result,{context});source=pictureBytes(3);await assert.rejects(reader.verify(record,result,{context}),error=>error.code==='IMAGE_CHANGED');assert.equal(downloads,3);assert.doesNotMatch(JSON.stringify(result),/private-token|https:/);
});

test('inline originals and readable blob pixels do not need rendering or network stability',async()=>{
  for(const mode of ['original','canvas']){
    let source=pictureSources[0];const locator={count:async()=>1,evaluate:async fn=>String(fn).includes('toDataURL')?source:{loaded:true,width:96,height:64,url:mode==='original'?source:'blob:fixture',style:'same'},screenshot:async()=>assert.fail('readable pixels must not require a screenshot')},record={selector:'#photo',frame:{locator:()=>locator}},reader=new ImageMaterials({download:async()=>assert.fail('inline/blob data has no remote download')});
    const image=await reader.capture(record);assert.equal(image.verification.mode,mode);await reader.verify(record,image);source=pictureSources[2];await assert.rejects(reader.verify(record,image),error=>error.code==='IMAGE_CHANGED');
  }
});

test('screenshot timeouts have a recoverable redacted error and cancellation keeps its reason',async()=>{
  const locator={count:async()=>1,evaluate:async fn=>String(fn).includes('toDataURL')?'':{loaded:true,width:96,height:64,url:'blob:fixture',style:'same'},screenshot:async()=>{throw new Error('locator.screenshot: Timeout 5000ms exceeded, private-token');}},record={selector:'#photo',frame:{locator:()=>locator}},reader=new ImageMaterials();
  await assert.rejects(reader.capture(record),error=>error.code==='IMAGE_READ_UNAVAILABLE'&&!/locator|private-token|Timeout/.test(error.message));
  const controller=new AbortController();controller.abort(new Error('fixture-stop'));await assert.rejects(reader.capture(record,{signal:controller.signal}),/fixture-stop/);
});

test('image download failures use the rendered image without exposing signed URLs and unloaded images stop',async()=>{
  let loaded=true;const locator={count:async()=>1,evaluate:async()=>({loaded,width:96,height:64,url:'https://images.example.test/photo?private-token'}),screenshot:async()=>pictureBytes(1),boundingBox:async()=>({width:96,height:64})},record={selector:'#image',label:'A.',frame:{locator:()=>locator}},reader=new ImageMaterials({download:async()=>{throw new Error('private-token');}});
  const image=await reader.capture(record,{context:{}});assert.equal(image.digest,assets[0].digest);assert.doesNotMatch(JSON.stringify(image),/private-token|https:/);loaded=false;await assert.rejects(reader.capture(record,{}),/尚未加载/);
});

test('complete picture exercises persist, deduplicate, export and reload without source URLs or locators',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/picture-bank-'));
  try{const store=await new Store(directory,{env:{}}).load();await store.learnVerifiedExercise(bank());assert.equal((await store.learnVerifiedExercise(bank())).unchanged,true);await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.equal(restored.data.bank.length,1);assert.equal(restored.data.bank[0].imageAssets.length,3);assert.deepEqual(Core.validateBank(JSON.parse(JSON.stringify(restored.data.bank))),restored.data.bank);assert.doesNotMatch(JSON.stringify(restored.data.bank),/selector|private-token|https:/);await restored.flush();}finally{await rm(directory,{recursive:true,force:true});}
});
