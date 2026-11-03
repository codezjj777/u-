import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {readExerciseNavigationFromDOM} from './platform-dom.mjs';
import {installOralInputFromDOM,oralInputActionFromDOM,reserveOralPage} from './oral-input.mjs';
import {prepareOralDraft} from './oral-draft.mjs';
import {prepareShortOralAudio} from './oral-short.mjs';
export {validateRetelling} from './oral-draft.mjs';

export const ORAL_HANDLER='oral-recording-v2';

export async function inspectOralLessonFromDOM(){
  // Heavy speaking SDK bundles may arrive after the lesson header. Keep the
  // normal read-only inspection on that page until its body has rendered.
  const deadline=Date.now()+15000;
  while(document.querySelector('.question-wrap')&&!document.querySelector('.question-wrap')?.children.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,200));
  let animationFramesActive=false;
  if(typeof requestAnimationFrame==='function'){let animationFrame,timer;animationFramesActive=await Promise.race([new Promise(resolve=>{animationFrame=requestAnimationFrame(()=>resolve(true));}),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),200);})]);clearTimeout(timer);cancelAnimationFrame(animationFrame);}
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden=true],[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const root=document.querySelector('.pc-main-container,.question-common-abs-question-container,main');let exerciseHTML='';
  if(root){const copy=root.cloneNode(true);copy.querySelectorAll('script,style,input,textarea,aside').forEach(el=>el.remove());for(const el of [copy,...copy.querySelectorAll('*')])for(const attr of [...el.attributes])if(/src|href|token|cookie|secret|password|value/i.test(attr.name)||attr.name.startsWith('on')||/https?:\/\/|^data:|^blob:/.test(attr.value))el.removeAttribute(attr.name);exerciseHTML=copy.outerHTML.slice(0,120000);}
  const scripts=[...document.scripts].map(el=>el.src).filter(src=>{try{const url=new URL(src);return url.origin===location.origin&&!url.search&&!url.hash;}catch{return false;}});
  const editors=[...document.querySelectorAll('textarea,[contenteditable=true],[contenteditable="plaintext-only"]')].map(el=>{const ancestors=[];for(let node=el;node&&ancestors.length<12;node=node.parentElement)ancestors.push({tag:node.tagName,className:String(node.className||'')});return {tag:el.tagName,placeholder:el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||'',visible:visible(el),ancestors};});
  const roleChoices=[...document.querySelectorAll('.role-list .role')].map(el=>({name:clean(el.querySelector('.label')?.textContent),values:[...el.querySelectorAll('input')].map(input=>input.value||input.getAttribute('value')),visible:visible(el)}));
  return {title:document.title,exerciseHTML,scripts,editors,roleChoices,dialogs:[...document.querySelectorAll('[role=dialog],.ant-modal')].map(el=>{const style=getComputedStyle(el),box=el.getBoundingClientRect();return {text:clean(el.innerText||el.textContent).slice(0,1200),visible:visible(el),ariaHidden:el.getAttribute('aria-hidden'),className:String(el.className),display:style.display,visibility:style.visibility,opacity:style.opacity,pointerEvents:style.pointerEvents,bounds:{x:box.x,y:box.y,width:box.width,height:box.height},buttons:[...el.querySelectorAll('button,a,[role=button]')].map(button=>({text:clean(button.innerText||button.textContent),visible:visible(button),disabled:button.disabled===true,className:String(button.className)}))};}),bodyReady:document.readyState,visibilityState:document.visibilityState,animationFramesActive};
}

