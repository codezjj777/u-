import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {dragVideoProgress} from '../video-view.mjs';
import {videoViewHTML,videoViewTitle} from './fixtures/video-view.mjs';

export async function videoViewBrowserCases(t,context,root){
  const bytes=await readFile(new URL('./fixtures/video-view.webm',import.meta.url));
  async function setup({mode='normal',store,iframe=false}={}){
    const page=await context.newPage();await page.route('**/video-view.webm',route=>{
      const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
      return route.fulfill({status:range?206:200,contentType:'video/webm',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})},body:bytes.subarray(start,end+1)});
    });
    let frame=page;
    if(iframe){await page.route('**/video-view-frame',route=>route.fulfill({contentType:'text/html',body:videoViewHTML({mode})}));await page.goto('https://ucontent.unipus.cn/offline-recognition/video-view-parent');await page.setContent('<div style="height:400px">Parent</div><iframe style="width:850px;height:650px" src="https://ucontent.unipus.cn/offline-recognition/video-view-frame"></iframe>');frame=await page.locator('iframe').contentFrame();}
    else{await page.goto('https://ucontent.unipus.cn/offline-recognition/video-view');await page.setContent(videoViewHTML({mode}));}
    // FrameLocator has locator() but cannot evaluate a document. Use its frame.
    if(iframe)frame=page.frames().find(candidate=>candidate.url().endsWith('/video-view-frame'))||await page.waitForEvent('framenavigated',{predicate:candidate=>candidate.url().endsWith('/video-view-frame')});
    await frame.waitForFunction(()=>Number.isFinite(document.querySelector('video')?.duration)&&document.querySelector('video').readyState>=2,undefined,{timeout:5000});
    const task={id:'video-view-'+Math.random(),courseId:'video-book',unitId:'video-unit',entryKey:JSON.stringify(['video-unit',['Active reading','Analyzing writing techniques',videoViewTitle],videoViewTitle]),unitLabel:'Unit 4',currentEntry:videoViewTitle,status:'running',answered:0,pages:0,logs:[],manualItems:[]};
    const localStore=store||{directory:'.cache',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(localStore),settings={aiEnabled:false,autoSubmit:false};
    engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.askModel=engine.fillQuestion=engine.verifyQuestion=engine.media.resolve=async()=>assert.fail('passive video does not request AI, transcribe or fill answers');
    const action=engine.action.bind(engine);engine.action=async(frame,kind,...args)=>{assert.equal(kind,'notice','passive video must not submit or navigate to another task');return action(frame,kind,...args);};
    const wait=engine.waitQuestions.bind(engine);engine.waitQuestions=(task,page,settings,signal,options)=>wait(task,page,settings,signal,{...options,timeout:700});
    const complete=engine.completeVideoView.bind(engine);engine.completeVideoView=(task,page,snapshot,settings,signal)=>complete(task,page,snapshot,settings,signal,{playTimeoutMs:700,seekTimeoutMs:800,endTimeoutMs:2500,pollMs:50});
    const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{signal?.throwIfAborted();if(task.status==='review')throw new Error('Unexpected passive-video review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};
    return {page,frame,task,store:localStore,engine,settings};
  }
  const inspect=f=>f.frame.evaluate(()=>{const video=document.querySelector('video');return {time:video.currentTime,duration:video.duration,paused:video.paused,ended:video.ended,seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)]),plays:window.playClicks,drags:window.dragStarts,seeks:window.seekRequests,nativeEnds:window.nativeEnds,trusted:window.videoPointerTrusted,events:window.seekEvents,actions:window.playerActions};});
  await t.test('a paused real video is mouse-dragged to its final second before the play click and natural ending',async()=>{
    const f=await setup();try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),state=await inspect(f);assert.equal(result.videoDone,true,JSON.stringify({result,state,logs:f.task.logs}));assert.equal(state.ended,true);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);assert.ok(Math.abs(state.seeks[0]-(state.duration-1))<.2);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);assert.equal(state.actions[0].paused,true);assert.ok(Math.abs(state.actions[1].time-(state.duration-1))<.2);assert.deepEqual(state.trusted,[true]);assert.equal(f.task.answered,0);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });
  await t.test('a player that pauses on seek is resumed using its normal play button',async()=>{
    const f=await setup({mode:'pause-after-seek'});try{assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).videoDone,true);const state=await inspect(f);assert.equal(state.plays,1);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);}finally{await f.page.close();}
  });
  await t.test('a player whose progress control disappears after play is sought first and finishes without another track lookup',async()=>{
    const f=await setup({mode:'hide-track-on-play'});try{const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.videoDone,true,JSON.stringify(result));const state=await inspect(f);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play']);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);}finally{await f.page.close();}
  });
  await t.test('an already-playing real video is paused before its single drag and then played from the confirmed final second',async()=>{
    const f=await setup();try{
      await f.frame.locator('.vjs-play-control').click();await f.frame.waitForFunction(()=>document.querySelector('video').currentTime>.03);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.videoDone,true,JSON.stringify(result));const state=await inspect(f);assert.deepEqual(state.actions.map(action=>action.kind),['play','pause','drag','play']);assert.equal(state.actions[2].paused,true);assert.ok(Math.abs(state.actions[3].time-(state.duration-1))<.2);assert.equal(state.nativeEnds,1);
    }finally{await f.page.close();}
  });
  await t.test('the visible outer Unipus controls drive playback when inner Video.js controls are disabled',async()=>{
    const f=await setup({mode:'wrapped-player'});try{const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.videoDone,true);const state=await inspect(f);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);}finally{await f.page.close();}
  });
  await t.test('the custom Ant icon and slider around a disabled Video.js instance seek the real video correctly',async()=>{
    const f=await setup({mode:'unipus-slider'});try{const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.videoDone,true);const state=await inspect(f);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);assert.ok(Math.abs(state.seeks[0]-(state.duration-1))<.2);}finally{await f.page.close();}
  });
  for(const mode of ['poster-overlay','autohide-controls'])await t.test(`a ${mode} player reveals its controls without hovering the covered native video`,async()=>{
    const f=await setup({mode});try{
      await assert.rejects(f.frame.locator('video').hover({timeout:200}),/intercepts pointer events/);
      await f.page.mouse.move(0,0);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.videoDone,true,JSON.stringify(result));
      const state=await inspect(f);assert.equal(state.nativeEnds,1);assert.equal(state.drags,1);assert.equal(state.plays,1);assert.deepEqual(state.trusted,[true]);assert.ok(Math.abs(state.seeks[0]-(state.duration-1))<.2);
    }finally{await f.page.close();}
  });
  await t.test('an unrelated modal blocks playback and yields a concise review message without media URLs or terminal escapes',async()=>{
    const f=await setup({mode:'autohide-controls'});try{
      await f.frame.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog" style="position:fixed;inset:0;z-index:1000;background:white">Close this dialog first</div>'));
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/播放器控件操作超时或被其他界面遮挡/);assert.doesNotMatch(result.message,/https?:|locator\.hover|Call log|\u001b/);
      const state=await inspect(f);assert.equal(state.plays,0);assert.equal(state.drags,0);assert.equal(state.paused,true);assert.equal(state.nativeEnds,0);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  for(const mode of ['blocked','inert','end-clamp','popup'])await t.test(`a ${mode} player stops safely without claiming completion or repeating a drag`,async()=>{
    const f=await setup({mode});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.videoDone,undefined);const state=await inspect(f);assert.ok(state.drags<=1);assert.equal(state.paused,true);assert.equal(f.store.data.bank.length,0);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('late-loading quiz fields use the ordinary question path and never become a passive video',async()=>{
    const f=await setup();try{
      const wait=Automation.prototype.waitQuestions.bind(f.engine);await f.frame.evaluate(()=>setTimeout(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<fieldset><legend>Choose an answer.</legend><label><input type="radio" name="q">True</label><label><input type="radio" name="q">False</label></fieldset>'),150));
      const snapshot=await wait(f.task,f.page,f.settings,new AbortController().signal,{allowUnsupported:true,timeout:1900});assert.equal(snapshot.videoView,undefined);assert.equal(snapshot.questions.length,1);const state=await inspect(f);assert.equal(state.plays,0);assert.equal(state.drags,0);
    }finally{await f.page.close();}
  });
  await t.test('stopping after the seek prevents the play click and leaves the real player paused',async()=>{
    const f=await setup({mode:'autohide-controls'}),controller=new AbortController();try{
      const add=f.store.addLog.bind(f.store);f.store.addLog=(task,message,...args)=>{add(task,message,...args);if(/已核对进度条/.test(message))controller.abort(new Error('stop-real-video'));};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),/stop-real-video/);const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.plays,0);assert.equal(state.paused,true);assert.equal(state.ended,false);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('stopping after the final-second play click pauses the real video without repeating the drag',async()=>{
    const f=await setup({mode:'autohide-controls'}),controller=new AbortController();try{
      const add=f.store.addLog.bind(f.store);f.store.addLog=(task,message,...args)=>{add(task,message,...args);if(/已确认视频从末尾/.test(message))controller.abort(new Error('stop-playing-video'));};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),/stop-playing-video/);const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.paused,true);assert.equal(state.ended,false);assert.deepEqual(state.actions.map(action=>action.kind),['drag','play','pause']);
    }finally{await f.page.close();}
  });
  await t.test('pausing video work pauses playback and excludes the pause from the final-second timeout',async()=>{
    const f=await setup({mode:'autohide-controls'});try{
      const add=f.store.addLog.bind(f.store),gate=f.engine.gate.bind(f.engine);let paused=false;
      f.store.addLog=(task,message,...args)=>{add(task,message,...args);if(!paused&&/已确认视频从末尾/.test(message)){paused=true;task.status='paused';}};
      f.engine.gate=async(task,signal)=>{if(task.status==='paused'){assert.equal((await inspect(f)).paused,true);await new Promise(resolve=>setTimeout(resolve,3000));task.status='running';}return gate(task,signal);};
      assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).videoDone,true);assert.equal(paused,true);const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.nativeEnds,1);assert.ok(state.plays>=3);
    }finally{await f.page.close();}
  });
  await t.test('a visible iframe player is sought through its actual on-screen track coordinates',async()=>{
    const f=await setup({iframe:true,mode:'autohide-controls'});try{assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).videoDone,true);const state=await inspect(f);assert.equal(state.drags,1);assert.equal(state.nativeEnds,1);}finally{await f.page.close();}
  });
  await t.test('an already naturally-ended video is checked without replaying or seeking again',async()=>{
    const f=await setup();try{
      await f.frame.locator('.vjs-play-control').click();let record=await f.engine.readVideoView(f.page,f.task,f.settings);await dragVideoProgress(f.page,record.frame,record,record.duration-.5);await f.frame.waitForFunction(()=>document.querySelector('video').ended,undefined,{timeout:2500});
      const before=await inspect(f);assert.equal((await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal)).videoDone,true);const after=await inspect(f);assert.equal(after.plays,before.plays);assert.equal(after.drags,before.drags);
    }finally{await f.page.close();}
  });
  await t.test('a formerly skipped video is cleared only after its real ending and delayed directory save, with no bank row',async()=>{
    const directory=path.join(root,'passive-video-learning'),store=await new Store(directory,{env:{}}).load(),f=await setup({store});
    try{
      await store.rememberManualEntry(f.task,{});const entry={key:f.task.entryKey,title:videoViewTitle,path:['Active reading','Analyzing writing techniques'],required:true,pending:true,completed:false};let checks=0;
      f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;f.engine.refreshTaskDirectory=async task=>{if(!f.page.isClosed()&&(await inspect(f)).ended)entry.completed=++checks>=3;task.requiredTotal=1;task.requiredCompleted=entry.completed?1:0;return {ready:true,activeUnitId:task.unitId,entries:[{...entry}]};};
      await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(f.task.requiredCompleted,1);assert.equal(checks,3);assert.equal(store.findManualEntry(f.task),null);assert.equal(store.data.bank.length,0);assert.equal(f.page.isClosed(),true);await store.flush();
      const restored=await new Store(directory,{env:{}}).load();assert.equal(restored.findManualEntry(f.task),null);assert.equal(restored.data.bank.length,0);await restored.flush();
    }finally{if(!f.page.isClosed())await f.page.close();await store.flush();}
  });
  await t.test('a native ended event alone leaves an unsaved directory task waiting for review without replay',async()=>{
    const f=await setup(),controller=new AbortController();try{
      const entry={key:f.task.entryKey,title:videoViewTitle,path:['Writing'],required:true,pending:true,completed:false};f.engine.courseDirectory=async()=>({page:{}});f.engine.openRequiredEntry=async()=>f.page;f.engine.refreshTaskDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});
      const wait=f.engine.waitTaskCompletion.bind(f.engine);f.engine.waitTaskCompletion=(task,catalog,page,entry,signal,options)=>wait(task,catalog,page,entry,signal,{...options,delayMs:0});const gate=f.engine.gate.bind(f.engine);
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){assert.equal((await inspect(f)).drags,1);controller.abort(new Error('video-directory-not-saved'));}return gate(task,signal);};
      await assert.rejects(f.engine.runTask(f.task,{},f.settings,controller.signal),/video-directory-not-saved/);assert.equal(f.task.status,'review');assert.equal((await inspect(f)).nativeEnds,1);assert.equal(f.page.isClosed(),false);
    }finally{await f.page.close();}
  });
  await t.test('a passive-video preview returns metadata without starting playback or seeking',async()=>{
    const f=await setup();try{
      f.store.data.tasks=[];f.store.data.courses=[{id:f.task.courseId}];const entry={key:f.task.entryKey,title:videoViewTitle,required:true,pending:true};f.engine.courseDirectory=async()=>({page:{}});f.engine.prepareDirectory=async()=>({ready:true,activeUnitId:f.task.unitId,entries:[entry]});f.engine.openRequiredEntry=async()=>f.page;
      const result=await f.engine.previewMedia({courseId:f.task.courseId,unitId:f.task.unitId,entryKey:f.task.entryKey,solve:false});assert.equal(result.kind,'video-view');assert.equal(result.videoView.controlsReady,true);assert.equal(result.videoView.paused,true);assert.equal(result.videoView.ended,false);assert.equal(result.written,false);assert.equal(result.submitted,false);assert.deepEqual(result.questions,[]);
    }finally{if(!f.page.isClosed())await f.page.close();}
  });
}
