import {randomUUID} from 'node:crypto';

const pageReservations=new WeakMap();
function reserveCaptureFromDOM({binding}){
  if(!navigator.mediaDevices||window.__ustudyOralReservation)return;
  const relay=window.__ustudyOralRelay?.binding===binding?window.__ustudyOralRelay:{binding,current:null};window.__ustudyOralRelay=relay;
  let route,resolveRoute,rejectRoute,closed=false,token='',requests=0;
  const pending=new Promise((resolve,reject)=>{resolveRoute=resolve;rejectRoute=reject;});pending.catch(()=>{});
  const originals=[],lease=async()=>{const value=await window[binding]();token=value?.token||'';return value;};
  function restore(){if(closed)return;closed=true;for(const {owner,key,descriptor,wrapper} of originals)if(owner[key]===wrapper){if(descriptor)Object.defineProperty(owner,key,descriptor);else delete owner[key];}if(window.__ustudyOralReservation?.binding===binding)delete window.__ustudyOralReservation;}
  function install(owner,key,legacy){
    const original=owner[key];if(typeof original!=='function')return;const descriptor=Object.getOwnPropertyDescriptor(owner,key);
    // SDKs may retain this wrapper across several question pages. Resolve the
    // current lease each time, rather than retaining a finished page's input.
    const request=async args=>{const active=await lease();if(!active)return Reflect.apply(original,owner,args);const current=relay.current;if(active.blocked||!current)throw new DOMException('本题仅允许课程中的合成语音输入。','NotAllowedError');return current.request(active.token,args[0]);};
    const wrapper=legacy?function(...args){request(args).then(args[1],typeof args[2]==='function'?args[2]:()=>{});}:function(...args){return request(args);};
    Object.defineProperty(owner,key,{configurable:true,writable:true,value:wrapper});originals.push({owner,key,descriptor,wrapper});
  }
  install(navigator.mediaDevices,'getUserMedia',false);for(const key of ['getUserMedia','webkitGetUserMedia','mozGetUserMedia','msGetUserMedia'])install(navigator,key,true);
  const reservation={binding,status:()=>({token,requests,closed}),request:async(value,constraints)=>{if(closed||token&&token!==value)throw new DOMException('本页口语输入已结束。','NotAllowedError');token=value;requests++;const handler=route||await pending;return handler(constraints);},arm:async(value,handler)=>{const active=await lease();if(!active||active.token!==value||active.blocked||closed)throw new Error('口语输入预留已失效。');route=handler;resolveRoute(handler);},close:()=>{rejectRoute(new DOMException('当前口语任务已结束。','AbortError'));if(relay.current===reservation)relay.current=null;restore();}};
  window.__ustudyOralReservation=reservation;relay.current=reservation;
  lease().then(value=>{if(!value)restore();}).catch(()=>{});
}

export async function reserveOralPage(page,{token,pageURL}){
  let holder=pageReservations.get(page);
  if(!holder){
    holder={binding:'__ustudyOralLease_'+randomUUID().replaceAll('-',''),session:null};pageReservations.set(page,holder);
    await page.exposeBinding(holder.binding,source=>{
      const session=holder.session;if(!session)return null;
      if(source.page!==page||page.isClosed()||page.url()!==session.pageURL)return {blocked:true};
      let permitted=false;try{const url=new URL(source.frame.url());permitted=url.protocol==='https:'&&/(^|\.)unipus\.cn$/.test(url.hostname);}catch{}
      return permitted?{token:session.token}:{blocked:true};
    });
    await page.addInitScript(reserveCaptureFromDOM,{binding:holder.binding});
  }
  if(holder.session)throw new Error('本页已有正在准备的口语输入。');holder.session={token,pageURL};
  let reloadRequired;
  try{
    reloadRequired=!(await page.evaluate(binding=>window.__ustudyOralRelay?.binding===binding,holder.binding));
    for(const frame of page.frames())await frame.evaluate(reserveCaptureFromDOM,{binding:holder.binding});
  }catch(error){holder.session=null;for(const frame of page.frames())await frame.evaluate(()=>window.__ustudyOralReservation?.close()).catch(()=>{});throw error;}
  return {reloadRequired,close:async()=>{if(holder.session?.token!==token)return;holder.session=null;for(const frame of page.frames())await frame.evaluate(()=>window.__ustudyOralReservation?.close()).catch(()=>{});}};
}

