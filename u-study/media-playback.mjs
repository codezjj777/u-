import {setTimeout as sleep} from 'node:timers/promises';

// Native EOF is authoritative; the container's duration can extend beyond the
// last decoded sample. Verify real playback reaches that actual endpoint.
const playedAtPosition=state=>state.currentTime>0&&(state.played||[]).some(([start,end])=>start<state.currentTime&&end>=state.currentTime-.12&&end-start>=Math.min(.05,state.duration/4));
const playedToEnd=state=>state.ended&&!state.seeking&&playedAtPosition(state);
const reviewFor=kind=>message=>Object.assign(new Error(message),{code:kind==='audio'?'AUDIO_VIEW_REVIEW':'VIDEO_VIEW_REVIEW'});

/** Seek using the authored controls, then observe the native final playback. */
export async function finishMediaPlayback({initial,read,play,pause,seek,checkpoint=async()=>{},onProgress=()=>{},signal,playTimeoutMs=10000,seekTimeoutMs=8000,endTimeoutMs=20000,pollMs=100,kind='video'}){
  const label=kind==='audio'?'音频':'视频',review=reviewFor(kind);
  const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
  if(!initial?.ready||!initial.binding||!(initial.duration>0))throw review(initial?.issue||`纯${label}页尚未就绪。`);
  const binding=initial.binding,duration=initial.duration;
  const bound=fresh=>{if(!fresh||fresh.binding!==binding)throw review(`${label}或当前目录项目发生变化，已停止播放处理。`);if(fresh.requiresReview||fresh.error||fresh.loop||Math.abs((fresh.duration||0)-duration)>.15)throw review(fresh.issue||`${label}状态或时长发生变化，已停止播放处理。`);};
  const wait=async(predicate,timeout,message,onElapsed)=>{
    let elapsed=0,latest;while(elapsed<timeout){await check();const started=Date.now(),fresh=await read();bound(fresh);latest=fresh;elapsed+=Date.now()-started;if(predicate(fresh)){onElapsed?.(elapsed);return fresh;}if(elapsed<timeout){const delay=Math.min(pollMs,timeout-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;}}
    throw review(message+(kind==='audio'&&Number.isFinite(latest?.currentTime)?`（当前位置 ${latest.currentTime.toFixed(2)} / ${duration.toFixed(2)} 秒）`:''));
  };
  const hold=async current=>{
    if(current.paused||playedToEnd(current))return current;
    if(!pause)throw review(`${label}正在播放，尚未确认暂停，已停止拖动处理。`);
    await check();await pause(current);
    return wait(fresh=>playedToEnd(fresh)||fresh.paused,playTimeoutMs,`尚未确认${label}暂停，已停止拖动处理。`);
  };
  await check();let current=await read();bound(current);
  if(playedToEnd(current))return {duration,seeked:false};
  current=await hold(current);if(playedToEnd(current))return {duration,seeked:false};
  let seeked=false;
  if(!playedToEnd(current)&&duration>1.05&&current.currentTime<duration-1.05){
    const target=duration-1;onProgress('seeking',current);
    current=await wait(fresh=>!fresh.seeking&&(!Array.isArray(fresh.seekable)||fresh.seekable.some(([start,end])=>target>=start&&target<=end)),seekTimeoutMs,`${label}尚不支持拖动到结束前一秒，请等待缓冲后重试。`);
    current=await hold(current);await check();await seek(current,target);seeked=true;
    current=await wait(fresh=>!fresh.seeking&&!fresh.ended&&fresh.currentTime>=target-.55&&fresh.currentTime<=target+.55&&fresh.currentTime<duration-.025,seekTimeoutMs,`进度条未停在结束前约一秒，已停止处理，请核对${label}。`);
    onProgress('seeked',current);
  }
  current=await hold(current);const start=current.currentTime;
  const pausedAtTail=fresh=>kind==='audio'&&fresh.paused&&!fresh.ended&&!fresh.seeking&&fresh.currentTime>=duration-1.05&&fresh.currentTime>start+.025&&playedAtPosition(fresh);
  const advancedFrom=position=>fresh=>playedToEnd(fresh)||!fresh.seeking&&fresh.currentTime>position+.025&&(!fresh.paused||pausedAtTail(fresh));
  if(!playedToEnd(current)){await check();const result=await play(current);if(result?.clicked)onProgress('play-clicked',current);}
  current=await wait(advancedFrom(start),playTimeoutMs,`${label}未确认开始播放，已停止处理，请检查播放器。`);
  onProgress('playing',current);
  onProgress('waiting-end',current);
  let remaining=endTimeoutMs,resumes=0;const spend=elapsed=>{remaining=Math.max(0,remaining-elapsed);};
  while(!playedToEnd(current)){
    current=await wait(fresh=>playedToEnd(fresh)||pausedAtTail(fresh),remaining,`尚未确认${label}自然播放结束，已保留${label}页，请检查缓冲或播放状态。`,spend);
    if(playedToEnd(current))break;
    if(remaining<=0)throw review('音频末尾播放等待超时，已保留当前位置，请检查播放器后继续。');
    if(resumes++>=1)throw review('音频再次在末尾暂停，已保留当前位置，请检查播放器后继续。');
    // Resume only after observed final playback was unexpectedly paused. The
    // caller revalidates the same player; its checkpoint respects pause/stop.
    onProgress('resuming-end',current);await check();const position=current.currentTime,result=await play(current);if(result?.clicked)onProgress('play-clicked',current);
    current=await wait(advancedFrom(position),Math.min(playTimeoutMs,remaining),'尚未确认音频从暂停位置继续播放，已保留音频页，请检查播放器。',spend);
    onProgress('resumed',current);
  }
  await check();const final=await read();bound(final);if(!playedToEnd(final))throw review(`${label}结束状态发生变化，尚未确认完成。`);
  onProgress('ended',final);return {duration,seeked};
}

export async function dragMediaProgress(page,frame,record,target,{signal,checkpoint=async()=>{},kind='video'}={}){
  const label=kind==='audio'?'音频':'视频',review=reviewFor(kind);
  signal?.throwIfAborted();await checkpoint();
  if(!Number.isFinite(target)||target<0||target>=record.duration||Array.isArray(record.seekable)&&!record.seekable.some(([start,end])=>target>=start&&target<=end))throw review(`当前${label}尚不支持定位到结束前一秒，请等待缓冲或手动核对。`);
  const track=frame.locator(record.trackSelector);
  if(kind==='audio')await track.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}),undefined,{timeout:3000});
  else await track.scrollIntoViewIfNeeded({timeout:3000});
  const box=await track.boundingBox();if(!box||box.width<20||box.height<=0)throw review(`${label}进度条尚不可定位。`);
  const thumb=record.thumbSelector?await frame.locator(record.thumbSelector).boundingBox():null;
  const bounded=kind==='audio'&&record.thumbBounded;
  if(bounded&&(!thumb||thumb.width<=0||thumb.width>=box.width))throw review('音频滑块尺寸尚不可定位。');
  // ReactSlider's thumb travels inside the rail; its center starts and ends
  // half a thumb width inward. Ant sliders with translated thumbs use the rail.
  const inset=bounded?thumb.width/2:0,width=box.width-inset*2;
  const point=fraction=>({x:box.x+inset+Math.max(.25,Math.min(width-.25,width*fraction)),y:box.y+box.height/2});
  const from=thumb?{x:thumb.x+thumb.width/2,y:thumb.y+thumb.height/2}:point(record.currentTime/record.duration),to=point(target/record.duration);
  await checkpoint();signal?.throwIfAborted();await page.mouse.move(from.x,from.y);await page.mouse.down();
  try{signal?.throwIfAborted();await page.mouse.move(to.x,to.y,{steps:8});signal?.throwIfAborted();}
  finally{await page.mouse.up();}
}
