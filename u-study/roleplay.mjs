import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {readExerciseNavigationFromDOM} from './platform-dom.mjs';
import {advanceRoleplay} from './roleplay-flow.mjs';
import {reserveOralPage} from './oral-input.mjs';
import {prepareShortOralAudio} from './oral-short.mjs';
import {installRoleplayInputFromDOM,roleplayInputActionFromDOM} from './roleplay-input.mjs';

export const ROLEPLAY_HANDLER='roleplay-v1';
export function isRoleplayEntry(task){try{const [unit,,title]=JSON.parse(task.entryKey);return (!task.unitId||unit===task.unitId)&&/^oral practice$/i.test(title.trim());}catch{return false;}}

export function readRoleplayFromDOM({expectedRoleName=''}={}){
  for(const name of ['data-ustudy-roleplay-choose','data-ustudy-roleplay-start','data-ustudy-roleplay-stop','data-ustudy-roleplay-partner'])for(const el of document.querySelectorAll('['+name+']'))el.removeAttribute(name);
  const clean=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>{if(!el?.getClientRects().length)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
  const roots=[...document.querySelectorAll('.question-role-play,.question-abs-role-play')].filter(visible),outer=roots.filter(el=>!roots.some(other=>other!==el&&other.contains(el)));
  if(!outer.length)return null;
  const bad=issue=>({recognized:true,phase:'loading',issue});
  if(outer.length!==1)return bad('检测到多组分角色练习，尚未选择角色或录音。');
  const root=outer[0],scope=root.closest('.layout-container')||root,instructions=[...scope.querySelectorAll('.abs-direction')].map(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.title').forEach(node=>node.remove());return clean(copy);}).join(' ');
  const active=el=>{if(!visible(el))return false;const slide=el.closest('.swiper-slide');if(!slide)return true;if(root.querySelector('.swiper-slide-active'))return slide.classList.contains('swiper-slide-active');const container=slide.closest('.swiper-container');if(!container)return false;const box=slide.getBoundingClientRect(),clip=container.getBoundingClientRect();return Math.min(box.right,clip.right)-Math.max(box.left,clip.left)>Math.min(box.width,clip.width)*0.5;};
  if(!/role[- ]?play|分角色|角色扮演/i.test(instructions))return bad('分角色练习的任务要求尚未就绪。');
  const roles=[...root.querySelectorAll('.role-list .role')],a=roles.filter(role=>role.querySelector('svg#icon-A')||[...role.querySelectorAll('input')].some(input=>String(input.value||input.getAttribute('value')).toUpperCase()==='A'));
  const roleName=a.length===1?clean(a[0].querySelector('.label')):expectedRoleName;
  const choice=roles.filter(active);
  if(choice.length){
    if(a.length!==1||!active(a[0])||!roleName)return bad('尚未找到唯一的 A 角色入口。');
    a[0].setAttribute('data-ustudy-roleplay-choose','true');return {recognized:true,phase:'choose',role:'A',roleName,instructions,chooseSelector:'[data-ustudy-roleplay-choose="true"]'};
  }
  const replies=[...root.querySelectorAll('.role-reply')].filter(active);if(replies.length!==1)return {recognized:true,phase:'loading',instructions};
  const reply=replies[0],fields=[...reply.querySelectorAll('textarea,input:not([type=hidden]),[contenteditable=true]')].filter(el=>active(el)&&!el.disabled&&!el.readOnly);
  if(fields.length)return bad('当前分角色练习含其他可编辑作答控件，尚未启动录音。');
  if(!roleName)return bad('无法确认当前对话是否选择了 A 角色。');
  const rows=[...reply.querySelectorAll('.role-play-quiz .list-item-review')],script=rows.map(row=>{
    const content=row.querySelector('.role-text-wrapper > .text')?.cloneNode(true);content?.querySelectorAll('.score-wrapper,.record-done,.role-play-reply-controller-explanations').forEach(el=>el.remove());
    return {speaker:clean(row.querySelector('.role-text-wrapper > .role')),text:clean(content)};
  });
  if(!rows.length||rows.length>240||script.some(line=>!line.speaker||!line.text))return bad('对话台词或说话角色尚未完整载入。');
  const own=rows.filter((row,i)=>script[i].speaker===roleName),total=own.length;
  if(!total||total>120||own.some(row=>[...row.children].find(el=>el.classList.contains('score'))?.classList.contains('hide')))return bad('当前选择角色与 A 角色台词无法对应。');
  const completed=own.flatMap((row,i)=>{const score=[...row.children].find(el=>el.classList.contains('score')),value=clean(score);return score&&visible(score)&&(/^(?:\d+(?:\.\d+)?|已完成|完成|Done)$/i.test(value))?[i]:[];});
  const current=rows.filter(row=>row.classList.contains('active'));if(current.length>1)return bad('多句台词同时处于活动状态，尚未点击结束。');
  const turn=current.length?own.indexOf(current[0]):-1;
  const stops=current.flatMap(row=>[...row.querySelectorAll('svg.pause-circle-player.active')].filter(el=>active(el)&&!!el.querySelector('path[d^="M464.5438957"]')));
  if(stops.length>1)return bad('当前句子的结束入口不唯一。');
  const microphones=[...reply.querySelectorAll('.control-box .record-seat')].filter(active);
  if(microphones.length!==1)return bad('尚未找到唯一的整段对话录音入口。');
  microphones[0].setAttribute('data-ustudy-roleplay-start','true');if(stops.length)stops[0].setAttribute('data-ustudy-roleplay-stop','true');
  // Only the dialogue's own authored player; recorder/replay audio elsewhere
  // must never be started while waiting for the other role.
  const media=[...reply.querySelectorAll('.control-box audio')].filter(audio=>!audio.closest('.record-wrapper,.audio-replay-wrapper')&&(audio.currentSrc||audio.getAttribute('src')));
  const playing=media.some(audio=>!audio.paused&&!audio.ended);
  const partner=turn<0&&current.length&&media.length===1?media[0]:null;
  if(partner)partner.setAttribute('data-ustudy-roleplay-partner','true');
  const partnerAudio=partner?{paused:partner.paused,ended:partner.ended,time:Math.floor(partner.currentTime||0),duration:Number.isFinite(partner.duration)?Math.ceil(partner.duration):null,ready:partner.readyState,error:partner.error?.code||0}:null;
  const submit=[...document.querySelectorAll('.question-common-course-page button,.question-common-course-page a')].some(el=>visible(el)&&!el.closest('[disabled],[aria-disabled=true],[class*="disabled"]')&&/^提交(?:答案)?$/.test(clean(el).replace(/\s+/g,'')));
  const errors=[...document.querySelectorAll('[role=alert],.ant-message-notice-content')].filter(visible).map(clean).filter(text=>/(?:录音|音频|上传|保存|网络)[\s\S]{0,60}(?:失败|错误|超时|异常)/.test(text));
  const phase=completed.length===total&&!stops.length&&!playing&&submit?'completed':stops.length?'recording':!current.length?'ready':turn>=0?'saving':'partner';
  return {recognized:true,phase,role:'A',roleName,instructions,total,turn,rowIndex:current.length?rows.indexOf(current[0]):-1,speaker:current.length?script[rows.indexOf(current[0])].speaker:'',completed,partnerAudio,partnerSelector:partner?'[data-ustudy-roleplay-partner="true"]':'',dialogueKey:JSON.stringify(script),startSelector:'[data-ustudy-roleplay-start="true"]',stopSelector:stops.length?'[data-ustudy-roleplay-stop="true"]':'',hasRecordings:completed.length>0,...(errors.length?{issue:errors[0].slice(0,250)}:{})};
}

export async function resumeRoleplayPartnerFromDOM({rowIndex}){
  const audio=document.querySelector('[data-ustudy-roleplay-partner="true"]'),reply=audio?.closest('.role-reply'),rows=[...reply?.querySelectorAll('.role-play-quiz .list-item-review')||[]];
  if(!audio||!rows[rowIndex]?.classList.contains('active')||rows.filter(row=>row.classList.contains('active')).length!==1||rows[rowIndex].querySelector('svg.pause-circle-player.active')||audio.closest('.record-wrapper,.audio-replay-wrapper')||audio.ended||audio.error||!audio.paused)throw new Error('对方音频或当前台词已变化，尚未恢复播放。');
  let timer;try{await Promise.race([audio.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('恢复对方台词音频超时，请检查网络或播放器。')),5000);})]);}finally{clearTimeout(timer);}
}

