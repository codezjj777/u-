import {setTimeout as sleep} from 'node:timers/promises';

export const VIDEO_VIEW_HANDLER='video-view-v1';
export function isVideoViewEntry(scope){
  try{const [unit,path,title]=JSON.parse(scope.entryKey);return unit===scope.unitId&&Array.isArray(path)&&typeof title==='string'&&!!title.trim()&&!/\b(?:exercise|quiz|test|assessment|oral practice)\b|练习|测试|测验|口语/i.test(title);}
  catch{return false;}
}

/** Read public media state and player controls, without starting or seeking it. */
export function readVideoViewFromDOM(){
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden="true"],[inert]')&&el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');
  const clean=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  for(const el of document.querySelectorAll('[data-ustudy-video-view],[data-ustudy-video-player],[data-ustudy-video-play],[data-ustudy-video-track],[data-ustudy-video-thumb]'))for(const name of ['data-ustudy-video-view','data-ustudy-video-player','data-ustudy-video-play','data-ustudy-video-track','data-ustudy-video-thumb'])el.removeAttribute(name);
  const videos=[...document.querySelectorAll('video')].filter(el=>visible(el)&&!el.closest('aside,header,nav,.pc-slider-content,.v3notes,.word-tips,.question-vocabulary,.swiper-slide:not(.swiper-slide-active)'));
  if(!videos.length)return null;
  const blocked=issue=>({recognized:true,ready:false,requiresReview:true,issue});
  if(videos.length!==1)return blocked('当前页面有多个视频，无法确认纯视频项目。');
  const video=videos[0],scope=video.closest('.layout-container,.pc-main-container,main');if(!scope)return null;
  // Unipus wraps a controls-disabled Video.js instance in its own player. The
  // visible controls belong to the outer wrapper, not the hidden VJS toolbar.
  const root=video.closest('.question-video-player,.video-box,.question-video-point-read')||video.closest('.video-js,.prism-player,.dplayer,.plyr,.xgplayer')||video.parentElement;
  const ignored='aside,.pc-slider-content,.v3notes,.word-tips';
  const fields=[...scope.querySelectorAll('textarea,select,input:not([type=hidden]):not([type=button]):not([type=range]),[contenteditable=true],[contenteditable="plaintext-only"],[role=radio],[role=checkbox],.option-wrap,.sortable-list-wrapper,.sequence-reply-view,.ucomp-recorder')].filter(el=>visible(el)&&!el.closest(ignored)&&!el.closest('.vjs-control-bar,.prism-controlbar,.dplayer-controller,.plyr__controls')&&!el.disabled&&!el.readOnly);
  const embedded=(root.closest('.question-video-point-read')||root).querySelector('.popupBox input,.popupBox textarea,.popupBox .option,.questionReplyBox .option,[data-ipublish-question-group-type*="choice"],[data-ipublish-question-group-type*="blank"]');
  const directions=[...scope.querySelectorAll('.abs-direction,.layout-direction-container,[data-question-direction]')].filter(visible).map(clean).join(' ');
  const unsafe=fields.length||embedded||/\b(?:answer|questions?|choose|decide|fill|correct|true or false|record your)\b|回答|选择|判断|填空|作答|录音/i.test(directions);
  const sources=[video.getAttribute('src'),...video.querySelectorAll('source')].map(value=>typeof value==='string'?value:value?.getAttribute('src')).filter(Boolean),identity=JSON.stringify(sources.length?sources:[video.currentSrc||'']);
  let hash=2166136261;for(const char of identity)hash=Math.imul(hash^char.charCodeAt(0),16777619);const sourceKey='video-'+(hash>>>0).toString(36);
  const box=video.getBoundingClientRect(),enabled=el=>visible(el)&&!el.matches(':disabled,[aria-disabled="true"],.disabled');
  const outermost=elements=>elements.filter(el=>!elements.some(parent=>parent!==el&&parent.contains(el)));
  let plays=[...root.querySelectorAll('.vjs-play-control,.prism-play-btn,.dplayer-play-icon,[data-plyr=play],xg-play,.xgplayer-play')].filter(enabled);
  if(!plays.length)plays=outermost([...root.querySelectorAll('button,[role=button],[class*="play"],[class*="pause"]')].filter(el=>{
    if(!enabled(el)||el===video)return false;const label=[el.getAttribute('aria-label'),el.getAttribute('title'),clean(el)].filter(Boolean).join(' '),rect=el.getBoundingClientRect();
    return (/^(?:播放|暂停|播放视频|暂停视频|play|pause)$/i.test(label)||/(?:^|[-_\s])(?:play|pause)(?:[-_\s]|$)/i.test(el.className||''))&&rect.top+rect.height/2>=box.top+box.height*.7&&rect.left+rect.width/2<=box.left+box.width*.35;
  }));
  const progressTrack=el=>{
    if(!enabled(el)||/volume|音量/i.test([el.className,el.getAttribute('aria-label')].join(' '))||el.closest('[class*="volume"]'))return false;const rect=el.getBoundingClientRect();
    return rect.width>=box.width*.65&&rect.height>0&&rect.height<=45&&rect.top>=box.top+box.height*.7&&rect.top<=box.bottom+55;
  };
  let tracks=outermost([...new Set([...root.querySelectorAll('.vjs-progress-holder,.prism-progress,.dplayer-bar-wrap,.plyr__progress input[type=range],xg-progress,.xgplayer-progress,.ant-slider,.rc-slider,[role=slider][aria-label*="进度"],[role=slider][aria-label*="Seek"],[role=slider][aria-label*="Progress"]')].map(el=>el.matches('[role=slider]')&&el.getBoundingClientRect().width<box.width*.65?el.closest('.ant-slider,.rc-slider')||el:el))].filter(progressTrack));
  if(!tracks.length)tracks=outermost([...root.querySelectorAll('[class*="progress"],[class*="seek"],[class*="slider"],[role=slider]')].filter(progressTrack));
  const play=plays.length===1?plays[0]:null,track=tracks.length===1?tracks[0]:null,thumb=track?.querySelector('.vjs-slider-handle,.prism-progress-cursor,.dplayer-thumb,.ant-slider-handle,.rc-slider-handle,[role=slider],.thumb,.handle');
  const mark=(el,name)=>{if(el)el.setAttribute(name,sourceKey);return el?`[${name}="${sourceKey}"]`:null;};
  const ranges=value=>{const found=[];try{for(let i=0;i<Math.min(value.length,20);i++)found.push([value.start(i),value.end(i)]);}catch{}return found;};
  const duration=Number.isFinite(video.duration)?video.duration:null,currentTime=Number.isFinite(video.currentTime)?video.currentTime:0;
  const controlsReady=!!(play&&track),loaded=duration>0&&duration<=7200&&video.readyState>=1;
  return {recognized:true,ready:!!(loaded&&!unsafe&&!video.loop&&!video.error&&(controlsReady||video.ended)),requiresReview:!!unsafe,sourceKey,duration,currentTime,paused:video.paused,ended:video.ended,seeking:video.seeking,loop:video.loop,playbackRate:video.playbackRate,played:ranges(video.played),seekable:ranges(video.seekable),error:video.error?.code||0,controlsReady,directions,
    videoSelector:mark(video,'data-ustudy-video-view'),playerSelector:mark(root,'data-ustudy-video-player'),playSelector:mark(play,'data-ustudy-video-play'),trackSelector:mark(track,'data-ustudy-video-track'),thumbSelector:mark(thumb,'data-ustudy-video-thumb'),
    issue:unsafe?'视频页还有题目、作答要求或弹出题，尚未按纯视频处理。':!loaded?'视频时长或媒体元数据尚未就绪。':video.loop?'视频处于循环播放，需要先人工核对。':video.error?'视频媒体载入失败。':!controlsReady&&!video.ended?'尚未识别到唯一的播放按钮和进度条。':'',
    controlHints:{player:root.className,play:plays.map(el=>el.className).slice(0,6),track:tracks.map(el=>el.className).slice(0,6),answerControls:fields.map(el=>el.className).slice(0,6),embeddedQuestion:!!embedded,classes:[...new Set([...root.querySelectorAll('[class]')].filter(el=>visible(el)&&!el.closest('.vjs-controls-disabled')).map(el=>String(el.className)).filter(name=>/play|progress|slider|control|seek|pause/i.test(name)))].slice(0,24)}};
}

