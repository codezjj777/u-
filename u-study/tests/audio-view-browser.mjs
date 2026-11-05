import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {audioViewHTML,audioViewTitle,audioViewWav} from './fixtures/audio-view.mjs';

export async function audioViewBrowserCases(t,context,root){
  async function setup({mode='normal',layout='compact',duration=79,metadataDuration,iframe=false,store}={}){
    const bytes=audioViewWav(duration);
    const page=await context.newPage();await page.route('**/audio-view.wav',route=>{
      const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
      return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})},body:bytes.subarray(start,end+1)});
    });
    let frame;
    if(iframe){
      await page.route('**/audio-view-frame',route=>route.fulfill({contentType:'text/html',body:audioViewHTML({mode,layout})}));await page.goto('https://ucontent.unipus.cn/offline-recognition/audio-view-parent');await page.setContent('<div style="height:380px">Parent</div><iframe style="width:800px;height:450px" src="https://ucontent.unipus.cn/offline-recognition/audio-view-frame"></iframe>');frame=page.frames().find(candidate=>candidate.url().endsWith('/audio-view-frame'))||await page.waitForEvent('framenavigated',{predicate:candidate=>candidate.url().endsWith('/audio-view-frame')});
    }else{await page.goto('https://ucontent.unipus.cn/offline-recognition/audio-view');await page.setContent(audioViewHTML({mode,layout}));frame=page.mainFrame();}
    await frame.waitForFunction(()=>Number.isFinite(document.querySelector('audio')?.duration)&&document.querySelector('audio').readyState>=2,undefined,{timeout:5000});
    // Only the reported metadata differs; decoding, played ranges and ended
    // events still come from a real media resource and its native playback.
    if(metadataDuration!==undefined)await frame.evaluate(duration=>Object.defineProperty(document.querySelector('audio'),'duration',{get:()=>duration,configurable:true}),metadataDuration);
    const task={id:'audio-view-'+Math.random(),courseId:'audio-book',unitId:'audio-unit',entryKey:JSON.stringify(['audio-unit',['Section 2'],audioViewTitle]),unitLabel:'Unit 1',currentEntry:audioViewTitle,status:'running',answered:0,pages:0,logs:[],manualItems:[]};
    const localStore=store||{directory:'.cache',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(localStore),settings={aiEnabled:false,autoSubmit:false};
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.askModel=engine.fillQuestion=engine.verifyQuestion=engine.media.resolve=async()=>assert.fail('audio-only pages must not request AI, transcribe or fill answers');
    const action=engine.action.bind(engine);engine.action=async(frame,kind,...args)=>{assert.equal(kind,'notice','audio-only pages must not submit or navigate');return action(frame,kind,...args);};
    const wait=engine.waitQuestions.bind(engine);engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:900});
    const complete=engine.completeAudioView.bind(engine);engine.completeAudioView=(task,page,snapshot,settings,signal)=>complete(task,page,snapshot,settings,signal,{playTimeoutMs:800,seekTimeoutMs:800,endTimeoutMs:2500,pollMs:50});
    const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{signal?.throwIfAborted();if(task.status==='review')throw new Error('Unexpected audio review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};
    return {page,frame,task,store:localStore,engine,settings};
  }
  const inspect=f=>f.frame.evaluate(()=>{const audio=document.querySelector('audio');return {time:audio.currentTime,duration:audio.duration,seekResolution:audio.duration/document.querySelector('.ant-slider,.progress-slider').getBoundingClientRect().width,ended:audio.ended,paused:audio.paused,plays:window.playClicks,drags:window.dragStarts,seeks:window.seekRequests,nativeEnds:window.nativeEnds,syntheticEnds:window.syntheticEnds,actions:window.playerActions,trusted:window.pointerTrusted,events:window.audioEvents};});
  for(const iframe of [false,true])await t.test(`the platform 33-second sibling audio controls ${iframe?'inside an iframe':'on the full-width lesson'} seek to 32 seconds and naturally end`,async()=>{
    const f=await setup({layout:'platform',duration:33,iframe});try{
      const initial=await f.engine.readAudioView(f.page,f.task,f.settings);assert.equal(initial.controlsReady,true,JSON.stringify(initial.controlHints));assert.equal(await f.frame.locator(initial.trackSelector).getAttribute('class'),'progress-slider');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.audioDone,true,JSON.stringify({result,state,logs:f.task.logs}));assert.equal(state.duration,33);assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.equal(state.ended,true);assert.deepEqual(state.trusted,[true]);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);assert.ok(Math.abs(state.actions[1].time-32)<=state.seekResolution,JSON.stringify(state));assert.equal(f.task.answered,0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  for(const duration of [33.54125,79.5])await t.test(`a bounded platform thumb accounts for its own width before the final second of a ${duration}-second audio`,async()=>{
    const f=await setup({layout:'platform',mode:'bounded-thumb',duration});try{
      const initial=await f.engine.readAudioView(f.page,f.task,f.settings);assert.equal(initial.thumbBounded,true);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.audioDone,true,JSON.stringify({result,state}));assert.ok(Math.abs(state.actions[1].time-(state.duration-1))<=.55,JSON.stringify(state));assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.equal(state.ended,true);assert.deepEqual(state.trusted,[true]);
    }finally{await f.page.close();}
  });
  await t.test('a real audio ending 0.13 seconds before its reported duration confirms one play click and native EOF',async()=>{
    const f=await setup({layout:'platform',mode:'bounded-thumb',duration:75.15,metadataDuration:75.28});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.audioDone,true,JSON.stringify({result,state,logs:f.task.logs}));assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.equal(state.ended,true);assert.ok(Math.abs(state.time-75.15)<.01);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);assert.deepEqual(state.trusted,[true]);
      const clicked=f.task.logs.findIndex(log=>/已点击音频播放按钮/.test(log.message)),playing=f.task.logs.findIndex(log=>/已确认音频从末尾/.test(log.message));assert.ok(clicked>=0);assert.ok(playing>clicked);assert.equal(f.task.answered,0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  for(const repeat of [false,true])await t.test(`an unexpected native audio pause at the tail ${repeat?'is bounded after one resume':'resumes at the same position and naturally ends'}`,async()=>{
    const f=await setup({layout:'platform',mode:repeat?'tail-pause-repeat':'tail-pause-once',duration:75.28});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(state.drags,1,JSON.stringify(state));assert.equal(state.plays,2,JSON.stringify({result,state,logs:f.task.logs}));assert.equal(state.syntheticEnds,0);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play','play']);assert.equal(f.task.logs.filter(log=>/末尾意外暂停/.test(log.message)).length,1);assert.equal(f.task.logs.filter(log=>/已点击音频播放按钮/.test(log.message)).length,2);
      if(repeat){assert.equal(result.review,true);assert.equal(result.audioDone,undefined);assert.equal(state.nativeEnds,0);assert.equal(state.paused,true);assert.match(result.message,/再次在末尾暂停/);}
      else{assert.equal(result.audioDone,true,JSON.stringify({result,state}));assert.equal(state.nativeEnds,1);assert.equal(state.ended,true);assert.ok(state.actions[2].time>state.actions[1].time+.025);}
    }finally{await f.page.close();}
  });
  for(const iframe of [false,true])await t.test(`a moving audio button ${iframe?'inside an iframe':'inside a pointer-disabled player shell'} is clicked without waiting for a container hover`,async()=>{
    const f=await setup({layout:'platform',duration:33,mode:'moving-controls',iframe});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.audioDone,true,JSON.stringify({result,state}));assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.deepEqual(state.trusted,[true]);
    }finally{await f.page.close();}
  });
  for(const masks of [false,true])await t.test(`four retained modal layers${masks?' with sibling masks':''} are released before dragging and playing the platform audio`,async()=>{
    const f=await setup({layout:'platform',duration:33,mode:'ghost'});try{
      if(masks)await f.frame.evaluate(()=>{for(const wrap of document.querySelectorAll('.ant-modal-wrap')){const root=document.createElement('div'),mask=document.createElement('div');root.className='ant-modal-root';mask.className='ant-modal-mask';mask.style.cssText='position:fixed;inset:0;background:transparent;z-index:'+(Number(getComputedStyle(wrap).zIndex)-1);wrap.before(root);root.append(mask,wrap);}});
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.audioDone,true,JSON.stringify(result));const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.equal(await f.frame.locator('.ant-modal-wrap').count(),4);
      assert.equal(await f.frame.locator('[data-ustudy-modal-operation]').count(),0);assert.equal(await f.frame.locator('.ant-modal-mask').evaluateAll(els=>els.every(el=>el.style.pointerEvents==='')),true);
    }finally{await f.page.close();}
  });
  await t.test('a visible unrelated dialog blocks audio interaction without clicking its confirmation',async()=>{
    const f=await setup({layout:'platform',duration:33,mode:'dialog'});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.audioDone,undefined);const state=await inspect(f);assert.equal(state.drags,0);assert.equal(state.plays,0);assert.equal(state.nativeEnds,0);assert.equal(await f.frame.evaluate(()=>window.unrelatedClicks||0),0);
    }finally{await f.page.close();}
  });
  for(const iframe of [false,true])await t.test(`a real 79-second audio ${iframe?'inside an iframe':'with compact circular controls'} is dragged first and naturally ends after one play click`,async()=>{
    const f=await setup({iframe});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.audioDone,true,JSON.stringify(result));const state=await inspect(f);assert.equal(state.duration,79);assert.equal(state.drags,1);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.syntheticEnds,0);assert.equal(state.ended,true);assert.deepEqual(state.trusted,[true]);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);assert.equal(state.actions[0].paused,true);
      // Mouse events quantize the compact 177-pixel rail to about .45 s/pixel.
      assert.ok(Math.abs(state.actions[1].time-78)<=state.seekResolution,JSON.stringify(state));assert.equal(f.task.answered,0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  await t.test('an already naturally-ended audio is observed without another drag or play click',async()=>{
    const f=await setup();try{assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).audioDone,true);const before=await inspect(f);assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).audioDone,true);const after=await inspect(f);assert.equal(after.plays,before.plays);assert.equal(after.drags,before.drags);assert.equal(after.nativeEnds,1);}finally{await f.page.close();}
  });
  for(const mode of ['inert','blocked','popup'])await t.test(`a ${mode} audio player retains its page for review without repeating a drag or claiming completion`,async()=>{
    const f=await setup({mode});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.audioDone,undefined);assert.doesNotMatch(result.message,/视频|https?:|Call log|\u001b/);const state=await inspect(f);assert.equal(state.drags,1);assert.ok(state.actions.filter(action=>action.kind==='play').length<=1);assert.equal(state.paused,true);assert.equal(state.ended,false);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('audio with a late-loading answer box remains a question page and never starts passive playback',async()=>{
    const f=await setup();try{
      await f.frame.evaluate(()=>setTimeout(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<fieldset><legend>Choose one.</legend><label><input type="radio" name="q">True</label><label><input type="radio" name="q">False</label></fieldset>'),150));
      const snapshot=await Automation.prototype.waitQuestions.call(f.engine,f.task,f.page,f.settings,new AbortController().signal,{allowUnsupported:true,timeout:1900});assert.equal(snapshot.audioView,undefined);assert.equal(snapshot.questions.length,1);const state=await inspect(f);assert.equal(state.plays,0);assert.equal(state.drags,0);
    }finally{await f.page.close();}
  });
  for(const stage of ['seek','play'])await t.test(`stopping after audio ${stage} retains the current player and does not repeat the drag`,async()=>{
    const f=await setup(),controller=new AbortController();try{
      f.engine.runtime.runs.set(f.task.id,Promise.resolve());
      const add=f.store.addLog.bind(f.store);f.store.addLog=(task,message,...args)=>{add(task,message,...args);if((stage==='seek'?/已核对进度条/:/已确认音频从末尾/).test(message)){task.status='stopping';controller.abort(new Error('stop-real-audio'));}};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),/stop-real-audio/);const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.plays,stage==='seek'?0:2);assert.equal(state.paused,true);assert.equal(state.ended,false);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);
    }finally{f.engine.runtime.runs.delete(f.task.id);await f.page.close();}
  });
  await t.test('pausing an active audio task pauses its player before entering the task gate and resumes without another drag',async()=>{
    const f=await setup();f.engine.runtime.runs.set(f.task.id,Promise.resolve());try{
      const add=f.store.addLog.bind(f.store),gate=f.engine.gate.bind(f.engine);let paused=false;
      f.store.addLog=(task,message,...args)=>{add(task,message,...args);if(!paused&&/已确认音频从末尾/.test(message)){paused=true;task.status='paused';}};
      f.engine.gate=async(task,signal)=>{if(task.status==='paused'){assert.equal((await inspect(f)).paused,true);await new Promise(resolve=>setTimeout(resolve,3000));task.status='running';}return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.audioDone,true,JSON.stringify({result,state}));assert.equal(paused,true);assert.equal(state.drags,1);assert.equal(state.nativeEnds,1);assert.ok(state.plays>=3);
    }finally{f.engine.runtime.runs.delete(f.task.id);await f.page.close();}
  });
  await t.test('an old manual mark is cleared only after native audio end and delayed directory completion, with no bank row',async()=>{
    const directory=path.join(root,'audio-learning'),store=await new Store(directory,{env:{}}).load(),f=await setup({store});try{
      await store.rememberManualEntry(f.task,{},'no-fillable-questions','question-controls-v4');const entry={key:f.task.entryKey,title:audioViewTitle,path:['Section 2'],required:true,pending:true,completed:false};let checks=0;
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;f.engine.refreshTaskDirectory=async task=>{if(!f.page.isClosed()&&(await inspect(f)).ended)entry.completed=++checks>=3;task.requiredTotal=1;task.requiredCompleted=entry.completed?1:0;return {ready:true,activeUnitId:task.unitId,entries:[{...entry}]};};
      await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(checks,3);assert.equal(f.task.requiredCompleted,1);assert.equal(store.findManualEntry(f.task),null);assert.equal(store.data.bank.length,0);assert.equal(f.page.isClosed(),true);await store.flush();const restored=await new Store(directory,{env:{}}).load();assert.equal(restored.findManualEntry(f.task),null);await restored.flush();
    }finally{if(!f.page.isClosed())await f.page.close();await store.flush();}
  });
  await t.test('native audio end alone cannot complete an unsaved directory row or cause a replay',async()=>{
    const f=await setup(),controller=new AbortController();try{
      const entry={key:f.task.entryKey,title:audioViewTitle,path:['Section 2'],required:true,pending:true,completed:false};f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;f.engine.refreshTaskDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});
      const wait=f.engine.waitTaskCompletion.bind(f.engine);f.engine.waitTaskCompletion=(task,catalog,page,entry,signal,options)=>wait(task,catalog,page,entry,signal,{...options,delayMs:0});const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review'){assert.equal((await inspect(f)).drags,1);assert.match(task.logs.at(-1).message,/音频已自然播放结束/);controller.abort(new Error('audio-directory-not-saved'));}return gate(task,signal);};
      await assert.rejects(f.engine.runTask(f.task,{},f.settings,controller.signal),/audio-directory-not-saved/);assert.equal(f.task.status,'review');assert.equal((await inspect(f)).nativeEnds,1);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('an audio preview reads metadata without seeking, playing, transcribing or requesting AI',async()=>{
    const f=await setup();try{
      f.store.data.tasks=[];f.store.data.courses=[{id:f.task.courseId}];const entry={key:f.task.entryKey,title:audioViewTitle,required:true,pending:true};f.engine.courseDirectory=async()=>({page:{}});f.engine.prepareDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});f.engine.openRequiredEntry=async()=>f.page;
      const result=await f.engine.previewMedia({courseId:f.task.courseId,unitId:f.task.unitId,entryKey:f.task.entryKey,solve:true});assert.equal(result.kind,'audio-view');assert.equal(result.audioView.duration,79);assert.equal(result.audioView.paused,true);assert.equal(result.written,false);assert.equal(result.submitted,false);assert.deepEqual(result.questions,[]);assert.doesNotMatch(JSON.stringify(result),/https?:|\.wav/);
    }finally{if(!f.page.isClosed())await f.page.close();}
  });
}