function describeRoleplay(current){
  if(!current)return '未读到对话状态';
  const saved=current.completed?.length||0,total=current.total||'?',row=Number.isInteger(current.rowIndex)&&current.rowIndex>=0?current.rowIndex+1:'?';
  const audio=current.partnerAudio;
  if(current.phase==='partner')return `已保存 ${saved}/${total} 句；正在等待对方第 ${row} 行${audio?`（${audio.time}/${audio.duration??'?'} 秒${audio.paused?'，已暂停':''}${audio.error?'，音频错误 '+audio.error:''}）`: '（播放器尚未就绪）'}`;
  if(current.phase==='choosing')return '已点击 A，等待角色选择页切换至对话页';
  return `已保存 ${saved}/${total} 句；${{recording:'正在录音',saving:'等待录音保存',ready:'等待整段启动',completed:'全部录音已保存',loading:'等待控件载入',choose:'等待选择角色'}[current.phase]||current.phase}`;
}

export async function readRoleplay(engine,page,expectedRoleName=''){
  const found=[];for(const frame of await engine.activeFrames(page)){
    const report=await frame.evaluate(readRoleplayFromDOM,{expectedRoleName});if(!report)continue;
    const navigation=await frame.evaluate(readExerciseNavigationFromDOM),pageURL=page.url(),frameURL=frame.url();found.push({...report,frame,navigation,pageURL,frameURL,binding:JSON.stringify([pageURL,frameURL,navigation.key])});
  }
  return found.length>1?{recognized:true,phase:'loading',issue:'多个框架显示分角色练习，尚未启动。'}:found[0]||null;
}