// Public lesson content and recording controls only; no recorder internals,
// answer keys, platform completion flags or account data are inspected.
export function readOralActivityFromDOM(){
  const visible=el=>{if(!el?.getClientRects().length)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const text=el=>clean(el.innerText||el.textContent);
  const retelling=value=>/\bretell\b[\s\S]{0,160}\b(?:own words|story)\b/i.test(value);
  const candidates=[...document.querySelectorAll('[data-ipublish-question-group-type^="oral_"],.layout-container,main')].filter(visible).filter(el=>{
    const scope=el.closest('.layout-container,main')||el;
    const recordingDirections=[...scope.querySelectorAll('.abs-direction,[data-question-direction]')].filter(visible).some(node=>/\brecord\b|录音|口语|录制/i.test(text(node)));
    return recordingDirections&&[...el.querySelectorAll('.p-oral-personal-state .ucomp-recorder .button-record')].some(visible)||retelling(text(el))&&/录音|record/i.test(text(el));
  });
  const roots=candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));if(!roots.length)return null;
  if(roots.length!==1)return {recognized:true,ready:false,issue:'同时有多组口语录音任务，尚未确认录音归属。'};
  const root=roots[0],nodes=[root,...root.querySelectorAll('p,div,span,h1,h2,h3,h4')].filter(visible);
  // The same recorder hosts both a retelling and subsequent spoken questions.
  // Read its whole question container, excluding the changing grade beside it.
  const sentences=[...root.querySelectorAll('.p-oral-personal-state .oral-personal-state-sentence-container')].filter(visible);
  let prompts;
  if(sentences.length)prompts=sentences.map(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.p-oral-personal-state-score_layout,.score_layout,.oral-personal-state__reply,.ucomp-recorder').forEach(node=>node.remove());return text(copy);}).filter(Boolean);
  else prompts=[...root.querySelectorAll('.p-oral-personal-state > p')].filter(visible).map(text).filter(Boolean);
  if(!prompts.length)prompts=nodes.map(text).filter(value=>/^\d*[.、\s]*Retell\b[^.]{0,300}(?:own words|story)[^.]*[.!]?$/i.test(value));
  const unique=[...new Set(prompts)],prompt=unique.length===1?unique[0]:'';
  if(!prompt||prompt.length>4000)return {recognized:true,ready:false,issue:'口语题缺少唯一、完整的作答要求。'};
  const kind=retelling(prompt)?'retell':'response';
  const body=root.closest('.pc-main-container,main')||root,scope=root.closest('.layout-container,main')||root;
  const controls=[...root.querySelectorAll('button,a,[role=button],[class*="record"],[class*="Record"],[class*="microphone"],[class*="Microphone"],.anticon-audio,.anticon-voice')].filter(visible);
  const info=controls.map(el=>({tag:el.tagName,label:clean(el.getAttribute('aria-label')||el.getAttribute('title')||text(el)).slice(0,250),className:String(el.className?.baseVal??el.className??'').slice(0,250)}));
  const fields=[...scope.querySelectorAll('textarea,select,input:not([type]),input[type=text],input[type=radio],input[type=checkbox],[contenteditable=true],[role=combobox]')].filter(el=>visible(el)&&!el.disabled&&!el.readOnly);
  const materialRoots=[...body.querySelectorAll('.layout-material-container,.question-common-abs-material,.passage,[data-ipublish-question-group-type="rich_text_read_group"]')].filter(visible);
  const outer=materialRoots.filter(el=>!materialRoots.some(other=>other!==el&&other.contains(el)));
  const context=[...new Set(outer.map(text).filter(Boolean))].join('\n\n');
  const instructions=[...scope.querySelectorAll('.abs-direction,[data-question-direction]')].filter(visible).map(text).join(' ');
  const audio=[...root.querySelectorAll('audio')].filter(el=>el.currentSrc||el.getAttribute('src')).map(el=>({duration:Number.isFinite(el.duration)?el.duration:null,readyState:el.readyState,source:el.currentSrc||el.getAttribute('src'),paused:el.paused}));
  const clone=root.cloneNode(true);for(const el of [clone,...clone.querySelectorAll('*')])for(const attr of [...el.attributes])if(/src|href|token|cookie|secret|password|value/i.test(attr.name)||attr.name.startsWith('on')||/https?:\/\/|^data:|^blob:/.test(attr.value))el.removeAttribute(attr.name);
  root.setAttribute('data-ustudy-oral-root','true');
  const clocks=text(root).match(/\b\d{1,2}:\d{2}\b/g)||[];
  const enabled=el=>el&&visible(el)&&!el.closest('[disabled],[aria-disabled=true],.disabled');
  const recordButtons=[...root.querySelectorAll('.p-oral-personal-state .ucomp-recorder .button-record')].filter(visible);
  const record=recordButtons.length===1?recordButtons[0]:null;
  // The site's idle button also says "end recording". Its actual stop icon,
  // rather than that label or the countdown, distinguishes a live recording.
  const recording=!!record&&(record.getAttribute('aria-pressed')==='true'||!!record.querySelector('svg path[d^="M645.744434,351"],svg.recordCircle,[data-oral-stop-icon]'));
  const replay=[...root.querySelectorAll('.audio-replay')].filter(enabled);
  const saved=replay.length===1&&![...root.querySelectorAll('.record-count-down')].some(visible);
  const clock=clocks.length===1?clocks[0].split(':').reduce((minutes,seconds)=>Number(minutes)*60+Number(seconds)):0;
  const percent=scope.querySelector('.layout-progress-container .percent')?.style.width||'';
  const progress=/^\d+(?:\.\d+)?%$/.test(percent)?Number(percent.slice(0,-1)):null;
  const issue=fields.length?'口语页同时有其他作答控件，需要核对题目边界。':recordButtons.length!==1?'尚未找到唯一的口语录音按钮。':recording?'当前页面已有录音正在进行，尚未替换输入。':!saved&&(!enabled(record)||clock<10||clock>600)?'录音按钮或录音时间限制尚未就绪。':'';
  if(record)record.setAttribute('data-ustudy-oral-record','true');if(replay.length===1)replay[0].setAttribute('data-ustudy-oral-replay','true');
  const notices=[...document.querySelectorAll('.ant-message-notice,[role=alert]')].filter(visible).map(text).filter(Boolean).map(value=>value.slice(0,500));
  const saving=[...root.querySelectorAll('.ant-spin-spinning,[aria-busy=true],[data-uploading=true],.uploading,.is-uploading')].some(visible);
  const uploadError=notices.find(value=>/(?:录音|音频|上传|保存|网络)[\s\S]{0,60}(?:失败|错误|超时|异常)|(?:upload|recording|saving)[\s\S]{0,60}(?:failed|error|timed out)/i.test(value))||'';
  return {recognized:true,ready:!issue,kind,prompt,instructions,context,controls:info,clocks,audio,progress,recording,saved,saving,uploadError,maxSeconds:saved?180:clock,recordSelector:record?'[data-ustudy-oral-record="true"]':'',replaySelector:replay.length===1?'[data-ustudy-oral-replay="true"]':'',rootSelector:'[data-ustudy-oral-root="true"]',issue,hasOtherFields:fields.length>0,notices,diagnostics:{rootHTML:clone.outerHTML.slice(0,60000)}};
}

