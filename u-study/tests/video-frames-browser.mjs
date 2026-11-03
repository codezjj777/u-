import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {askModel} from '../answer-provider.mjs';
import {imageAsset} from '../image-materials.mjs';
import {collectQuestionsFromDOM} from '../platform-dom.mjs';
import {pictureBytes} from './fixtures/picture-exercise.mjs';
import {observationHTML,observationAnswers,observationTranscript} from './fixtures/video-observation.mjs';
const frames=Array.from({length:12},(_,i)=>({...imageAsset(pictureBytes(i+1)),time:3+i*6,label:`Video frame ${i+1}/12 @ 00:${String(3+i*6).padStart(2,'0')}.00 (sampled, not continuous video)`}));
export async function videoFramesBrowserCases(t,context,root){
  const open=async()=>{const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/video-observation');await page.setContent(observationHTML());return page;};
  await t.test('visual video questions receive twelve timestamped image blocks with transcript without playing or seeking the course video',async()=>{
    const page=await open(),store={directory:root,data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store),task={id:'video-images',status:'running',logs:[],answered:0,pages:0};let requests=0,decoded=0;
    try{
      engine.media.resolve=async()=>({text:observationTranscript,source:'fixture transcript'});engine.videoFrames={resolve:async(_record,options)=>{decoded++;assert.equal(options.count,12);return frames;}};
      engine.askModel=(q,settings,key,signal,options)=>askModel(q,settings,key,signal,{...options,fetchImpl:async(_url,init)=>{
        const sent=JSON.parse(init.body),content=sent.messages[1].content;assert.equal(content.length,13);assert.ok(content.slice(1).every(item=>item.type==='image_url'&&item.image_url.url.startsWith('data:image/png;base64,')));assert.ok(JSON.parse(content[0].text).passage.includes(observationTranscript));assert.match(sent.messages[0].content,/samples do not establish uninterrupted behavior/);requests++;
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:[observationAnswers[requests-1]]})}}]}));
      }});
      store.apiKey='fixture';const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true,autoSubmit:false,endpoint:'https://fixture.example.test/v1/chat/completions',model:'vision-fixture'},new AbortController().signal);
      assert.equal(result.review,true,result.message);assert.equal(requests,2);assert.equal(decoded,1);assert.deepEqual(await page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),observationAnswers);
      assert.deepEqual(await page.evaluate(()=>({play:window.playEvents,seek:window.seekEvents,time:document.querySelector('video').currentTime,submitted:window.submitted})),{play:0,seek:0,time:0,submitted:false});assert.equal(await page.locator('[data-ustudy-video-frames] img').count(),12);
    }finally{await page.close();}
  });
  await t.test('all-correct video exercise records both questions, the complete transcript and all sampled frames in one reusable bank entry',async()=>{
    const store=await new Store(path.join(root,'video-frame-bank'),{env:{}}).load(),scope={courseId:'visual-book',unitId:'visual-unit',entryKey:JSON.stringify(['visual-unit',['Inside view','Conversation','Conversation 2'],'Exercise 2'])};
    try{for(const reuse of [false,true]){
      const page=await open();let done=false,asked=0;
      try{
        const engine=new Automation(store),task={...scope,id:'visual-bank-'+reuse,status:'running',logs:[],answered:0,pages:0,manualItems:[],unitLabel:'Unit 1'};store.data.tasks=[task];store.apiKey='fixture';engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>page;
        engine.media.resolve=async()=>({text:observationTranscript,source:'fixture'});engine.videoFrames={resolve:async()=>frames};engine.askModel=async q=>{assert.equal(reuse,false);assert.equal(q.images.length,12);return {answers:[observationAnswers[asked++]],indexes:[]};};
        engine.refreshTaskDirectory=async()=>{if(!page.isClosed())done ||= await page.evaluate(()=>window.submitted);return {ready:true,activeUnitId:scope.unitId,entries:[{key:scope.entryKey,title:'Exercise 2',path:['Inside view','Conversation','Conversation 2'],required:true,completed:done,pending:!done}]};};const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{if(task.status==='review')assert.fail(task.logs.at(-1)?.message);return gate(task,signal);};
        await engine.runTask(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(task.status,'completed');assert.equal(asked,reuse?0:2);assert.equal(store.data.bank.length,1);const saved=store.data.bank[0];assert.equal(saved.pages.length,1);assert.equal(saved.pages[0].questions.length,2);assert.equal(saved.imageAssets.length,12);assert.ok(saved.pages[0].questions.every(q=>q.images.length===12&&q.context.includes(observationTranscript)));assert.deepEqual(saved.pages[0].questions.map(q=>q.answer[0]),observationAnswers);
      }finally{if(!page.isClosed())await page.close();}
    }}finally{await store.flush();}
  });
  for(const mode of ['collapsed','late-closing'])await t.test(`twelve extracted frames finish image preparation with a ${mode} study notice without replaying video`,async()=>{
    const page=await open(),engine=new Automation({directory:root,data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}}),task={id:'video-notice-'+mode,status:'running',logs:[],answered:0,pages:0};let captured=0,asked=0;
    try{
      engine.media.resolve=async()=>({text:observationTranscript,source:'fixture'});engine.videoFrames={resolve:async()=>frames};
      const capture=engine.imageReader.capture.bind(engine.imageReader);engine.imageReader.capture=async(...args)=>{
        const image=await capture(...args);if(++captured===12)await page.evaluate(mode=>{
          const style=document.createElement('style');style.textContent='@keyframes noticeExit {from {opacity:1} to {opacity:0}} .ant-zoom-leave-active {animation:noticeExit 30s linear paused} .ant-modal-wrap{position:fixed;inset:0;background:#0003;z-index:1000} .ant-modal{position:absolute;left:100px;top:100px;background:white;padding:24px}';document.head.append(style);
          const wrap=document.createElement('div');wrap.className='ant-modal-wrap';wrap.innerHTML='<div class="ant-modal"><p>本单元学习时间：2026-09-01至2026-12-18</p><p>是否必修：必修</p><button>我知道了</button></div>';document.body.append(wrap);const modal=wrap.firstElementChild,button=modal.querySelector('button');window.acks=0;
          if(mode==='collapsed'){modal.style.transform='scale(0)';wrap.style.pointerEvents='none';}
          else {Object.defineProperty(button,'innerText',{get:()=>''});button.onclick=()=>{window.acks++;modal.classList.add('ant-zoom-leave-active');modal.addEventListener('animationend',()=>wrap.remove(),{once:true});modal.getAnimations();};}
        },mode);return image;
      };
      engine.askModel=async q=>{assert.equal(q.images.length,12);assert.ok(q.context.includes(observationTranscript));return {answers:[observationAnswers[asked++]],indexes:[]};};
      const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true,autoSubmit:false},new AbortController().signal);
      assert.equal(result.review,true,result.message);assert.equal(asked,2,result.message);assert.equal(captured,12);assert.equal(await page.evaluate(()=>window.acks),mode==='collapsed'?0:1);assert.deepEqual(await page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),observationAnswers);
      assert.deepEqual(await page.evaluate(()=>[window.playEvents,window.seekEvents,window.submitted]),[0,0,false]);
    }finally{await page.close();}
  });
  for(const mode of ['failure','changed'])await t.test(`video frame ${mode} stops before AI, filling or submission`,async()=>{
    const page=await open(),engine=new Automation({directory:root,data:{tasks:[],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}}),task={id:'video-'+mode,status:'running',logs:[],answered:0,pages:0};
    try{
      engine.media.resolve=async()=>({text:observationTranscript,source:'fixture'});engine.videoFrames={resolve:async()=>{if(mode==='failure')throw new Error('fixture decode failed');await page.locator('video').evaluate(el=>el.src='https://ucontent.unipus.cn/offline-recognition/changed-video.mp4');return frames;}};engine.askModel=async()=>assert.fail('no model call without verified video frames');
      const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(result.review,true);assert.match(result.message,/视频画面/);assert.deepEqual(await page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','']);assert.equal(await page.evaluate(()=>window.submitted),false);
    }finally{await page.close();}
  });
}
