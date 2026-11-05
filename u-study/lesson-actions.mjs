import {setTimeout as sleep} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const noticeDiagnostics=[];
async function recordNoticeDiagnostic(engine,frame,stage,{selector='',blockerKind=''}={}){
  if(!engine.store?.directory)return;
  try{
    const report=await frame.evaluate(({selector})=>{
      const fields=[...document.querySelectorAll('textarea,input:not([type=hidden]),select')].slice(0,40).map(el=>{
        const ancestors=[];for(let node=el;node&&ancestors.length<10;node=node.parentElement){const css=getComputedStyle(node);ancestors.push({tag:node.tagName,className:String(node.className).slice(0,100),ariaHidden:node.getAttribute('aria-hidden'),display:css.display,visibility:css.visibility,opacity:css.opacity,rects:node.getClientRects().length});}
        return {disabled:el.disabled,readOnly:el.readOnly,ancestors};
      });
      const dialogs=[...document.querySelectorAll('.ant-modal,[role=dialog]')].filter(el=>/本单元学习时间/.test(el.textContent)&&/是否必修/.test(el.textContent)).map(el=>{const css=getComputedStyle(el);return {className:String(el.className).slice(0,160),opacity:css.opacity,display:css.display,pointerEvents:css.pointerEvents};});
      const styleOf=el=>{const css=getComputedStyle(el),box=el.getBoundingClientRect();return {className:String(el.className).slice(0,160),display:css.display,visibility:css.visibility,opacity:css.opacity,pointerEvents:css.pointerEvents,transform:css.transform,width:Math.round(box.width),height:Math.round(box.height),animationName:css.animationName,animationPlayState:css.animationPlayState};};
      const portals=[...document.querySelectorAll('.ant-modal-wrap')].slice(-12).map(wrap=>({...styleOf(wrap),dialogs:[...wrap.querySelectorAll('.ant-modal,[role=dialog],[role=alertdialog],.ant-modal-content')].slice(0,6).map(styleOf)}));
      const masks=[...document.querySelectorAll('.ant-modal-mask')].slice(-12).map(styleOf),target=selector?document.querySelector(selector):null,box=target?.getBoundingClientRect();
      const point=box?{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2}:null;
      const action=selector?{target:target?styleOf(target):null,point,hits:point?document.elementsFromPoint(point.x,point.y).slice(0,6).map(styleOf):[],viewport:{width:innerWidth,height:innerHeight}}:null;
      return {hostname:location.hostname,visibility:document.visibilityState,readyState:document.readyState,fields,dialogs,portals,masks,action};
    },{selector});
    noticeDiagnostics.push({time:new Date().toISOString(),stage,blockerKind,...report});if(noticeDiagnostics.length>8)noticeDiagnostics.shift();
    await writeFile(path.join(engine.store.directory,'study-notice-diagnostics.json'),JSON.stringify(noticeDiagnostics));
  }catch{/* Diagnostics must never turn a successful click into a failure. */}
}

