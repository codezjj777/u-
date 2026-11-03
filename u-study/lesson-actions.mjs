import {setTimeout as sleep} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const noticeDiagnostics=[];
async function recordNoticeDiagnostic(engine,frame,stage){
  if(!engine.store.directory)return;
  try{
    const report=await frame.evaluate(()=>{
      const fields=[...document.querySelectorAll('textarea')].map(el=>{
        const ancestors=[];for(let node=el;node&&ancestors.length<10;node=node.parentElement){const css=getComputedStyle(node);ancestors.push({tag:node.tagName,className:String(node.className).slice(0,100),ariaHidden:node.getAttribute('aria-hidden'),display:css.display,visibility:css.visibility,opacity:css.opacity,rects:node.getClientRects().length});}
        return {disabled:el.disabled,readOnly:el.readOnly,ancestors};
      });
      const dialogs=[...document.querySelectorAll('.ant-modal,[role=dialog]')].filter(el=>/本单元学习时间/.test(el.textContent)&&/是否必修/.test(el.textContent)).map(el=>{const css=getComputedStyle(el);return {className:String(el.className).slice(0,160),opacity:css.opacity,display:css.display,pointerEvents:css.pointerEvents};});
      return {hostname:location.hostname,visibility:document.visibilityState,readyState:document.readyState,fields,dialogs};
    });
    noticeDiagnostics.push({time:new Date().toISOString(),stage,...report});if(noticeDiagnostics.length>8)noticeDiagnostics.shift();
    await writeFile(path.join(engine.store.directory,'study-notice-diagnostics.json'),JSON.stringify(noticeDiagnostics));
  }catch{/* Diagnostics must never turn a successful click into a failure. */}
}

// Public layout and hit-testing only. A hidden Ant Design portal can remain
// pointer-active after its dialog has closed; visible dialogs are never removed.
export function inspectLessonBlockerFromDOM({selector='',element=null,childPoint=null,repairToken=''}={}){
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
  const wrapper=hit?.closest('.ant-modal-wrap');
  if(!wrapper)return {kind:'blocked',point,text:clean(hit?.closest('[role=dialog],.ant-modal,.el-message-box')||hit||target).slice(0,180)};
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
  if(canRelease(wrapper)){
    let token=wrapper.getAttribute('data-ustudy-closed-modal');if(!token){token=crypto.randomUUID();wrapper.setAttribute('data-ustudy-closed-modal',token);}
    if(repairToken&&repairToken===token){
      const previous=wrapper.style.getPropertyValue('pointer-events'),priority=wrapper.style.getPropertyPriority('pointer-events');
      wrapper.style.setProperty('pointer-events','none','important');
      let timer;
      const restore=()=>{clearTimeout(timer);observer.disconnect();document.removeEventListener('click',afterClick,true);if(previous)wrapper.style.setProperty('pointer-events',previous,priority);else wrapper.style.removeProperty('pointer-events');wrapper.removeAttribute('data-ustudy-closed-modal');};
      const afterClick=()=>setTimeout(restore,0);
      const observer=new MutationObserver(()=>{if(!wrapper.isConnected||!canRelease(wrapper))restore();});
      observer.observe(wrapper.parentElement||wrapper,{subtree:true,childList:true,attributes:true});
      document.addEventListener('click',afterClick,{capture:true,once:true});timer=setTimeout(restore,5000);
      return {kind:'released',point};
    }
    return {kind:'closed-modal',token,point};
  }
  const dialogs=[...wrapper.querySelectorAll('.ant-modal,[role=dialog]')].filter(visible),leaves=dialogs.filter(el=>!dialogs.some(other=>other!==el&&el.contains(other)));
  const closing=dialogs.some(dialog=>{for(let node=dialog;node;node=node.parentElement){if(/(?:^|[\s-])(?:leave|exit)(?:[\s-]|$)/.test(String(node.className)))return true;if(node===wrapper)break;}return false;});
  if(closing)return {kind:'closing-dialog',point};
  const notices=leaves.filter(el=>/本单元学习时间/.test(clean(el))&&/是否必修/.test(clean(el)));
  if(notices.length===1){
    const buttons=[...notices[0].querySelectorAll('button,[role=button]')].filter(el=>visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled=true]')&&clean(el).replace(/\s+/g,'')==='我知道了');
    if(buttons.length===1){buttons[0].setAttribute('data-ustudy-study-ack','true');return {kind:'study-notice',selector:'[data-ustudy-study-ack="true"]',point};}
  }
  return {kind:'dialog',point,text:clean(leaves[0]||wrapper).slice(0,180)};
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
      const parent=current.parentFrame?.();if(!parent)return {kind:'clear'};
      element=await current.frameElement();current=parent;
    }
    return {kind:'clear'};
  }finally{await element?.dispose().catch(()=>{});}
}

const labelFor=kind=>({submit:'提交',next:'下一题',notice:'学习时间提示',revise:'返回修改',finish:'继续学习',publish:'发布',roleplay:'分角色练习'}[kind]||'操作');
const blocked=(kind,report)=>new LessonActionBlockedError(`页面弹窗或遮罩挡住了「${labelFor(kind)}」，已保留当前答案。${report?.text?'提示：'+report.text.replace(/https?:\/\/\S+/g,'[链接]').replace(/\u001b\[[0-9;]*m/g,'').slice(0,150)+'。':''}请先处理弹窗，再点击「继续核对」。`);