export function collectOralSourceFromDOM(){
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden=true]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  let roots=[...document.querySelectorAll('.question-rich-text-read .textContainer,.layout-material-container,.question-common-abs-material,.passage,[data-ipublish-question-group-type="rich_text_read_group"],.p-rich-text-read,.rich-text-read')].filter(visible);
  // Standalone Text leaves sometimes use the entire layout body instead of
  // the split-view material wrapper. The caller verifies the Text leaf first.
  if(!roots.length&&![...document.querySelectorAll('main textarea,main input,main [contenteditable=true]')].some(visible))roots=[...document.querySelectorAll('.layoutBody-container')].filter(visible);
  const outer=roots.filter(el=>!roots.some(other=>other!==el&&other.contains(el)));
  const context=[...new Set(outer.map(el=>String(el.innerText||el.textContent).replace(/\s+/g,' ').trim()).filter(Boolean))].join('\n\n');
  const loading=[...document.querySelectorAll('.ant-spin-spinning,[aria-busy=true]')].some(visible);
  return {context,complete:!loading&&context.length>=200&&context.length<=60000};
}

export function oralIdentity(oral){return createHash('sha256').update(JSON.stringify([oral.prompt,oral.instructions,oral.context,oral.progress,oral.navigation?.key])).digest('hex');}