// Public layout and hit-testing only. A hidden Ant Design portal can remain
// pointer-active after its dialog has closed; visible dialogs are never removed.
export function inspectLessonBlockerFromDOM({selector='',element=null,childPoint=null,repairToken='',operationToken=''}={}){
  const target=element||document.querySelector(selector);if(!target)return {kind:'missing'};
  const painted=el=>{if(!el?.getClientRects().length)return false;const rect=el.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden]')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
  const visible=el=>painted(el)&&!el.closest('[aria-hidden=true],[inert]');
  const clean=el=>String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
  const box=target.getBoundingClientRect();let left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
  for(let parent=target.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}}
  if(right<=left||bottom<=top)return {kind:'outside'};
  const scaleX=box.width/(target.offsetWidth||box.width),scaleY=box.height/(target.offsetHeight||box.height);
  const point=childPoint?{x:box.left+(target.clientLeft+childPoint.x)*scaleX,y:box.top+(target.clientTop+childPoint.y)*scaleY}:{x:(left+right)/2,y:(top+bottom)/2};
  const hit=document.elementFromPoint(point.x,point.y);
  if(hit&&(hit===target||target.contains(hit)))return {kind:'clear',point};
  // Ant renders its mask beside the wrapper, not inside it. Associate a mask
  // only with the single direct wrapper in that same modal root.
  const mask=hit?.closest('.ant-modal-mask'),portal=mask?.parentElement?.matches('.ant-modal-root')?mask.parentElement:null;
  const siblings=portal?[...portal.children].filter(el=>el.matches('.ant-modal-wrap')):[];
  const wrapper=hit?.closest('.ant-modal-wrap')||(siblings.length===1?siblings[0]:null);
  if(!wrapper)return {kind:hit?'blocked':'no-hit',point,text:hit?clean(hit.closest('[role=dialog],.ant-modal,.el-message-box')||hit).slice(0,180):''};
  const canRelease=wrap=>{
    const roots=[...wrap.querySelectorAll('.ant-modal,[role=dialog],[role=alertdialog]')].filter(el=>![...wrap.querySelectorAll('.ant-modal,[role=dialog],[role=alertdialog]')].some(other=>other!==el&&other.contains(el)));
    if(!roots.length)return !clean(wrap)&&![...wrap.querySelectorAll('button,a,input,textarea,select,[contenteditable],iframe,object,embed,canvas,video,img')].some(painted);
    return roots.every(root=>{
      if([root,...root.querySelectorAll('button,a,input,textarea,select,[contenteditable],iframe,object,embed,canvas,video,img,.ant-modal-content')].some(painted))return false;
      if(!clean(root))return true;
      for(let node=root;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],.ant-modal-hidden')||style.display==='none'||style.visibility==='hidden'||/(?:^|[\s-])(?:leave|exit)(?:[\s-]|$)/.test(String(node.className)))return true;if(node===wrap)break;}
      return false;
    });
  };
  const closedPortalNodes=()=>{
    const root=wrapper.parentElement;
    if(!root?.matches('.ant-modal-root'))return [wrapper];
    const children=[...root.children],wraps=children.filter(el=>el.matches('.ant-modal-wrap')),masks=children.filter(el=>el.matches('.ant-modal-mask'));
    if(wraps.length!==1||wraps[0]!==wrapper||children.some(el=>!el.matches('.ant-modal-wrap,.ant-modal-mask')&&(painted(el)||clean(el))))return [wrapper];
    if(masks.some(el=>clean(el)||[...el.querySelectorAll('button,a,input,textarea,select,[contenteditable],iframe,object,embed,canvas,video,img,[role=dialog],[role=alertdialog]')].some(painted)))return [wrapper];
    return [wrapper,...masks];
  };
  if(mask&&!closedPortalNodes().includes(mask))return {kind:'blocked',point,text:clean(mask).slice(0,180)};
  if(canRelease(wrapper)){
    let token=wrapper.getAttribute('data-ustudy-closed-modal');if(!token){token=crypto.randomUUID();wrapper.setAttribute('data-ustudy-closed-modal',token);}
    if(repairToken&&repairToken===token){
      const nodes=closedPortalNodes(),styles=nodes.map(el=>({el,previous:el.style.getPropertyValue('pointer-events'),priority:el.style.getPropertyPriority('pointer-events')}));
      for(const {el} of styles)el.style.setProperty('pointer-events','none','important');
      let timer,restored=false;
      const restore=()=>{if(restored)return;restored=true;clearTimeout(timer);observer.disconnect();document.removeEventListener('click',afterClick,true);wrapper.removeEventListener('ustudy:restore-closed-modal',restore);for(const {el,previous,priority} of styles){if(previous)el.style.setProperty('pointer-events',previous,priority);else el.style.removeProperty('pointer-events');}wrapper.removeAttribute('data-ustudy-closed-modal');wrapper.removeAttribute('data-ustudy-modal-operation');};
      const afterClick=()=>setTimeout(restore,0);
      const observer=new MutationObserver(()=>{const current=closedPortalNodes();if(!wrapper.isConnected||!canRelease(wrapper)||current.length!==nodes.length||current.some((el,i)=>el!==nodes[i]))restore();});
      observer.observe(wrapper.parentElement||wrapper,{subtree:true,childList:true,attributes:true});
      observer.observe(wrapper,{subtree:true,childList:true,attributes:true});
      if(operationToken){
        wrapper.setAttribute('data-ustudy-modal-operation',operationToken);wrapper.addEventListener('ustudy:restore-closed-modal',restore);
        // The caller restores this repair in finally. A checkpoint or another
        // notice acknowledgement must not expire it before the real operation.
        timer=setTimeout(restore,120000);
      }else{document.addEventListener('click',afterClick,{capture:true,once:true});timer=setTimeout(restore,5000);}
      return {kind:'released',point};
    }
    return {kind:'closed-modal',token,point};
  }
  const dialogs=[...wrapper.querySelectorAll('.ant-modal,[role=dialog]')].filter(visible),leaves=dialogs.filter(el=>!dialogs.some(other=>other!==el&&el.contains(other)));
  const closing=dialogs.filter(dialog=>{for(let node=dialog;node;node=node.parentElement){if(/(?:^|[\s-])(?:leave|exit)(?:[\s-]|$)/.test(String(node.className)))return true;if(node===wrapper)break;}return false;});
  if(closing.length)return {kind:'closing-dialog',point,studyNotice:closing.some(dialog=>/本单元学习时间/.test(clean(dialog))&&/是否必修/.test(clean(dialog)))};
  const notices=leaves.filter(el=>/本单元学习时间/.test(clean(el))&&/是否必修/.test(clean(el)));
  if(notices.length){
    const buttons=notices.flatMap(dialog=>[...dialog.querySelectorAll('button,a,[role=button],input[type=button]')]).filter(el=>visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled=true]')&&String(el.textContent||el.value||'').replace(/\s+/g,'')==='我知道了');
    const front=buttons.filter(button=>{const box=button.getBoundingClientRect(),hit=document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2);return hit&&(hit===button||button.contains(hit));}).at(-1);
    if(front){for(const old of document.querySelectorAll('[data-ustudy-study-ack]'))old.removeAttribute('data-ustudy-study-ack');front.setAttribute('data-ustudy-study-ack','true');return {kind:'study-notice',selector:'[data-ustudy-study-ack="true"]',point};}
  }
  return {kind:'dialog',point,text:clean(leaves[0]||wrapper).slice(0,180)};
}

