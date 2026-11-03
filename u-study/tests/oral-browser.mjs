import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {Automation} from '../automation.mjs';
import {inspectOralWave} from '../oral-speech.mjs';
import {installOralInputFromDOM,oralInputActionFromDOM,reserveOralPage} from '../oral-input.mjs';
import {readOralActivityFromDOM,loadOralStory,oralRecordingIdentity} from '../oral-activity.mjs';
import {saveLocalOralDraft} from '../oral-draft.mjs';
import {Store} from '../store.mjs';
import {createApp} from '../server.mjs';
import {oralTestWave,oralRetellHTML,oralSequenceHTML,oralRetelling,oralStory,oralPrompt,oralQuestion,oralQuestionDirections} from './fixtures/oral-retell.mjs';
import {SHORT_ORAL_TEXT} from '../oral-short.mjs';

export async function oralBrowserCases(t,context,root){
  async function setup(options={}){
    const page=await context.newPage(),url='https://ucontent.unipus.cn/offline-oral/'+Math.random();await page.route(url,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:options.sequence?oralSequenceHTML(options):oralRetellHTML(options)}));await page.goto(url);
    const task={id:'oral-'+Math.random().toString(36).slice(2),courseId:'offline-book',unitId:'unit4',unitLabel:'Unit 4',entryKey:JSON.stringify(['unit4',['Active reading','Getting the idea'],'Exercise 2']),status:'running',logs:[],answered:0,pages:0,manualItems:[]},directory=path.join(root,task.id);await mkdir(directory,{recursive:true});
    const settings={aiEnabled:true,autoSubmit:true,oralMode:'retell',endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'};
    const store=options.liveStore?await new Store(directory,{env:{}}).load():{directory,apiKey:'fixture-key',data:{tasks:[task],bank:[],courses:[]},changed(){},addActivity(){},addLog(task,message){task.logs.push({message});}};if(options.liveStore){store.apiKey='fixture-key';store.data.tasks=[task];store.data.settings={...store.data.settings,...settings};}
    const engine=new Automation(store);engine.pages.track(page,'lesson',{taskId:task.id});
    const wave=oralTestWave(2.5);engine.oralSpeech={synthesize:async script=>{assert.equal(script,oralRetelling);return {...inspectOralWave(wave),bytes:wave,voice:'isolated fixture'};}};
    let requests=0;engine.askModel=async question=>{requests++;assert.equal(question.context,oralStory);return {answers:[oralRetelling]};};
    return {engine,task,page,store,requests:()=>requests,settings,cleanup:async()=>{await page.close();if(options.liveStore)await store.flush();await rm(directory,{recursive:true,force:true});}};
  }
  for(const options of [{legacy:false},{legacy:true},{replayData:true},{replayUnavailable:true}])await t.test(`generated audio records, uploads and continues without replay with ${options.replayUnavailable?'an unavailable remote replay URL':options.replayData?'a local audio data URI':options.legacy?'a cached legacy microphone API':'a cached modern microphone API'}`,async()=>{
    const f=await setup(options);try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.nextPage,true,result.message);assert.equal(result.oralDone,true);assert.equal(f.task.answered,1);assert.equal(f.requests(),1);assert.equal(f.store.data.bank.length,0);
      assert.equal(await f.page.evaluate(()=>window.recordingSaved&&window.uploadReady&&window.footerClicks===1&&!window.footerDuringUpload&&window.replayClicks===0&&window.replayFetches===0&&!window.__ustudyOralInput&&!window.__ustudyOralReservation),true);
      const next=await f.engine.waitNextExercisePage(f.task,f.page,f.settings,result.snapshot,new AbortController().signal,{timeout:1500});assert.equal(next.feedback.summary,true);
    }finally{await f.cleanup();}
  });
  const oralSequences=[
    {name:'three oral pages preserving saved page 2 with modern capture',count:3,savedPages:[1],legacy:false},
    {name:'three oral pages preserving saved page 1 with legacy capture',count:3,savedPages:[0],legacy:true},
    {name:'a saved retelling followed by a zero-score saved spoken question submits without rerecording',count:2,savedPages:[0,1],prompts:[oralPrompt,oralQuestion],directions:['Complete the following task and record your answer.',oralQuestionDirections]},
    {name:'mixed oral prompts record retelling and spoken questions with one short clip through final submission',count:3,savedPages:[],legacy:true,prompts:[oralPrompt,oralQuestion,'Describe a difficult decision you have made and explain your reasons.'],directions:['Complete the following task and record your answer.',oralQuestionDirections,oralQuestionDirections]}
  ];
  for(const scenario of oralSequences)await t.test(scenario.name,async()=>{
    const {count,savedPages}=scenario,expectedRecordings=count-savedPages.length,f=await setup({...scenario,sequence:true}),signal=new AbortController().signal;let synthesized=0,reloads=0,released=false;
    try{
      f.settings.oralMode='short';f.settings.aiEnabled=false;f.store.apiKey='';
      f.engine.askModel=async()=>assert.fail('short recordings must never read a story or request AI');f.engine.oralSpeech.synthesize=async text=>{synthesized++;assert.equal(text,SHORT_ORAL_TEXT);const bytes=oralTestWave(2.5);return {...inspectOralWave(bytes),bytes,voice:'short fixture'};};
      f.page.on('domcontentloaded',()=>reloads++);
      const entry={key:f.task.entryKey,title:'Exercise 2',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false};
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>{f.engine.taskPages.set(f.task.id,f.page);return f.page;};
      f.engine.refreshTaskDirectory=async()=>{const completed=await f.page.evaluate(()=>window.sequenceDone);f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:'unit4',entries:[{...entry,completed,pending:!completed}]};};
      f.engine.pages.release=async(_page,{completed}={})=>{released=completed===true;return {status:'closed'};};
      await f.engine.runTask(f.task,{},f.settings,signal);
      assert.equal(f.task.status,'completed',JSON.stringify(f.task.logs));assert.equal(f.task.answered,expectedRecordings);assert.equal(f.task.pages,count);assert.equal(synthesized,expectedRecordings?1:0);assert.equal(reloads,1);assert.equal(released,true);assert.equal(f.store.data.bank.length,0);
      const observed=await f.page.evaluate(()=>({starts:window.recordStarts,uploads:window.recordedUploads,clicks:window.footerClicks,done:window.sequenceDone,uploading:window.footerDuringUpload,replays:window.replayClicks,fetches:window.replayFetches,clean:!window.__ustudyOralInput&&!window.__ustudyOralReservation}));
      assert.deepEqual(observed.starts,Array.from({length:count},(_,index)=>index).filter(index=>!savedPages.includes(index)));assert.equal(observed.uploads.length,expectedRecordings);for(const audio of observed.uploads){assert.ok(audio.seconds>=5&&audio.seconds<6,JSON.stringify(audio));assert.ok(audio.rms>0.01);}
      assert.equal(observed.clicks,count);assert.equal(observed.done,true);assert.equal(observed.uploading,false);assert.equal(observed.replays,0);assert.equal(observed.fetches,0);assert.equal(observed.clean,true);
      assert.equal(await f.page.evaluate(async()=>(await navigator.permissions.query({name:'microphone'})).state),'prompt');
    }finally{await f.cleanup();}
  });
  await t.test('spoken questions in complete-retelling mode are retained without generating an unrelated story',async()=>{
    const f=await setup({prompt:oralQuestion,directions:oralQuestionDirections});try{
      f.engine.askModel=f.engine.oralSpeech.synthesize=async()=>assert.fail('the retelling generator must not answer an unrelated spoken question');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/口语问答/);assert.equal(await f.page.evaluate(()=>window.footerClicks),0);assert.deepEqual(await f.page.evaluate(()=>window.recordStarts),[]);
    }finally{await f.cleanup();}
  });
  await t.test('short recording stops at another directory leaf instead of recording its next page',async()=>{
    const f=await setup({sequence:true,count:2,boundary:true});try{
      f.settings.oralMode='short';f.settings.aiEnabled=false;f.store.apiKey='';f.engine.askModel=async()=>assert.fail('short mode must not call AI');f.engine.oralSpeech.synthesize=async()=>{const bytes=oralTestWave(2);return {...inspectOralWave(bytes),bytes,voice:'short fixture'};};
      const result=await f.engine.answerEntry(f.task,f.page,f.settings,new AbortController().signal);assert.match(result.message,/后续页面不属于/);assert.equal(await f.page.evaluate(()=>window.footerClicks),1);assert.deepEqual(await f.page.evaluate(()=>window.recordStarts),[0]);assert.equal(f.task.answered,1);
    }finally{await f.cleanup();}
  });
  await t.test('a saved control does not advance the lesson while its recording is still uploading',async()=>{
    const f=await setup({saveDelay:1800});try{
      const pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);await f.page.waitForFunction(()=>window.recordingSaved&&!window.uploadReady);
      assert.equal(await f.page.evaluate(()=>window.footerClicks),0);assert.equal((await f.engine.readOralActivity(f.page)).saving,true);
      const result=await pending;assert.equal(result.oralDone,true,result.message);assert.equal(await f.page.evaluate(()=>window.uploadReady&&!window.footerDuringUpload&&window.replayClicks===0&&window.replayFetches===0),true);
    }finally{await f.cleanup();}
  });
  await t.test('an upload failure retains the lesson without playback, submission or a completed answer count',async()=>{
    const f=await setup({uploadFailure:true});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/上传或保存失败/);assert.equal(f.task.answered,0);assert.equal(f.task.pages,0);
      assert.equal(await f.page.evaluate(()=>window.footerClicks===0&&window.replayClicks===0&&window.replayFetches===0&&!window.__ustudyOralInput&&!window.__ustudyOralReservation),true);
    }finally{await f.cleanup();}
  });
  await t.test('an existing saved recording is retained without replacement, synthesis, AI or submission',async()=>{
    const f=await setup({saved:true});try{f.engine.oralSpeech.synthesize=async()=>assert.fail('existing recordings are not replaced');const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/已有录音/);assert.equal(f.requests(),0);assert.equal(await f.page.evaluate(()=>window.footerClicks),0);}finally{await f.cleanup();}
  });
  await t.test('the workbench retry button resumes its existing review task and replaces the verified old recording without AI',async()=>{
    const f=await setup({saved:true,liveStore:true}),controller=new AbortController();let server,ui,pending,base,route,completed=false;
    try{
      await f.page.waitForFunction(()=>document.querySelector('audio')?.duration>0);const oral=await f.engine.readOralActivity(f.page);await saveLocalOralDraft({directory:f.store.directory,scope:f.task,oral,source:{context:oralStory},settings:f.settings,text:oralRetelling,speech:f.engine.oralSpeech});
      f.engine.askModel=f.engine.oralSpeech.synthesize=async()=>assert.fail('workbench retry must reuse reviewed local speech');
      const entry={key:f.task.entryKey,title:'Exercise 2',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false};f.engine.courseDirectory=async()=>({page:{}});f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed ||= await f.page.evaluate(()=>window.footerClicks>0);return {ready:true,activeUnitId:'unit4',entries:[{...entry,pending:!completed,completed}]};};
      f.engine.openRequiredEntry=async()=>{f.engine.taskPages.set(f.task.id,f.page);return f.page;};
      const lease=f.engine.operations.acquire('answer',{signal:controller.signal,timeoutMs:0});pending=f.engine.runtime.start(f.task,controller,()=>f.engine.runTask(f.task,{},f.settings,lease.signal),()=>lease.release());
      server=createApp({store:f.store,automation:f.engine,port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;route=route=>route.continue();await context.route(base+'/**',route);ui=await context.newPage();await ui.addInitScript(()=>localStorage.setItem('ustudy-demo','false'));await ui.goto(base);await ui.locator('[data-view="tasks"]').first().click();
      const retry=ui.locator('[data-task-action="replace-oral"]');await retry.waitFor({state:'visible'});assert.equal(f.task.status,'review');assert.equal(f.task.oralReview.ready,true);assert.equal(f.requests(),0);await retry.click();await pending;
      assert.equal(f.task.status,'completed',JSON.stringify(f.task.logs));assert.equal(f.task.answered,1);assert.equal(f.store.data.bank.length,0);assert.equal(f.task.oralRetryRequested,undefined);assert.equal(f.task.oralReview,undefined);assert.equal(completed,true);
    }finally{controller.abort();await pending?.catch(()=>{});await ui?.close();await server?.shutdown();if(base)await context.unroute(base+'/**',route);await f.cleanup();}
  });
  await t.test('a scoped replacement reuses the exact locally previewed audio and never requests an external model',async()=>{
    const f=await setup({saved:true});try{
      await f.page.waitForFunction(()=>document.querySelector('audio')?.duration>0);const oral=await f.engine.readOralActivity(f.page),prepared=await saveLocalOralDraft({directory:f.store.directory,scope:f.task,oral,source:{context:oralStory},settings:f.settings,text:oralRetelling,speech:f.engine.oralSpeech});
      f.task.oralReplacement={entryKey:f.task.entryKey,recordingKey:oralRecordingIdentity(oral),draftKey:prepared.reviewKey};f.engine.askModel=async()=>assert.fail('approved local audio must not request AI');f.engine.oralSpeech.synthesize=async()=>assert.fail('approved local audio is reused');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback?.summary,true,result.message);assert.equal(result.oralDone,true);assert.equal(await f.page.evaluate(()=>window.footerClicks),1);assert.equal(f.store.data.bank.length,0);
    }finally{await f.cleanup();}
  });
  await t.test('a changed old recording blocks a replacement authorization before any AI, synthesis or microphone request',async()=>{
    const f=await setup({saved:true});try{await f.page.waitForFunction(()=>document.querySelector('audio')?.duration>0);f.task.oralReplacement={entryKey:f.task.entryKey,recordingKey:'1'.repeat(64),draftKey:'2'.repeat(64)};f.engine.askModel=f.engine.oralSpeech.synthesize=async()=>assert.fail('changed old recording must not prepare input');const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(await f.page.evaluate(()=>!window.__ustudyOralInput&&window.footerClicks===0),true);}finally{await f.cleanup();}
  });
  await t.test('replacing one reviewed recording retains a following question without asking AI or filling its answer',async()=>{
    const f=await setup({saved:true,followup:true});try{
      await f.page.waitForFunction(()=>document.querySelector('audio')?.duration>0);const oral=await f.engine.readOralActivity(f.page),prepared=await saveLocalOralDraft({directory:f.store.directory,scope:f.task,oral,source:{context:oralStory},settings:f.settings,text:oralRetelling,speech:f.engine.oralSpeech});
      f.task.oralReplacement={entryKey:f.task.entryKey,recordingKey:oralRecordingIdentity(oral),draftKey:prepared.reviewKey};f.engine.askModel=async()=>assert.fail('a single recording replacement must not send another page to AI');f.engine.oralSpeech.synthesize=async()=>assert.fail('the reviewed audio is already prepared');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.oralDone,true);assert.match(result.message,/后续题页已保留/);assert.equal(await f.page.locator('textarea').inputValue(),'');assert.equal(await f.page.evaluate(()=>window.footerClicks),1);
    }finally{await f.cleanup();}
  });
  await t.test('manual-submit mode retains a verified final recording without clicking the footer',async()=>{
    const f=await setup({progress:100});try{const result=await f.engine.answerEntryAttempt(f.task,f.page,{...f.settings,autoSubmit:false},new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/检查并提交/);assert.equal(await f.page.evaluate(()=>window.recordingSaved&&window.footerClicks===0),true);}finally{await f.cleanup();}
  });
  await t.test('changing the selected oral prompt during synthesis stops before capture and never submits',async()=>{
    const f=await setup();try{const original=f.engine.oralSpeech.synthesize;f.engine.oralSpeech.synthesize=async script=>{const audio=await original(script);await f.page.locator('.p-oral-personal-state p').evaluate(el=>el.textContent='Retell another story in your own words.');return audio;};const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/已切换/);assert.equal(await f.page.evaluate(()=>window.recording||window.footerClicks||!!window.__ustudyOralInput),false);}finally{await f.cleanup();}
  });
  await t.test('cancelling generated recording restores input functions and never clicks the course footer',async()=>{
    const f=await setup(),controller=new AbortController();try{
      const pending=f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal);await f.page.waitForFunction(()=>window.__ustudyOralInput?.status().started===true);controller.abort(new Error('cancel fixture'));await assert.rejects(pending,/cancel fixture/);
      assert.equal(await f.page.evaluate(()=>window.footerClicks===0&&!window.__ustudyOralInput&&!window.__ustudyOralReservation&&!window.recording),true);
    }finally{await f.cleanup();}
  });
  await t.test('audio bridge rejects task URL changes and camera requests without using physical microphone permission',async()=>{
    const f=await setup();let reserved;try{
      const token='input-guard',wave=oralTestWave(),options={token,pageURL:f.page.url(),prompt:'Retell the story in your own words.',waveBase64:wave.toString('base64')};reserved=await reserveOralPage(f.page,options);await f.page.reload();await f.page.evaluate(installOralInputFromDOM,options);
      assert.equal(await f.page.evaluate(async()=>{try{await navigator.mediaDevices.getUserMedia({audio:true,video:true});return false;}catch(error){return error.name==='NotAllowedError';}}),true);
      await f.page.evaluate(()=>history.replaceState(null,'',location.href+'?different-task'));
      assert.equal(await f.page.evaluate(async()=>{try{await navigator.mediaDevices.getUserMedia({audio:true});return false;}catch(error){return error.name==='NotAllowedError';}}),true);
      await f.page.evaluate(oralInputActionFromDOM,{token,action:'dispose'});assert.equal(await f.page.evaluate(()=>!window.__ustudyOralInput&&!window.__ustudyOralReservation),true);
    }finally{await reserved?.close();await f.cleanup();}
  });
  await t.test('the real visible stop icon, not the idle label, reports recording state',async()=>{
    const f=await setup();try{let oral=await f.page.evaluate(readOralActivityFromDOM);assert.equal(oral.recording,false);await f.page.locator('.button-record path').evaluate(el=>el.setAttribute('d','M645.744434,351 L378,351 Z'));oral=await f.page.evaluate(readOralActivityFromDOM);assert.equal(oral.recording,true);assert.equal(oral.ready,false);}finally{await f.cleanup();}
  });
  for(const newTab of [true,false])await t.test(`a same-unit standalone Text tab supplies the complete story when it has no leaf task row and a notice disappears: popup=${newTab}`,async()=>{
    const f=await setup({context:false}),catalog=await context.newPage(),referenceURL='https://ucontent.unipus.cn/offline-oral-reference/text',pattern='https://ucontent.unipus.cn/offline-oral-reference/*';
    const route=route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body><div class="pc-break-crumb"><span class="pc-break-crumb-text">Offline book</span><span class="pc-break-crumb-text">Offline unit</span><span class="pc-break-crumb-text">Reading in detail</span></div><div class="pc-header-tab-activity">Text</div><main><div class="layoutBody-container"><p>'+oralStory+'</p></div></main></body></html>'});
    await context.route(pattern,route);try{
      await catalog.goto(referenceURL.replace('/text','/catalog'));await catalog.setContent('<a id="text" '+(newTab?'target="_blank" ':'')+'href="'+referenceURL+'">Text</a>');f.store.data.courses=[{id:f.task.courseId}];f.engine.pages.track(catalog,'catalog');f.engine.ensureBrowser=async()=>context;f.engine.courseDirectory=async()=>({page:catalog,url:catalog.url()});f.engine.prepareDirectory=async()=>({frame:catalog.mainFrame(),entries:[{title:'Text',path:['Active reading','Reading in detail','Text'],selector:'#text'}]});
      const state=f.engine.readLearningState.bind(f.engine);let notices=0,actions=0;f.engine.readLearningState=async page=>notices++===0?{loading:false,studyNotice:true}:state(page);f.engine.action=async()=>{actions++;throw new Error('locator.click: Timeout 5000ms, element was detached');};
      const oral=await f.engine.readOralActivity(f.page),source=await loadOralStory(f.engine,f.task,f.page,oral,new AbortController().signal);assert.equal(source.context,oralStory);assert.equal(actions,1);assert.equal(f.requests(),0);assert.equal(await f.page.evaluate(()=>window.recording||window.footerClicks>0),false);assert.equal(context.pages().some(page=>page.url()===referenceURL),false);
    }finally{await context.unroute(pattern,route);const replacement=f.engine.openedCourses.get(f.task.courseId)?.page;if(replacement&&!replacement.isClosed())await replacement.close();if(!catalog.isClosed())await catalog.close();await f.cleanup();}
  });
}