export function isOralRetellEntry(task){
  try{const [unit,parts,title]=JSON.parse(task.entryKey);return unit===task.unitId&&Array.isArray(parts)&&parts.includes('Getting the idea')&&/^Exercise\s+\d+$/i.test(title);}catch{return false;}
}

export function assertOralEntry(task,page,oral){
  let entry;try{entry=JSON.parse(task.entryKey);}catch{throw new Error('口语题缺少完整目录标识。');}
  let url;try{url=new URL(page.url());}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||!/(^|\.)unipus\.cn$/.test(url.hostname)||entry[0]!==task.unitId||page.url()!==oral.pageURL||!oral.navigation?.known||oral.navigation.title!==entry[2]||!entry[1].includes(oral.navigation.chapter)||oral.frame?.url()!==oral.frameURL)throw new Error('口语题的课程、目录或页面已变化，尚未录入或提交音频。');
  if(!oral.prompt||oral.hasOtherFields)throw new Error('口语题边界尚未确认，尚未录入或提交音频。');
}

export function oralRecordingIdentity(oral){
  if(!oral?.saved||oral.audio?.length!==1||!(oral.audio[0].duration>0)||!oral.audio[0].source)return '';
  let resource;try{const url=new URL(oral.audio[0].source);resource=url.origin+url.pathname;}catch{return '';}
  return createHash('sha256').update(JSON.stringify([oral.key,resource,Math.round(oral.audio[0].duration*100)])).digest('hex');
}

async function reviewExistingRecording(engine,task,page,oral,settings,signal){
  delete task.oralReview;const recordingKey=oralRecordingIdentity(oral);
  if(!recordingKey)return {review:true,message:'本题已有录音，回放信息尚未就绪，已保留现有录音。',oralHandler:ORAL_HANDLER};
  try{
    engine.store.addLog(task,'已有录音，正在核对本题的本地复述草稿和试听音频。');
    const source=await loadOralStory(engine,task,page,oral,signal),check=async()=>{await engine.gate(task,signal);const fresh=await engine.readOralActivity(page);if(!fresh||fresh.key!==oral.key||oralRecordingIdentity(fresh)!==recordingKey)throw new Error('准备重录期间，当前题目或已有录音发生变化。');assertOralEntry(task,page,fresh);};
    const prepared=await prepareOralDraft({directory:engine.store.directory||'.runtime',scope:task,oral,source,settings,checkpoint:check,signal,ask:async()=>{throw new Error('尚未找到与本题匹配的本地复述草稿。');},speech:{synthesize:async()=>{throw new Error('需要先准备本地复述音频。');}}});
    await check();task.oralReview={ready:true,entryKey:task.entryKey,recordingKey,draftKey:prepared.reviewKey,previousSeconds:oral.audio[0].duration,seconds:prepared.audio.duration};engine.store.changed();
    return {review:true,oralHandler:ORAL_HANDLER,message:`本题已有 ${oral.audio[0].duration.toFixed(1)} 秒录音，已找到并核对 ${Math.round(prepared.audio.duration)} 秒本地合成音频。点击「用本地音频重录」可替换当前录音，并按任务设置保存提交。`};
  }catch(error){signal?.throwIfAborted();return {review:true,oralHandler:ORAL_HANDLER,message:`本题已有录音，已保留现有录音。${error.message} 尚未覆盖或提交。`};}
}