export function restoreLessonActionFromDOM({operationToken}={}){
  if(!operationToken)return;
  for(const wrapper of document.querySelectorAll('[data-ustudy-modal-operation]'))if(wrapper.getAttribute('data-ustudy-modal-operation')===operationToken)wrapper.dispatchEvent(new Event('ustudy:restore-closed-modal'));
}

export class LessonActionBlockedError extends Error{
  constructor(message){super(message);this.name='LessonActionBlockedError';this.code='LESSON_ACTION_BLOCKED';}
}

// A minimized renderer can pause Ant's exit animation after a normal click.
// Finish only an already-closing, recognized study notice via Web Animations;
// let its own animationend handler remove it. Never remove a dialog or overlay.
export function finishStudyNoticeCloseFromDOM({selector=''}={}){
  const target=selector?document.querySelector(selector):null;
  const dialogs=target?[target.closest('.ant-modal,[role=dialog],[role=alertdialog]')]:[...document.querySelectorAll('.ant-modal,[role=dialog],[role=alertdialog]')];let finished=0;
  for(const dialog of dialogs){
    if(!dialog||!/本单元学习时间/.test(dialog.textContent)||!/是否必修/.test(dialog.textContent)||![...dialog.querySelectorAll('button,a,[role=button],input[type=button]')].some(button=>(button.textContent||button.value||'').replace(/\s+/g,'')==='我知道了'))continue;
    const ancestors=[];for(let node=dialog;node;node=node.parentElement){ancestors.push(node);if(node.matches('.ant-modal-wrap'))break;}
    if(!ancestors.some(node=>/(?:^|\s)ant-(?:zoom|fade)-leave(?:-active|-to)?(?:\s|$)/.test(String(node.className))))continue;
    const animations=new Set([...ancestors.flatMap(node=>node.getAnimations?.()||[]),...(dialog.getAnimations?.({subtree:true})||[])]);
    for(const animation of animations){if(!['running','paused'].includes(animation.playState)||!Number.isFinite(animation.effect?.getComputedTiming().endTime))continue;try{animation.finish();finished++;}catch{}}
  }
  return finished;
}

