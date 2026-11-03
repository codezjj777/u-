import {setTimeout as sleep} from 'node:timers/promises';

export async function advanceRoleplay({initial,read,choose,start,stop,resumePartner,checkpoint=async()=>{},onStop=()=>{},onProgress=()=>{},signal,pollMs=150,stepTimeoutMs=90000,totalTimeoutMs=900000,choiceTimeoutMs=10000,partnerResumeMs=2500,heartbeatMs=10000}){
  const fail=message=>Object.assign(new Error(message),{code:'ROLEPLAY_REVIEW'});
  const check=async()=>{signal?.throwIfAborted();const before=Date.now();await checkpoint();const paused=Date.now()-before;idleSince+=paused;deadline+=paused;if(choiceDeadline)choiceDeadline+=paused;signal?.throwIfAborted();};
  const binding=initial?.binding;if(!binding)throw fail('分角色对话缺少当前题目的目录身份。');
  let selected=false,started=false,stopped=new Set(),completed=new Set(),identity='',total=0,lastProgress='',lastHeartbeat=0,idleSince=Date.now(),deadline=Date.now()+totalTimeoutMs,choiceDeadline=0,partnerKey='',partnerSince=0,resumed=new Set();
  while(Date.now()<deadline){
    await check();const current=await read();
    if(!current||current.binding!==binding)throw fail('分角色对话的页面或活动项目已变化，已停止操作。');
    if(current.issue)throw fail(current.issue);
    if(current.phase==='choose'){
      if(started||identity)throw fail('对话退回了角色选择页，尚未重复开始。');
      // Selecting a role updates the course and slides its Swiper asynchronously.
      // The old chooser can remain active for several reads after a valid click.
      // Wait for the dialogue, never click A twice: selecting clears recordings.
      if(!selected){await check();await choose(current);selected=true;idleSince=Date.now();choiceDeadline=Date.now()+choiceTimeoutMs;onProgress({...current,phase:'choosing'});}
    }else if(current.phase!=='loading'){
      if(current.role!=='A')throw fail('当前对话角色不是 A，尚未继续录音。');
      if(!Number.isInteger(current.total)||current.total<1||current.total>120||!current.dialogueKey)throw fail('对话的角色、句数或台词尚未完整载入。');
      if(identity&&(identity!==current.dialogueKey||total!==current.total))throw fail('对话台词或角色句数发生变化，已保留当前进度。');
      identity=current.dialogueKey;total=current.total;
      for(const turn of current.completed||[]){if(!Number.isInteger(turn)||turn<0||turn>=total)throw fail('对话录音结果与角色句子无法对应。');completed.add(turn);}
      const progress=JSON.stringify([current.phase,current.rowIndex??current.turn,[...completed].sort(),current.phase==='partner'?current.partnerAudio?.time:null]);
      const phaseKey=JSON.stringify([current.phase,current.rowIndex??current.turn,[...completed].sort()]);
      if(progress!==lastProgress){lastProgress=progress;idleSince=Date.now();}
      if(phaseKey!==partnerKey){partnerKey=phaseKey;partnerSince=Date.now();lastHeartbeat=0;}
      if(!lastHeartbeat||Date.now()-lastHeartbeat>=heartbeatMs){onProgress(current);lastHeartbeat=Date.now();}
      const resumeKey=current.rowIndex;
      if(current.phase==='partner'&&Number.isInteger(resumeKey)&&resumeKey>=0&&current.partnerAudio?.paused&&!current.partnerAudio.ended&&current.partnerSelector&&resumePartner&&Date.now()-partnerSince>=partnerResumeMs&&!resumed.has(resumeKey)){
        if(current.partnerAudio.error)throw fail('对方台词音频加载失败，已保留已保存的录音，请检查网络或播放器。');
        await check();await resumePartner(current);resumed.add(resumeKey);idleSince=Date.now();
      }
      if(current.phase==='completed'){
        if(completed.size!==total)throw fail('对话结束提示尚不能对应全部角色录音，尚未确认完成。');
        return {total,stops:stopped.size};
      }
      if(current.phase==='ready'){
        if(started)throw fail('对话录音未完整结束便回到开始状态，尚未重复录音。');
        await check();await start(current);started=true;idleSince=Date.now();
      }else if(current.phase==='recording'){
        started=true;
        if(!Number.isInteger(current.turn)||current.turn<0||current.turn>=total||completed.has(current.turn))throw fail('当前录音句子无法唯一对应尚未完成的 A 角色台词。');
        if(!stopped.has(current.turn)){
          await check();await stop(current);stopped.add(current.turn);onStop({turn:current.turn+1,total});idleSince=Date.now();
        }
      }
    }
    if(selected&&!identity&&Date.now()>choiceDeadline)throw fail('角色选择后切换对话页面超时，尚未重复选择角色或开始录音。');
    if(Date.now()-idleSince>stepTimeoutMs)throw fail('等待下一句录音或保存结果超时，已保留对话进度；尚未重复点击结束。');
    await sleep(pollMs,undefined,{signal});
  }
  throw fail('分角色对话超过本次等待时限，已保留当前进度。');
}