export async function loadOralStory(engine,task,page,oral,signal){
  if(oral.context?.length>=200)return {context:oral.context,sourceTitle:'当前题页原文'};
  const course=engine.store.data.courses.find(item=>item.id===task.courseId);if(!course)throw new Error('没有找到当前口语题对应的课程。');
  const catalog=await engine.courseDirectory(course,{signal}),directory=await engine.prepareDirectory(catalog.page,task.unitId,{signal});
  const parts=JSON.parse(task.entryKey)[1],section=parts[0];
  const matches=directory.entries.filter(entry=>entry.title==='Text'&&entry.path[0]===section&&entry.path.includes('Reading in detail'));
  if(matches.length!==1)throw new Error('没有找到同一单元、同一阅读板块的唯一故事原文，尚未生成复述。');
  const target=matches[0],source=catalog.page,beforeURL=source.url();let popup,reference;
  const onPopup=value=>{popup=value;engine.pages.track(value,'oral-reference');};source.on('popup',onPopup);
  try{
    await engine.gate(task,signal);assertOralEntry(task,page,oral);await directory.frame.locator(target.selector).click({noWaitAfter:true});
    reference=await engine.waitCourseNavigation(source,()=>popup,beforeURL,{signal});engine.pages.track(reference,'oral-reference');
    if(reference===source){const context=await engine.ensureBrowser();catalog.page=await engine.backgroundPage(context);await engine.pages.replaceCatalog(catalog.page,{courseId:task.courseId});await engine.navigate(catalog.page,catalog.url,{signal});engine.openedCourses.set(task.courseId,{page:catalog.page,url:catalog.url});}
    const deadline=Date.now()+30000;let stable='';
    while(Date.now()<deadline){
      await engine.gate(task,signal);assertOralEntry(task,page,oral);
      const state=await engine.readLearningState(reference);if(state.login)throw new Error('故事原文页登录已失效，尚未生成复述。');
      if(state.studyNotice&&!state.loading)for(const frame of await engine.activeFrames(reference)){
        try{if(await engine.action(frame,'notice','',{signal}))break;}
        catch(error){signal?.throwIfAborted();if(!/Timeout|detached|destroyed|navigation/i.test(error.message))throw error;}
      }
      if(!state.loading&&!state.studyNotice){
        const materials=[];
        for(const frame of await engine.activeFrames(reference)){
          const navigation=await frame.evaluate(readExerciseNavigationFromDOM).catch(()=>null),material=await frame.evaluate(collectOralSourceFromDOM).catch(()=>null);
          const textLeaf=navigation?.title==='Text'||!navigation?.title&&navigation?.chapter==='Text';
          if(textLeaf&&navigation.breadcrumbs.length>=2&&navigation.breadcrumbs.slice(0,2).join('\n')===oral.navigation.breadcrumbs.slice(0,2).join('\n')&&material?.complete)materials.push(material);
        }
        if(materials.length===1){if(stable===materials[0].context)return {...materials[0],sourceTitle:'Reading in detail / Text'};stable=materials[0].context;}else stable='';
      }
      await sleep(350,undefined,{signal});
    }
    const diagnostics=[];for(const frame of await engine.activeFrames(reference))diagnostics.push({navigation:await frame.evaluate(readExerciseNavigationFromDOM).catch(()=>null),material:await frame.evaluate(collectOralSourceFromDOM).catch(()=>null),page:await frame.evaluate(inspectOralLessonFromDOM).catch(()=>null)});
    const folder=path.resolve(engine.store.directory||'.runtime','oral-drafts');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'source-inspection.json'),JSON.stringify(diagnostics,null,2));
    throw new Error('同单元原文尚未完整载入，已保存只读诊断，尚未开始录音。');
  }finally{source.off('popup',onPopup);if(reference&&reference!==page)await engine.pages.release(reference);else if(popup&&popup!==page)await engine.pages.release(popup);}
}

async function waitOralSaved(check,signal){
  const deadline=Date.now()+120000;let stable=0;
  while(Date.now()<deadline){
    const fresh=await check();
    if(fresh.uploadError)throw new Error('课程提示录音上传或保存失败，已保留题页，请检查网络后重试。');
    if(fresh.saved&&!fresh.recording&&!fresh.saving){if(++stable>=2)return fresh;}else stable=0;
    await sleep(500,undefined,{signal});
  }
  throw new Error('课程尚未显示录音已保存，已保留题页，尚未提交。');
}