// This nonbinding acknowledgement does not require moving the real pointer or
// waiting for two animation frames in a background tab. Validate the authored
// button and current hit target again, then dispatch its standard click event.
export function acknowledgeStudyNoticeFromDOM({selector}={}){
  const button=document.querySelector(selector),dialog=button?.closest('.ant-modal,[role=dialog],[role=alertdialog],dialog,.el-message-box');
  if(!button||!dialog||!/本单元学习时间/.test(dialog.innerText||dialog.textContent)||!/是否必修/.test(dialog.innerText||dialog.textContent)||(button.textContent||button.value||'').replace(/\s+/g,'')!=='我知道了'||button.matches(':disabled,[disabled],[aria-disabled=true],[class*="disabled"]'))return false;
  for(let node=button;node;node=node.parentElement){const css=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}
  const box=button.getBoundingClientRect();if(box.width<=0||box.height<=0||box.right<=0||box.bottom<=0||box.left>=innerWidth||box.top>=innerHeight)return false;
  const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,(box.left+box.right)/2)),Math.max(0,Math.min(innerHeight-1,(box.top+box.bottom)/2)));
  if(!hit||hit!==button&&!button.contains(hit))return false;
  button.click();return true;
}

async function probe(frame,selector){
  let current=frame,element=null,point=null;
  try{
    while(current){
      const report=await current.evaluate(inspectLessonBlockerFromDOM,{selector:element?'':selector,element,childPoint:point});
      if(!report||report.kind!=='clear')return {frame:current,element,childPoint:point,...report};
      point=report.point;await element?.dispose();element=null;
      const parent=current.parentFrame?.();if(!parent)return {kind:'clear',point};
      element=await current.frameElement();current=parent;
    }
    return {kind:'clear'};
  }finally{await element?.dispose().catch(()=>{});}
}

const labelFor=kind=>({submit:'提交',next:'下一题',notice:'学习时间提示',revise:'返回修改',finish:'继续学习',publish:'发布',roleplay:'分角色练习',answer:'填写答案',player:'播放器',seek:'拖动进度条',play:'播放',pause:'暂停'}[kind]||'操作');
const blocked=(kind,report)=>{
  const details={'closing-dialog':'弹窗的关闭动画尚未结束','closed-modal':'已关闭弹窗的遮罩仍在拦截操作',outside:'作答控件当前位于可操作区域之外',missing:'当前作答控件已变化或消失','no-hit':'页面尚未返回控件位置的命中元素'};
  const detail=report?.text||details[report?.kind]||'',geometry=['outside','missing','no-hit'].includes(report?.kind);
  const error=new LessonActionBlockedError(`${geometry?'当前「'+labelFor(kind)+'」暂时无法操作':'页面弹窗或遮罩挡住了「'+labelFor(kind)+'」'}，已保留当前答案。${detail?'提示：'+detail.replace(/https?:\/\/\S+/g,'[链接]').replace(/\u001b\[[0-9;]*m/g,'').slice(0,150)+'。':''}请先${geometry?'核对页面':'处理弹窗'}，再点击「继续核对」。`);
  error.blockerKind=report?.kind;return error;
};