export async function performLessonAction(engine,frame,kind,selector,{signal,checkpoint,beforeClick,readAction}={}){
  const page=typeof frame.page==='function'?frame.page():null,pageURL=page?.url(),frameURL=frame.url?.();
  const check=async()=>{await engine.checkpoint(signal);await checkpoint?.();await engine.checkpoint(signal);if(page&&(page.isClosed()||page.url()!==pageURL)||frameURL&&frame.url()!==frameURL)throw new Error('操作前课程页面已变化，已保留当前答案。');};
  let acknowledged=false,noticeSeen=false,released=0,closedToken='',closedAt=0;
  for(let attempt=0;attempt<12;attempt++){
    await check();let found;
    try{found=await frame.evaluate(readAction,{kind,selector});}catch{signal?.throwIfAborted();throw new Error(`${labelFor(kind)}按钮选择器无效，或课程页面已变化。`);}
    await check();
    // A known notice can finish closing between polls (including a manual
    // acknowledgement). Report that dismissal so the caller rechecks state.
    if(!found)return kind==='notice'&&noticeSeen;
    if(kind==='notice')noticeSeen=true;
    const locator=frame.locator(found).first();
    // Unit-test adapters can omit browser geometry. Real lessons always probe
    // the target and its containing frames before dispatching a pointer event.
    if(!page){await beforeClick?.();await check();await locator.click({timeout:5000,noWaitAfter:true});await engine.checkpoint(signal);return true;}
    if(kind==='notice'&&await frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:found})){await sleep(100,undefined,{signal});continue;}
    try{
      if(kind==='notice')await locator.evaluate(el=>{const box=el.getBoundingClientRect();if(box.left<0||box.top<0||box.right>innerWidth||box.bottom>innerHeight)el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});},undefined,{timeout:3000});
      else await locator.scrollIntoViewIfNeeded({timeout:3000});
    }catch{await check();throw new LessonActionBlockedError(`无法定位当前「${labelFor(kind)}」按钮，已保留答案，请核对页面后点击「继续核对」。`);}
    const report=await probe(frame,found);
    if(report.kind==='closing-dialog'){await report.frame.evaluate(finishStudyNoticeCloseFromDOM,{});await sleep(100,undefined,{signal});continue;}
    if(report.kind==='closed-modal'){
      if(report.token!==closedToken){closedToken=report.token;closedAt=Date.now();}
      if(Date.now()-closedAt<250){await sleep(100,undefined,{signal});continue;}
      if(++released>3)throw blocked(kind,report);
      // Re-probe in the blocking frame: never retain handles across polling.
      let element;
      try{
        if(report.frame!==frame){let current=frame;while(current?.parentFrame()!==report.frame)current=current.parentFrame();element=await current.frameElement();}
        const fresh=await report.frame.evaluate(inspectLessonBlockerFromDOM,{selector:report.frame===frame?found:'',element,childPoint:report.childPoint,repairToken:closedToken});
        if(fresh.kind!=='released'){closedToken='';await sleep(100,undefined,{signal});}
      }finally{await element?.dispose().catch(()=>{});}
      continue;
    }
    if(report.kind==='study-notice'&&!acknowledged){
      acknowledged=true;await check();
      if(!await report.frame.evaluate(acknowledgeStudyNoticeFromDOM,{selector:report.selector}))throw blocked(kind,report);
      await report.frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:report.selector});
      await sleep(150,undefined,{signal});continue;
    }
    if(report.kind!=='clear')throw blocked(kind,report);
    await check();await beforeClick?.();await check();
    if(kind==='notice')await recordNoticeDiagnostic(engine,frame,'before-ack');
    try{
      if(kind==='notice'){
        if(!await frame.evaluate(acknowledgeStudyNoticeFromDOM,{selector:found})){await sleep(100,undefined,{signal});continue;}
      }else await locator.click({timeout:3000,noWaitAfter:true});
    }
    catch(error){
      signal?.throwIfAborted();
      if(!/intercepts pointer events|pointer.*intercept/i.test(error.message)){
        const reason=/element is not stable/i.test(error.message)?'按钮动画未稳定':/element is not visible|waiting for element to be visible/i.test(error.message)?'按钮显示状态未就绪':/detach/i.test(error.message)?'按钮被页面重新渲染':/closed/i.test(error.message)?'题页已关闭':/Timeout|timed out/i.test(error.message)?'点击等待超时':'点击未完成';
        throw new LessonActionBlockedError(`未能点击「${labelFor(kind)}」（${reason}），已保留当前答案，请核对页面后点击「继续核对」。`);
      }
      continue;
    }
    if(kind==='notice')await frame.evaluate(finishStudyNoticeCloseFromDOM,{selector:found});
    if(kind==='notice'){await sleep(150,undefined,{signal});await recordNoticeDiagnostic(engine,frame,'after-ack');}
    await engine.checkpoint(signal);return true;
  }
  throw blocked(kind);
}
