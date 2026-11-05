import {finishMediaPlayback,dragMediaProgress} from './media-playback.mjs';

export function isAudioViewEntry(scope){
  try{const [unit,path,title]=JSON.parse(scope.entryKey);return unit===scope.unitId&&Array.isArray(path)&&typeof title==='string'&&!!title.trim()&&!/\b(?:oral|speaking|recording|role.?play)\b|口语|录音|分角色/i.test(title);}
  catch{return false;}
}

/** Read a compact audio player, including a hidden native audio element. */
export function readAudioViewFromDOM(){
  const visible=el=>{
    if(!el?.getClientRects().length)return false;
    const box=el.getBoundingClientRect();if(box.width<=0||box.height<=0)return false;
    for(let node=el;node;node=node.parentElement){const css=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return false;}
    return true;
  };
  const clean=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  const names=['data-ustudy-audio-view','data-ustudy-audio-player','data-ustudy-audio-play','data-ustudy-audio-track','data-ustudy-audio-thumb'];
  for(const el of document.querySelectorAll(names.map(name=>`[${name}]`).join(',')))for(const name of names)el.removeAttribute(name);
  const ignored='aside,header,nav,.pc-slider-content,.v3notes,.word-tips,.question-vocabulary,.swiper-slide:not(.swiper-slide-active)';
  const outermost=elements=>elements.filter(el=>!elements.some(parent=>parent!==el&&parent.contains(el)));
  const enabled=el=>visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled=true],.disabled');
  const controls=root=>{
    // This player keeps its hidden audio beside a compact control bar inside
    // a full-width wrapper. Measure and bind the authored bar, not that wrapper.
    const bars=[...(root.matches('.audio-control.audio-control-bar')?[root]:[]),...root.querySelectorAll('.audio-control.audio-control-bar')].filter(visible);
    const area=bars.length===1?bars[0]:root,box=area.getBoundingClientRect();
    const plays=outermost([...area.querySelectorAll('button,[role=button],[class*=play],[class*=pause],[class*=caret-right]')].filter(el=>{
      if(!enabled(el)||el.matches('audio,video'))return false;
      const label=[el.getAttribute('aria-label'),el.getAttribute('title'),clean(el)].filter(Boolean).join(' '),rect=el.getBoundingClientRect();
      return (/^(?:播放|暂停|播放音频|暂停音频|开始播放|play|pause|play audio|pause audio)$/i.test(label)||/(?:^|[-_\s])(?:play|pause|caret-right)(?:[-_\s]|$)/i.test(String(el.className)))&&rect.left+rect.width/2<=box.left+box.width*.5;
    }));
    const trackLike=el=>{
      if(!enabled(el)||el.closest('[class*=volume]')||/volume|音量/i.test([el.className,el.getAttribute('aria-label')].join(' ')))return false;
      const rect=el.getBoundingClientRect();return rect.width>=Math.max(60,box.width*.3)&&rect.height>0&&rect.height<=45;
    };
    let tracks=outermost([...new Set([...area.querySelectorAll('.ant-slider,.rc-slider,.progress-slider,.audio-progress,.audio-progress-bar,.progress-bar,.progress-track,.seek-bar,input[type=range],[role=slider]')].map(el=>el.matches('[role=slider]')&&el.getBoundingClientRect().width<60?el.closest('.ant-slider,.rc-slider,.progress-slider')||el:el))].filter(trackLike));
    if(!tracks.length)tracks=outermost([...area.querySelectorAll('[class*=progress],[class*=seek],[class*=slider]')].filter(trackLike));
    const play=plays.length===1?plays[0]:null,track=tracks.length===1?tracks[0]:null;
    return {root:area,play,track,thumb:track?.querySelector('.ant-slider-handle,.rc-slider-handle,.progress-slider-thumb,[role=slider],.thumb,.handle'),plays,tracks};
  };
  const found=[];
  for(const audio of document.querySelectorAll('audio')){
    if(audio.closest(ignored))continue;
    const scope=audio.closest('.layout-container,.pc-main-container,main');if(!scope)continue;
    let root=null,player=null;
    for(let node=audio.parentElement;node&&node!==scope;node=node.parentElement){
      if(!visible(node)||node.querySelectorAll('audio').length!==1)continue;
      const candidate=controls(node);if(candidate.play&&candidate.track){root=candidate.root;player=candidate;break;}
    }
    if(!root){root=audio.closest('.question-audio-player,.audio-player,.audio-box,.audio-wrapper,.audio-container,.question-common-abs-audio')||audio.parentElement;if(!visible(root))continue;player=controls(root);root=player.root;}
    found.push({audio,scope,root,player});
  }
  if(!found.length)return null;
  if(found.length!==1)return {recognized:true,ready:false,requiresReview:true,issue:'当前页面有多个音频播放器，无法确认纯音频项目。'};
  const {audio,scope,root,player}=found[0];
  const fieldCSS='textarea,select,input:not([type=hidden]):not([type=button]):not([type=range]),[contenteditable=true],[contenteditable=""],[contenteditable="plaintext-only"],[role=radio],[role=checkbox],.option-wrap,.sortable-list-wrapper,.sequence-reply-view,.ucomp-recorder';
  const fields=[...scope.querySelectorAll(fieldCSS)].filter(el=>visible(el)&&!el.closest(ignored)&&!el.disabled&&!el.readOnly);
  const embedded=scope.querySelector('.popupBox input,.popupBox textarea,.popupBox .option,.questionReplyBox .option,[data-ipublish-question-group-type*="choice"],[data-ipublish-question-group-type*="blank"],.ucomp-recorder');
  const directions=[...scope.querySelectorAll('.abs-direction,.layout-direction-container,[data-question-direction]')].filter(visible).map(clean).join(' ');
  const otherMedia=[...scope.querySelectorAll('video')].some(el=>visible(el)&&!el.closest(ignored));
  const unsafe=fields.length||embedded||otherMedia||/\b(?:answer|questions?|choose|decide|fill|correct|true or false|record your)\b|回答|选择|判断|填空|作答|录音/i.test(directions);
  const sources=[audio.getAttribute('src'),...audio.querySelectorAll('source')].map(value=>typeof value==='string'?value:value?.getAttribute('src')).filter(Boolean),identity=JSON.stringify(sources.length?sources:[audio.currentSrc||'']);
  let hash=2166136261;for(const char of identity)hash=Math.imul(hash^char.charCodeAt(0),16777619);const sourceKey='audio-'+(hash>>>0).toString(36);
  const mark=(el,name)=>{if(el)el.setAttribute(name,sourceKey);return el?`[${name}="${sourceKey}"]`:null;};
  const ranges=value=>{const result=[];try{for(let i=0;i<Math.min(value.length,20);i++)result.push([value.start(i),value.end(i)]);}catch{}return result;};
  const duration=Number.isFinite(audio.duration)?audio.duration:null,currentTime=Number.isFinite(audio.currentTime)?audio.currentTime:0,loaded=duration>0&&duration<=7200&&audio.readyState>=1,controlsReady=!!(player.play&&player.track);
  const bounds=el=>{if(!el)return null;const box=el.getBoundingClientRect();return {left:box.left,top:box.top,width:box.width,height:box.height};};
  const thumbStyle=player.thumb?getComputedStyle(player.thumb):null;
  const thumbBounded=!!(player.track?.matches('.progress-slider')&&player.thumb?.matches('.progress-slider-thumb')&&thumbStyle?.position==='absolute'&&thumbStyle.transform==='none');
  return {recognized:true,ready:!!(loaded&&!unsafe&&!audio.loop&&!audio.error&&(controlsReady||audio.ended)),requiresReview:!!unsafe,sourceKey,duration,currentTime,paused:audio.paused,ended:audio.ended,seeking:audio.seeking,loop:audio.loop,playbackRate:audio.playbackRate,played:ranges(audio.played),seekable:ranges(audio.seekable),error:audio.error?.code||0,controlsReady,thumbBounded,directions,
    audioSelector:mark(audio,'data-ustudy-audio-view'),playerSelector:mark(root,'data-ustudy-audio-player'),playSelector:mark(player.play,'data-ustudy-audio-play'),trackSelector:mark(player.track,'data-ustudy-audio-track'),thumbSelector:mark(player.thumb,'data-ustudy-audio-thumb'),
    issue:unsafe?'音频页还有题目、作答要求、录音或其他播放器，尚未按纯音频处理。':!loaded?'音频时长或媒体元数据尚未就绪。':audio.loop?'音频处于循环播放，需要先人工核对。':audio.error?'音频媒体载入失败。':!controlsReady&&!audio.ended?'尚未识别到唯一的音频播放按钮和进度条。':'',
    controlHints:{player:String(root.className),play:player.plays.map(el=>String(el.className)).slice(0,6),track:player.tracks.map(el=>String(el.className)).slice(0,6),answerControls:fields.length,embeddedQuestion:!!embedded,
      geometry:{player:bounds(root),track:bounds(player.track),thumb:bounds(player.thumb),thumbStyle:thumbStyle?{left:thumbStyle.left,transform:thumbStyle.transform,position:thumbStyle.position}:null},
      elements:controlsReady?[]:[...root.querySelectorAll('*')].filter(visible).slice(0,28).map(el=>{const box=el.getBoundingClientRect();return {tag:el.tagName,class:el.getAttribute('class')||'',role:el.getAttribute('role')||'',type:el.getAttribute('type')||'',width:Math.round(box.width),height:Math.round(box.height),cursor:getComputedStyle(el).cursor};})}};
}

export const finishAudioView=options=>finishMediaPlayback({...options,kind:'audio'});
export const dragAudioProgress=(page,frame,record,target,options={})=>dragMediaProgress(page,frame,record,target,{...options,kind:'audio'});