// Installs a temporary generated-audio input for one explicitly selected oral
// task. No system input devices, browser permissions or platform grades change.
export async function installOralInputFromDOM({token,pageURL,prompt,waveBase64,maxSeconds=180,ownerValidated=false}){
  if(location.protocol!=='https:'||location.href!==pageURL||!/(^|\.)unipus\.cn$/.test(location.hostname)||!prompt||!ownerValidated&&!document.body.textContent.replace(/\s+/g,' ').includes(prompt))throw new Error('口语页面或复述要求已变化，尚未接入音频。');
  if(window.__ustudyOralInput)throw new Error('已有尚未结束的口语音频输入。');
  if(!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!=='function'||!window.AudioContext)throw new Error('当前页面没有可用的标准音频输入接口。');
  const media=navigator.mediaDevices,reservation=window.__ustudyOralReservation,own=Object.getOwnPropertyDescriptor(media,'getUserMedia');
  const context=new AudioContext(),bytes=Uint8Array.from(atob(waveBase64),value=>value.charCodeAt(0));let buffer;
  try{buffer=await context.decodeAudioData(bytes.buffer);}catch(error){await context.close();throw new Error('本地合成语音不能解码。');}
  if(buffer.duration<0.25||buffer.duration>maxSeconds){await context.close();throw new Error('合成语音时长不在当前题目范围内。');}
  const destination=context.createMediaStreamDestination(),analyser=context.createAnalyser(),source=context.createBufferSource();destination.channelCount=1;source.buffer=buffer;source.connect(analyser);analyser.connect(destination);
  let used=false,requests=0,started=false,complete=false,cancelled=false,heard=false,start=0,disposed=false;const clones=[];
  const validate=()=>{if(disposed||location.href!==pageURL||!ownerValidated&&!document.body.textContent.replace(/\s+/g,' ').includes(prompt))throw new Error('当前口语题已变化，音频输入已停止。');};
  const replacement=async constraints=>{
    validate();if(!constraints?.audio||constraints.video||requests>=4)throw new DOMException('本次合成音频仅供当前一条口语录音使用。','NotAllowedError');
    used=true;requests++;const stream=destination.stream.clone();clones.push(stream);return stream;
  };
  source.onended=()=>{if(started&&!cancelled)complete=true;};
  const status=()=>{
    if(!disposed&&started&&!complete){const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);let energy=0;for(const sample of samples)energy+=sample*sample;if(Math.sqrt(energy/samples.length)>0.001)heard=true;}
    return {token,used,requests,started,complete,cancelled,heard,duration:buffer.duration,elapsed:started?Math.min(buffer.duration,Math.max(0,context.currentTime-start)):0,contextState:context.state};
  };
  const dispose=async()=>{
    if(disposed)return;cancelled=!complete;disposed=true;
    try{source.stop();}catch{}for(const stream of [destination.stream,...clones])for(const track of stream.getTracks())track.stop();await context.close();
    if(reservation)reservation.close();else if(media.getUserMedia===replacement){if(own)Object.defineProperty(media,'getUserMedia',own);else delete media.getUserMedia;}
    if(window.__ustudyOralInput?.token===token)delete window.__ustudyOralInput;
  };
  try{if(reservation)await reservation.arm(token,replacement);else Object.defineProperty(media,'getUserMedia',{configurable:true,writable:true,value:replacement});}catch(error){for(const track of destination.stream.getTracks())track.stop();await context.close();throw error;}
  window.__ustudyOralInput={token,status,dispose,play:async()=>{validate();if(!used||started)throw new Error('课程尚未接收本次音频，或音频已经播放。');await context.resume();if(context.state!=='running')throw new Error('合成音频尚未获得播放条件。');started=true;start=context.currentTime;source.start();return status();}};
  return status();
}

export function oralInputActionFromDOM({token,action}){
  const input=window.__ustudyOralInput;if(!input||input.token!==token)throw new Error('当前口语合成音频输入已失效。');
  if(action==='status')return input.status();if(action==='play')return input.play();if(action==='dispose')return input.dispose();throw new Error('口语音频操作无效。');
}