export async function completeRoleplay(engine,task,page,initial,settings,signal,options={}){
  engine.pages.protect(page,'roleplay-progress');await engine.disposeExerciseLearning(task.id);
  let reservation,bridges=[],token=randomUUID(),roleName=initial.roleName,sessionStarted=false,finished=false,lastState=initial;
  const read=async()=>{await engine.gate(task,signal);const fresh=await readRoleplay(engine,page,roleName);engine.assertEntryPage(page,initial.pageURL,fresh);let title='';try{title=JSON.parse(task.entryKey)[2];}catch{}
    if(!fresh||fresh.binding!==initial.binding||!fresh.navigation?.known||fresh.navigation.title!==title)throw new Error('分角色练习与所选目录项目已变化，尚未继续。');lastState=fresh;if(fresh.roleName)roleName=fresh.roleName;return fresh;};
  try{
    if(!isRoleplayEntry(task)||initial.issue)throw new Error(initial.issue||'当前目录不是 Oral practice 分角色练习。');
    let fresh=await read();
    if(fresh.phase!=='completed'){
      if(fresh.phase!=='choose'&&fresh.phase!=='ready')throw new Error('当前对话已有正在进行或未结束的进度，已保留，尚未重新开始。');
      if(fresh.hasRecordings)throw new Error('当前对话已有部分录音，已保留，尚未覆盖重录。');
      const prepared=await prepareShortOralAudio({directory:engine.store.directory||'.runtime',scope:task,oral:{key:initial.binding},speech:engine.oralSpeech,checkpoint:read,signal});
      reservation=await reserveOralPage(page,{token,pageURL:page.url()});
      if(reservation.reloadRequired){await page.reload({waitUntil:'domcontentloaded'});const loaded=await engine.waitQuestions(task,page,settings,signal,{allowUnsupported:true});if(!loaded?.roleplay)throw new Error('重载后未进入同一分角色练习。');fresh=await read();if(fresh.phase!=='choose'&&fresh.phase!=='ready'||fresh.hasRecordings)throw new Error('重载后的对话状态已变化，尚未开始。');}
      for(const frame of await engine.activeFrames(page)){await frame.evaluate(installRoleplayInputFromDOM,{token,pageURL:frame.url(),prompt:initial.instructions,waveBase64:prepared.audio.bytes.toString('base64'),ownerValidated:frame!==initial.frame});bridges.push(frame);}
      engine.store.addLog(task,'分角色对话已接入本地录音输入；不使用物理麦克风，不请求 AI。');
    }
    const click=async(current,kind,selector)=>{if(!await engine.action(current.frame,'roleplay',selector,{signal,checkpoint:read,beforeClick:async()=>{const fresh=await read();if(fresh.phase!==current.phase||kind==='stop'&&fresh.turn!==current.turn)throw new Error('点击前的对话步骤或当前台词已变化。');}}))throw new Error('当前分角色练习操作入口尚不可用。');};
    const result=await advanceRoleplay({initial,read,signal,checkpoint:()=>engine.gate(task,signal),choose:current=>click(current,'choose',current.chooseSelector),start:async current=>{await click(current,'start',current.startSelector);sessionStarted=true;},stop:async current=>{await sleep(400,undefined,{signal});await click(current,'stop',current.stopSelector);},resumePartner:async current=>{
      const fresh=await read();if(fresh.phase!=='partner'||fresh.rowIndex!==current.rowIndex||fresh.dialogueKey!==current.dialogueKey)throw new Error('对方台词已变化，尚未恢复播放。');
      await fresh.frame.evaluate(resumeRoleplayPartnerFromDOM,{rowIndex:fresh.rowIndex});engine.store.addLog(task,'对方台词音频意外暂停，已从当前位置恢复，等待下一句自动开始。');
    },onProgress:current=>engine.store.addLog(task,`分角色对话：${describeRoleplay(current)}。`),onStop:({turn,total})=>engine.store.addLog(task,`分角色对话：已结束 A 角色第 ${turn}/${total} 句，等待保存和下一句。`),...options});
    finished=true;
    task.answered+=result.stops;task.pages++;engine.store.changed();engine.store.addLog(task,`已核对 A 角色全部 ${result.total} 句录音完成，正在回查目录。`);
    const last=await read();
    if(settings.autoSubmit)await engine.action(last.frame,'submit',settings.submitSelector||'',{signal,checkpoint:async()=>{if((await read()).phase!=='completed')throw new Error('对话完成状态已变化，尚未提交。');}});
    else return {review:true,roleplayDone:true,message:'A 角色对话已完成，请核对后提交，再点击「继续核对」。'};
    return {roleplayDone:true};
  }catch(error){signal?.throwIfAborted();const reason=page.isClosed()?'课程窗口已关闭':String(error.message).replace(/https?:\/\/\S+/g,'[链接]');engine.store.addLog(task,`分角色对话中断：${reason}；${describeRoleplay(lastState)}。`,'warning');return {review:true,message:`${reason} 已保留已保存的分角色录音，请核对当前进度后继续。`};}
  finally{
    let safeToRelease=!sessionStarted||page.isClosed();
    if(sessionStarted&&!page.isClosed()){
      let fresh=await readRoleplay(engine,page,roleName).catch(()=>null);
      safeToRelease=finished||page.url()!==initial.pageURL||fresh?.phase==='completed'||fresh?.phase==='ready';
      if(fresh?.binding===initial.binding&&['recording','saving','partner'].includes(fresh.phase)){
        // The top microphone pauses the whole dialogue. Use it only during
        // cleanup, so the SDK cannot auto-start another turn after cancellation.
        await fresh.frame.locator(fresh.startSelector).click({timeout:1500,noWaitAfter:true}).catch(()=>{});
        fresh=await readRoleplay(engine,page,roleName).catch(()=>null);safeToRelease=!!fresh&&['ready','completed'].includes(fresh.phase);
      }
    }
    for(const frame of bridges)await frame.evaluate(roleplayInputActionFromDOM,{token,action:'dispose'}).catch(()=>{});
    if(safeToRelease)await reservation?.close();else engine.store.addLog(task,'未能确认整段对话已暂停，本地音频已停止并保持输入隔离；请关闭题页后重试。','warning');
  }
}
