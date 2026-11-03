import {setTimeout as sleep} from 'node:timers/promises';
import {readExerciseNavigationFromDOM} from './platform-dom.mjs';

// Read only the lesson's top-level discussion composer, never a reply or note.
export function readDiscussionBoardFromDOM(){
  const visible=el=>{if(!el?.getClientRects().length)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
  const clean=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  // "question-common-abs-reply" is the textbook's normal answer region,
  // including the entire discussion SDK. Only exclude SDK comment replies.
  const excluded='aside,.v3notes,[role=search]';
  // The real SDK calls its whole board "ds-discussion-reply" as well.
  // Nested comment composers belong to its record list, unlike the main footer.
  const replyArea='.ds-discussion-recordList,.ds-discussion-reply-container';
  for(const el of document.querySelectorAll('[data-ustudy-discussion-editor],[data-ustudy-discussion-publish]')){el.removeAttribute('data-ustudy-discussion-editor');el.removeAttribute('data-ustudy-discussion-publish');}
  const roots=[...document.querySelectorAll('.discussion-course-page-sdk')].filter(el=>visible(el)&&!el.closest(excluded));
  if(!roots.length){
    const loading=[...document.querySelectorAll('.layout-container.discussion-view')].find(el=>visible(el)&&[...el.querySelectorAll('.discussion-title')].some(title=>visible(title)&&/discussion board|讨论/i.test(clean(title))));
    return loading?{recognized:true,ready:false,loading:true,issue:'讨论板评论组件仍在加载，尚未填写或发布；请检查加载状态后继续。'}:null;
  }
  const blocked=issue=>({recognized:true,ready:false,issue});
  if(roots.length!==1)return blocked('检测到多个讨论板，尚未发布。');
  const root=roots[0],fields=[...root.querySelectorAll('textarea,[contenteditable=true],[contenteditable="plaintext-only"]')].filter(el=>visible(el)&&!el.closest(excluded)&&!el.closest(replyArea)&&(!el.closest('[role=dialog]'))&&(el.closest('.ds-discussion-bottom-textArea-container')||/^(?:我来评论|发表评论|请输入评论)[.。…]*$/.test(el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||'')));
  if(fields.length!==1)return blocked('讨论板主评论框尚未就绪或不唯一，尚未发布。');
  const publishButtons=scope=>{
    const matches=[...scope.querySelectorAll('button,a,[role=button],div,span')].filter(el=>visible(el)&&!el.closest(excluded)&&!el.closest(replyArea)&&clean(el).replace(/\s+/g,'')==='发布');
    const leaves=matches.filter(el=>!matches.some(other=>other!==el&&el.contains(other)));
    return [...new Set(leaves.map(el=>el.closest('button,a,[role=button]')||el))];
  };
  const field=fields[0];let composer=field.parentElement;
  while(composer&&composer!==root&&!publishButtons(composer).length)composer=composer.parentElement;
  if(!composer)return blocked('未找到主评论框对应的发布入口。');
  const buttons=publishButtons(composer);
  if(buttons.length!==1)return blocked('讨论板发布入口尚未就绪或不唯一。');
  const value=String(field.matches('[contenteditable]')?field.textContent:field.value||'');
  field.setAttribute('data-ustudy-discussion-editor','true');buttons[0].setAttribute('data-ustudy-discussion-publish','true');
  const copy=(root.closest('.pc-main-container,main,.layout-container')||document.body).cloneNode(true);
  copy.querySelectorAll('script,style,aside,.pc-slider-content,.v3notes,.discussion-course-page-sdk,textarea,[contenteditable],.pc-break-crumb,[class*="header"]').forEach(el=>el.remove());
  const prompt=clean(copy).slice(0,20000),text=clean(root),count=text.match(/全部评论\s*[（(]\s*(\d+)\s*条\s*[)）]/);
  const posts=[...root.querySelectorAll('[class*="comment-content"],[class*="commentContent"],[class*="discussion-item-content"]')].filter(el=>visible(el)&&!composer.contains(el)&&!el.closest(excluded)&&clean(el)==='1').length;
  const success=[...document.querySelectorAll('[role=alert],.ant-message-notice-content,.ant-notification-notice-message')].filter(visible).map(clean).filter(text=>/^(?:评论|发布)(?:已)?(?:发布)?成功[!！。]?$/.test(text)).join('|');
  const canPublish=!buttons[0].matches(':disabled')&&!buttons[0].closest('[disabled],[aria-disabled=true],[class*="disabled"]');
  return {recognized:true,ready:true,editable:!field.disabled&&!field.readOnly,canPublish,value,prompt,key:JSON.stringify([prompt]),count:count?Number(count[1]):null,posts,success,editor:'[data-ustudy-discussion-editor="true"]',publish:'[data-ustudy-discussion-publish="true"]'};
}

export async function readDiscussionBoard(engine,page){
  if(typeof page.frames!=='function')return null;
  const found=[];
  for(const frame of await engine.activeFrames(page)){
    const report=await frame.evaluate(readDiscussionBoardFromDOM);if(report?.recognized!==true)continue;
    const navigation=await frame.evaluate(readExerciseNavigationFromDOM),pageURL=page.url(),frameURL=frame.url();
    found.push({...report,frame,pageURL,frameURL,navigation,binding:JSON.stringify([pageURL,frameURL,navigation.key])});
  }
  return found.length>1?{recognized:true,ready:false,issue:'多个框架显示讨论板，尚未发布。'}:found[0]||null;
}

export async function completeDiscussionBoard(engine,task,page,initial,settings,signal,{timeout=10000,pollMs=150}={}){
  engine.pages.protect(page,'discussion-draft');
  await engine.disposeExerciseLearning(task.id);
  try{
    const check=async()=>{
      await engine.gate(task,signal);
      if(!initial.ready)throw new Error(initial.issue);
      const fresh=await readDiscussionBoard(engine,page);
      engine.assertEntryPage(page,initial.pageURL,fresh);
      let title='';try{title=JSON.parse(task.entryKey)[2];}catch{}
      if(!fresh?.ready||!fresh.navigation?.known||!title||title.normalize('NFKC').trim().toLowerCase()!==fresh.navigation.title.normalize('NFKC').trim().toLowerCase()||fresh.binding!==initial.binding||fresh.key!==initial.key)throw new Error('讨论题目、主评论框或活动项目已变化，尚未发布。');
      return fresh;
    };
    let fresh=await check();
    if(!fresh.editable)throw new Error('主评论框不可编辑，尚未填写或发布。');
    if(fresh.value.trim()&&fresh.value!=='1')throw new Error('主评论框已有其他草稿，已保留原文，尚未覆盖或发布。');
    if(fresh.value!=='1'){await fresh.frame.locator(fresh.editor).fill('1',{timeout:3000});fresh=await check();}
    if(fresh.value!=='1')throw new Error('评论框未能完整保留「1」，尚未发布。');
    if(!settings.autoSubmit)return {review:true,message:'讨论主评论框已填入「1」，请检查后点击「发布」，再点击「继续核对」。'};
    const enableDeadline=Date.now()+3000;
    while(!fresh.canPublish&&Date.now()<enableDeadline){await sleep(100,undefined,{signal});fresh=await check();if(fresh.value!=='1')throw new Error('等待发布时评论已变化，已保留当前内容。');}
    if(!fresh.canPublish)throw new Error('发布入口仍不可用，已保留「1」，尚未点击发布。');
    const baseline=fresh;
    const clicked=await engine.action(fresh.frame,'publish',fresh.publish,{signal,checkpoint:check,beforeClick:async()=>{const current=await check();if(current.value!=='1'||!current.canPublish)throw new Error('发布前评论或入口已变化，已保留当前草稿。');}});
    if(!clicked)throw new Error('发布按钮尚不可用；已保留「1」，请核对后手动发布。');
    engine.store.addLog(task,'讨论板已点击「发布」，正在核对评论保存结果；本次不再重复发布。');
    const deadline=Date.now()+timeout;
    do{
      fresh=await check();
      if(!fresh.value.trim()&&(fresh.count!==null&&baseline.count!==null&&fresh.count>baseline.count||fresh.posts>baseline.posts||fresh.success&&fresh.success!==baseline.success)){
        task.answered++;task.pages++;engine.store.changed();
        engine.store.addLog(task,'已确认主评论「1」发布成功，正在回查必修目录。');
        return {discussionDone:true};
      }
      await sleep(pollMs,undefined,{signal});
    }while(Date.now()<deadline);
    return {review:true,message:'已点击一次讨论发布，但尚未确认评论保存成功。请核对评论和目录后点击「继续核对」；本次不会自动重复发布。'};
  }catch(error){signal?.throwIfAborted();return {review:true,message:`${error.message} 已保留讨论页，请核对后手动发布，再点击「继续核对」。`};}
}