const review=message=>Object.assign(new Error(message),{code:'VIDEO_VIEW_REVIEW'});
const playedToEnd=state=>state.ended&&state.currentTime>=state.duration-.12&&(state.played||[]).some(([start,end])=>end>=state.duration-.12&&end-start>=Math.min(.05,state.duration/4));

/** Only ordinary play/seek callbacks mutate the player; ended is read natively. */
export async function finishVideoView({initial,read,play,pause,seek,checkpoint=async()=>{},onProgress=()=>{},signal,playTimeoutMs=10000,seekTimeoutMs=8000,endTimeoutMs=20000,pollMs=100}){
  const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
  if(!initial?.ready||!initial.binding||!(initial.duration>0))throw review(initial?.issue||'纯视频页尚未就绪。');
  const binding=initial.binding,duration=initial.duration;
  const bound=fresh=>{if(!fresh||fresh.binding!==binding)throw review('视频或当前目录项目发生变化，已停止播放处理。');if(fresh.requiresReview||fresh.error||fresh.loop||Math.abs((fresh.duration||0)-duration)>.15)throw review(fresh.issue||'视频状态或时长发生变化，已停止播放处理。');};
  const wait=async(predicate,timeout,message)=>{
    let elapsed=0;while(elapsed<timeout){await check();const started=Date.now(),fresh=await read();bound(fresh);if(predicate(fresh))return fresh;elapsed+=Date.now()-started;if(elapsed<timeout){const delay=Math.min(pollMs,timeout-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;}}
    throw review(message);
  };
  const hold=async current=>{
    if(current.paused||playedToEnd(current))return current;
    if(!pause)throw review('视频正在播放，尚未确认暂停，已停止拖动处理。');
    await check();await pause(current);
    return wait(fresh=>playedToEnd(fresh)||fresh.paused,playTimeoutMs,'尚未确认视频暂停，已停止拖动处理。');
  };
  await check();let current=await read();bound(current);
  if(playedToEnd(current))return {duration,seeked:false};
  current=await hold(current);if(playedToEnd(current))return {duration,seeked:false};
  let seeked=false;
  if(!playedToEnd(current)&&duration>1.05&&current.currentTime<duration-1.05){
    const target=duration-1;onProgress('seeking',current);
    current=await wait(fresh=>!fresh.seeking&&(!Array.isArray(fresh.seekable)||fresh.seekable.some(([start,end])=>target>=start&&target<=end)),seekTimeoutMs,'视频尚不支持拖动到结束前一秒，请等待缓冲后重试。');
    current=await hold(current);await check();await seek(current,target);seeked=true;
    current=await wait(fresh=>!fresh.seeking&&!fresh.ended&&fresh.currentTime>=target-.55&&fresh.currentTime<=target+.55&&fresh.currentTime<duration-.025,seekTimeoutMs,'进度条未停在结束前约一秒，已停止处理，请核对视频。');
    onProgress('seeked',current);
  }
  current=await hold(current);const start=current.currentTime;
  if(!playedToEnd(current)){await check();await play(current);}
  current=await wait(fresh=>playedToEnd(fresh)||!fresh.paused&&!fresh.seeking&&fresh.currentTime>start+.025,playTimeoutMs,'视频未确认开始播放，已停止处理，请检查播放器。');
  onProgress('playing',current);
  onProgress('waiting-end',current);current=await wait(playedToEnd,endTimeoutMs,'尚未确认视频自然播放结束，已保留视频页，请检查缓冲或播放状态。');
  await check();const final=await read();bound(final);if(!playedToEnd(final))throw review('视频结束状态发生变化，尚未确认完成。');
  onProgress('ended',final);return {duration,seeked};
}

export async function dragVideoProgress(page,frame,record,target,{signal,checkpoint=async()=>{}}={}){
  signal?.throwIfAborted();await checkpoint();
  if(!Number.isFinite(target)||target<0||target>=record.duration||Array.isArray(record.seekable)&&!record.seekable.some(([start,end])=>target>=start&&target<=end))throw review('当前视频尚不支持定位到结束前一秒，请等待缓冲或手动核对。');
  const track=frame.locator(record.trackSelector);await track.scrollIntoViewIfNeeded({timeout:3000});
  const box=await track.boundingBox();if(!box||box.width<20||box.height<=0)throw review('视频进度条尚不可定位。');
  let start=record.thumbSelector?await frame.locator(record.thumbSelector).boundingBox():null;
  const point=fraction=>({x:box.x+Math.max(.25,Math.min(box.width-.25,box.width*fraction)),y:box.y+box.height/2});
  const from=start?{x:start.x+start.width/2,y:start.y+start.height/2}:point(record.currentTime/record.duration),to=point(target/record.duration);
  await checkpoint();signal?.throwIfAborted();await page.mouse.move(from.x,from.y);await page.mouse.down();
  try{signal?.throwIfAborted();await page.mouse.move(to.x,to.y,{steps:8});signal?.throwIfAborted();}
  finally{await page.mouse.up();}
}