async function continueOralPage(engine,task,page,oral,settings,signal,{check,replace=false}){
  const review=message=>({review:true,message,oralHandler:ORAL_HANDLER});
  const checkpoint=async()=>{const fresh=await check();if(!fresh.saved||fresh.recording||fresh.saving||fresh.uploadError)throw new Error('当前口语录音的保存状态已变化，尚未翻页或提交。');};
  await checkpoint();const snapshot={oralActivity:oral,signature:oral.key,navigation:oral.navigation,pageURL:oral.pageURL,frame:oral.frame,questions:[]};
  const internal=oral.progress>0&&oral.progress<100;
  if(!settings.autoSubmit&&!internal)return review('口语录音已保存，请在 U校园检查并提交，再点击「继续核对」。');
  for(const kind of internal?['next','submit']:['submit','next']){
    const selector=kind==='next'?settings.nextSelector||'':settings.submitSelector||'',candidates=[];
    for(const frame of await engine.activeFrames(page)){
      const report=await frame.evaluate((await import('./platform-dom.mjs')).findActionInDOM,{kind,selector,includeDiagnostics:true});if(report?.count>1)throw new Error('口语题有多个保存入口，需要核对。');if(report?.selector)candidates.push(frame);
    }
    if(candidates.length>1)throw new Error('多个页面同时显示保存入口，尚未提交口语题。');
    if(!candidates.length)continue;
    if(kind==='submit'&&!settings.autoSubmit)return review('口语录音已保存，请在 U校园检查后提交，再点击「继续核对」。');
    if(await engine.action(candidates[0],kind,selector,{signal,checkpoint})){
      engine.store.addLog(task,kind==='next'?'已保存口语录音并点击「下一题」，正在核对本项目后续页面。':'已提交口语录音，正在核对平台结果与目录状态。');
      if(kind==='next'){
        if(replace){
          const next=await engine.waitNextExercisePage(task,page,settings,snapshot,signal);
          if(next.feedback)return {oralDone:true,feedback:next.feedback};
          return {oralDone:true,review:true,message:'这段已确认的合成录音已保存；后续题页已保留，请核对下一题后再继续，本次未生成或发送后续题目的答案。'};
        }
        return {nextPage:true,oralDone:true,snapshot,signature:oral.key,entryURL:oral.pageURL};
      }
      return {oralDone:true,feedback:await engine.waitSubmissionFeedback(task,page,signal)};
    }
  }
  return review('口语录音已保存，尚未找到唯一的下一题或提交入口，请检查后点击「继续核对」。');
}