async function runLessonAction(engine,frame,kind,selector,{signal,checkpoint,beforeClick,readAction,perform,allowMotion=false,operationToken='',releasedFrames}={}){
  const page=typeof frame.page==='function'?frame.page():null,pageURL=page?.url(),frameURL=frame.url?.();
  const check=async()=>{await engine.checkpoint(signal);await checkpoint?.();await engine.checkpoint(signal);if(page&&(page.isClosed()||page.url()!==pageURL)||frameURL&&frame.url()!==frameURL)throw new Error('操作前课程页面已变化，已保留当前答案。');};
  let noticeAcks=0,noticeSeen=false,closedToken='',closedAt=0,closingAt=0,attempts=0,totalAttempts=0,missedChecks=0,lastReport;
  while(attempts++<12&&totalAttempts++<64){
    await check();let found;
    try{found=await frame.evaluate(readAction,{kind,selector});}catch{signal?.throwIfAborted();throw new Error(`${labelFor(kind)}按钮选择器无效，或课程页面已变化。`);}
    await check();
    // A known notice can finish closing between polls (including a manual
    // acknowledgement). Report that dismissal so the caller rechecks state.
    if(!found){if(perform)throw new LessonActionBlockedError('作答控件已变化或不唯一，已保留答案，请核对页面后点击「继续核对」。');return kind==='notice'&&noticeSeen;}
    if(kind==='notice')noticeSeen=true;
    const locator=frame.locator(found).first();
    // Unit-test adapters can omit browser geometry. Real lessons always probe
    // the target and its containing frames before dispatching a pointer event.
    if(!page){await beforeClick?.();await check();if(perform)await perform(locator);else await locator.click({timeout:5000,noWaitAfter:true});await engine.checkpoint(signal);return true;}
    if(kind==='notice'&&await frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:found})){await sleep(100,undefined,{signal});continue;}
    try{
      if(kind==='notice'||allowMotion)await locator.evaluate((el,motion)=>{const box=el.getBoundingClientRect();if(motion||box.left<0||box.top<0||box.right>innerWidth||box.bottom>innerHeight)el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});},allowMotion,{timeout:3000});
      else await locator.scrollIntoViewIfNeeded({timeout:3000});
    }catch{await check();throw new LessonActionBlockedError(`无法定位当前「${labelFor(kind)}」按钮，已保留答案，请核对页面后点击「继续核对」。`);}
    const report=await probe(frame,found);lastReport=report;
    if(report.kind==='closing-dialog'){
      await report.frame.evaluate(finishStudyNoticeCloseFromDOM,{});
      // The leave-start phase can precede any Web Animation. Let the framework
      // advance its own frame queue before spending the ordinary blocker budget.
      if(report.studyNotice){closingAt ||= Date.now();if(Date.now()-closingAt<8000){attempts=0;totalAttempts--;}}
      await sleep(100,undefined,{signal});continue;
    }
    if(report.kind==='closed-modal'){
      if(report.token!==closedToken){closedToken=report.token;closedAt=Date.now();}
      if(Date.now()-closedAt<250){await sleep(100,undefined,{signal});continue;}
      // Re-probe in the blocking frame: never retain handles across polling.
      let element;
      try{
        if(report.frame!==frame){let current=frame;while(current?.parentFrame()!==report.frame)current=current.parentFrame();element=await current.frameElement();}
        const fresh=await report.frame.evaluate(inspectLessonBlockerFromDOM,{selector:report.frame===frame?found:'',element,childPoint:report.childPoint,repairToken:closedToken,operationToken});
        if(fresh.kind==='released'){
          releasedFrames?.add(report.frame);
          // Each retained portal is a separate blocker. Releasing one is
          // progress, so give the next layer its own retry budget; the total
          // attempt limit still bounds pages that keep creating new layers.
          attempts=0;closedToken='';
        }else{closedToken='';await sleep(100,undefined,{signal});}
      }finally{await element?.dispose().catch(()=>{});}
      continue;
    }
    if(report.kind==='study-notice'&&noticeAcks<8){
      await check();
      if(!await report.frame.evaluate(acknowledgeStudyNoticeFromDOM,{selector:report.selector}))throw blocked(kind,report);
      noticeAcks++;attempts=0;
      await report.frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:report.selector});
      await sleep(150,undefined,{signal});continue;
    }
    if(report.kind!=='clear')throw blocked(kind,report);
    await check();await beforeClick?.();await check();
    const dispatch=allowMotion?await probe(frame,found):report;
    if(dispatch.kind!=='clear'){lastReport=dispatch;continue;}
    if(kind==='notice')await recordNoticeDiagnostic(engine,frame,'before-ack');
    try{
      if(kind==='notice'){
        if(!await frame.evaluate(acknowledgeStudyNoticeFromDOM,{selector:found})){await sleep(100,undefined,{signal});continue;}
      }else if(perform)await perform(locator,dispatch.point);
      else await locator.click({timeout:3000,noWaitAfter:true});
    }
    catch(error){
      signal?.throwIfAborted();
      const intercepted=/intercepts pointer events|pointer.*intercept/i.test(error.message),missedCheck=perform&&/clicking the checkbox did not change its state/i.test(error.message)&&missedChecks++<1;
      if(!intercepted&&!missedCheck){
        if(perform&&error.name!=='TimeoutError'&&!/^(?:locator|page|frame)\./.test(error.message||''))throw error;
        const reason=/element is not stable/i.test(error.message)?'按钮动画未稳定':/element is not visible|waiting for element to be visible/i.test(error.message)?'按钮显示状态未就绪':/detach/i.test(error.message)?'按钮被页面重新渲染':/closed/i.test(error.message)?'题页已关闭':/Timeout|timed out/i.test(error.message)?'点击等待超时':'点击未完成';
        throw new LessonActionBlockedError(`未能${perform?'操作':'点击'}「${labelFor(kind)}」（${reason}），已保留当前答案，请核对页面后点击「继续核对」。`);
      }
      continue;
    }
    if(kind==='notice')await frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:found});
    if(kind==='notice'){await sleep(150,undefined,{signal});await recordNoticeDiagnostic(engine,frame,'after-ack');}
    await engine.checkpoint(signal);return true;
  }
  throw blocked(kind,lastReport);
}

export async function performLessonAction(engine,frame,kind,selector,options={}){
  const operationToken=randomUUID(),releasedFrames=new Set();
  try{return await runLessonAction(engine,frame,kind,selector,{...options,operationToken,releasedFrames});}
  catch(error){if(error.code==='LESSON_ACTION_BLOCKED')await recordNoticeDiagnostic(engine,frame,'blocked-'+kind,{selector,blockerKind:error.blockerKind||'action-timeout'});throw error;}
  finally{for(const released of releasedFrames)try{await released.evaluate(restoreLessonActionFromDOM,{operationToken});}catch{/* A detached frame no longer owns an active repair. */}}
}

/** Guard an exact control before dispatching its authored pointer interaction. */
export async function performControlAction(engine,frame,kind,selector,perform,{signal,checkpoint,allowMotion=false}={}){
  if(typeof frame.page!=='function'){await checkpoint?.();signal?.throwIfAborted();await perform();return true;}
  return performLessonAction(engine,frame,kind,selector,{signal,checkpoint,perform,allowMotion,readAction:({selector})=>document.querySelectorAll(selector).length===1?selector:null});
}
export const performAnswerAction=(engine,frame,selector,perform,options)=>performControlAction(engine,frame,'answer',selector,perform,options);
