// Temporary local audio for the course's normal recorder. No physical input
// device, browser permission, platform score or completion flag is changed.
export async function installRoleplayInputFromDOM({token,pageURL,prompt,waveBase64,maxRequests=240,ownerValidated=false}){
  if(location.protocol!=='https:'||location.href!==pageURL||!/(^|\.)unipus\.cn$/.test(location.hostname)||!prompt||!ownerValidated&&!document.body.textContent.replace(/\s+/g,' ').includes(prompt))throw new Error('分角色录音页面已变化，尚未接入本地音频。');
  if(window.__ustudyRoleplayInput||!window.__ustudyOralReservation||!navigator.mediaDevices||!window.AudioContext)throw new Error('分角色录音输入通道尚未就绪。');
  const context=new AudioContext(),bytes=Uint8Array.from(atob(waveBase64),char=>char.charCodeAt(0));let buffer;
  try{buffer=await context.decodeAudioData(bytes.buffer);}catch{await context.close();throw new Error('本地录音音频不能解码。');}
  if(buffer.duration<0.25||buffer.duration>10){await context.close();throw new Error('本地录音音频时长异常。');}
  const destination=context.createMediaStreamDestination(),source=context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(destination);
  let requests=0,started=false,disposed=false;const streams=[];
  const validate=()=>{if(disposed||location.href!==pageURL||!ownerValidated&&!document.body.textContent.replace(/\s+/g,' ').includes(prompt))throw new Error('对话页面已切换，本地录音输入已停止。');};
  const request=async constraints=>{
    validate();if(!constraints?.audio||constraints.video||requests>=maxRequests)throw new DOMException('本地录音仅供当前分角色对话使用。','NotAllowedError');
    await context.resume();validate();if(context.state!=='running')throw new Error('本地录音音频尚未启动。');if(!started){source.start();started=true;}
    requests++;const stream=destination.stream.clone();streams.push(stream);return stream;
  };
  const dispose=async()=>{if(disposed)return;disposed=true;try{source.stop();}catch{}for(const stream of [destination.stream,...streams])for(const track of stream.getTracks())track.stop();await context.close();if(window.__ustudyRoleplayInput?.token===token)delete window.__ustudyRoleplayInput;};
  try{await window.__ustudyOralReservation.arm(token,request);}catch(error){await dispose();throw error;}
  window.__ustudyRoleplayInput={token,status:()=>({token,requests,started,disposed}),dispose};return {token,requests,started};
}

export function roleplayInputActionFromDOM({token,action}){
  const input=window.__ustudyRoleplayInput;if(!input||input.token!==token)throw new Error('当前分角色录音通道已失效。');
  if(action==='status')return input.status();if(action==='dispose')return input.dispose();throw new Error('分角色录音通道操作无效。');
}