export async function runOralActivity(engine,task,page,oral,settings,signal){
  signal?.throwIfAborted();await engine.disposeExerciseLearning(task.id);engine.pages.protect(page,'oral-review');
  let reservation,bridges=[],captured=false,started=false,retryReview,token=randomUUID();
  const review=message=>({review:true,message,oralHandler:ORAL_HANDLER});
  const check=async()=>{await engine.gate(task,signal);const fresh=await engine.readOralActivity(page);if(!fresh||fresh.key!==oral.key)throw new Error('口语题或对应原文已切换，已停止录音和提交。');assertOralEntry(task,page,fresh);return fresh;};
  try{
    assertOralEntry(task,page,oral);if(!oral.ready)return review(oral.issue||'口语录音控件尚未就绪。');
    const replacement=task.oralReplacement,short=settings.oralMode!=='retell'&&!replacement,oldRecording=oralRecordingIdentity(oral),replace=oral.saved&&replacement?.entryKey===task.entryKey&&oldRecording&&replacement.recordingKey===oldRecording;
    if(!short&&oral.kind==='response')return review('当前是口语问答题，请在「短录音（5 秒）」模式下重新启动对应任务，尚未重录或提交。');
    if(oral.saved&&!replace&&!short)return reviewExistingRecording(engine,task,page,oral,settings,signal);
    if(replacement&&!replace)return review('待替换的口语录音已变化，请重新核对并确认本题，尚未开始录音。');
    let source,prepared;
    if(short){
      if(!oral.saved){prepared=await prepareShortOralAudio({directory:engine.store.directory||'.runtime',scope:task,oral,speech:engine.oralSpeech,checkpoint:check,signal});engine.store.addLog(task,prepared.reused?'正在复用 5 秒本地短语音，不读取原文或请求 AI。':'5 秒本地短语音已合成，后续录音小题将复用此音频。');}
    }else{
      if(!settings.aiEnabled||!engine.store.apiKey)return review('自动口语复述需要先启用并配置 AI，尚未开始录音。');
      engine.store.addLog(task,'已识别口语复述题，正在读取同单元的完整故事原文。');source=await loadOralStory(engine,task,page,oral,signal);await check();
      engine.store.addLog(task,`已读取故事原文（${source.context.length} 字符），正在生成可朗读的英文复述稿。`);
      prepared=await prepareOralDraft({directory:engine.store.directory||'.runtime',scope:task,oral,source,settings,apiKey:engine.store.apiKey,speech:engine.oralSpeech,ask:engine.askModel.bind(engine),checkpoint:check,signal,expectedKey:replacement?.draftKey});await check();
      if(prepared.reused)engine.store.addLog(task,'已核对并复用本题完整复述稿和合成音频，无需重复请求 AI。');
      if(replace)retryReview={ready:true,entryKey:task.entryKey,recordingKey:oldRecording,draftKey:prepared.reviewKey,previousSeconds:oral.audio[0].duration,seconds:prepared.audio.duration};
    }
    // Prime cached SDK microphone functions once. Repeated reloads would reset
    // an internal question index instead of recording the following page.
    reservation=await reserveOralPage(page,{token,pageURL:oral.pageURL});
    if(reservation.reloadRequired!==false){
      await page.reload({waitUntil:'domcontentloaded'});
      const loaded=await engine.waitQuestions(task,page,settings,signal,{timeout:30000,allowUnsupported:true});
      if(!loaded?.oralActivity||loaded.oralActivity.key!==oral.key||!loaded.oralActivity.ready||loaded.oralActivity.saved&&!replace&&!short)throw new Error('重载后的口语题状态不同，尚未录入音频。');oral=loaded.oralActivity;assertOralEntry(task,page,oral);
    }
    if(short&&oral.saved){
      await waitOralSaved(check,signal);captured=true;delete task.oralReview;task.pages++;engine.store.changed();engine.store.addLog(task,'本小题已有保存的录音，直接继续，不重复录音或回放。');
      return await continueOralPage(engine,task,page,oral,settings,signal,{check});
    }
    const {audio,folder:draft}=prepared,maxSeconds=Math.min(180,oral.maxSeconds-8);
    engine.store.addLog(task,`合成语音已准备好（${Math.round(audio.duration)} 秒，${audio.voice}），正在接入本题录音。`);
    if(replace){const deadline=Date.now()+5000;while(!oralRecordingIdentity(oral)&&Date.now()<deadline){await sleep(250,undefined,{signal});oral=await check();}if(oralRecordingIdentity(oral)!==oldRecording)throw new Error('重载后的旧录音已变化，尚未执行替换。');}
    for(const frame of await engine.activeFrames(page)){
      const frameURL=frame.url();if(!/^https:\/\/[^/]*unipus\.cn\//.test(frameURL))continue;
      await frame.evaluate(installOralInputFromDOM,{token,pageURL:frameURL,prompt:oral.prompt,waveBase64:audio.bytes.toString('base64'),maxSeconds,ownerValidated:frame!==oral.frame});bridges.push(frame);
    }
    if(!bridges.length)throw new Error('没有找到当前口语题的音频输入页面。');
    const beforeStart=await check();if(replace&&oralRecordingIdentity(beforeStart)!==oldRecording)throw new Error('开始前的旧录音已变化，尚未执行替换。');await beforeStart.frame.locator(beforeStart.recordSelector).click({timeout:5000});started=true;
    const startDeadline=Date.now()+20000;let owner;
    while(Date.now()<startDeadline){
      const fresh=await check(),used=[];for(const frame of bridges){const status=await frame.evaluate(oralInputActionFromDOM,{token,action:'status'});if(status.used)used.push(frame);}
      if(used.length>1)throw new Error('多个页面同时请求口语音频，尚未确认录音归属。');
      if(used.length===1&&fresh.recording){owner=used[0];break;}await sleep(200,undefined,{signal});
    }
    if(!owner)throw new Error('课程尚未进入可确认的录音状态，已停止合成音频输入。');
    await sleep(300,undefined,{signal});await check();await owner.evaluate(oralInputActionFromDOM,{token,action:'play'});
    engine.store.addLog(task,`课程已开始录音，正在完整录入 ${Math.round(audio.duration)} 秒的合成复述语音。`);
    const deadline=Date.now()+(audio.duration+12)*1000;let state;
    while(Date.now()<deadline){
      const fresh=await check();if(!fresh.recording)throw new Error('课程在合成语音录入完成前结束了录音，尚未提交。');
      state=await owner.evaluate(oralInputActionFromDOM,{token,action:'status'});if(state.complete)break;await sleep(250,undefined,{signal});
    }
    if(!state?.complete||!state.heard)throw new Error('合成语音未完整录入或没有检测到有效声音，尚未提交。');
    const stopping=await check();await stopping.frame.locator(stopping.recordSelector).click({timeout:5000});started=false;
    engine.store.addLog(task,'合成语音已完整录入，正在等待课程完成录音上传和保存。');
    await waitOralSaved(check,signal);captured=true;
    // The platform's saved recording control is sufficient here. Never play,
    // fetch or decode its replay source as a condition for continuing.
    await writeFile(path.join(draft,'recording.json'),JSON.stringify({status:'platform-saved',mode:short?'short':'retell',scope:{courseId:task.courseId,unitId:task.unitId,entryKey:task.entryKey},prompt:oral.prompt,sourceTitle:source?.sourceTitle,sourceCharacters:source?.context.length||0,generatedSeconds:audio.duration,verification:'complete-input-and-platform-saved',playbackChecked:false,savedAt:Date.now()},null,2));
    task.answered++;task.pages++;engine.store.changed();engine.store.addLog(task,'课程已显示录音保存成功，正在继续本题。');
    return await continueOralPage(engine,task,page,oral,settings,signal,{check,replace});
  }catch(error){
    signal?.throwIfAborted();
    try{
      const fresh=await engine.readOralActivity(page),states=[];
      if(retryReview&&oralRecordingIdentity(fresh)===retryReview.recordingKey)task.oralReview=retryReview;
      for(const frame of bridges)states.push(await frame.evaluate(()=>({input:window.__ustudyOralInput?.status(),reservation:window.__ustudyOralReservation?.status(),capabilities:{secure:window.isSecureContext,mediaDevices:!!navigator.mediaDevices,audioContext:!!window.AudioContext}})).catch(()=>null));
      const folder=path.resolve(engine.store.directory||'.runtime','oral-drafts');await mkdir(folder,{recursive:true});
      const {frame,pageURL,frameURL,navigation,audio,...report}=fresh||{};
      const recordings=(audio||[]).map(({duration,readyState,paused,source})=>{
        let sourceType='unknown';try{const url=new URL(source);sourceType=url.protocol==='data:'?(/^data:audio\/[a-z0-9.-]+/i.exec(source)?.[0]||'data:other'):url.protocol;}catch{}
        return {duration,readyState,paused,sourceType};
      });
      await writeFile(path.join(folder,'latest-attempt.json'),JSON.stringify({error:error.message.replace(/https?:\/\/\S+/g,'[course URL]').slice(0,1200),captured,started,report,audio:recordings,states},null,2));
    }catch{}
    return review(`${error.message} ${captured?'课程已保存录音，题页已保留。':'题页已保留，尚未提交口语题。'}`);
  }
  finally{
    if(started){const fresh=await engine.readOralActivity(page).catch(()=>null);if(fresh?.key===oral.key&&fresh.recording)await fresh.frame.locator(fresh.recordSelector).click({timeout:3000}).catch(()=>{});}
    for(const frame of bridges)await frame.evaluate(oralInputActionFromDOM,{token,action:'dispose'}).catch(()=>{});await reservation?.close();
  }
}
