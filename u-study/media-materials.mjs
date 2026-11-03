import {request} from 'playwright-core';
import {LocalSpeech,validTranscript} from './local-speech.mjs';

const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const mediaError=message=>Object.assign(new Error(message),{code:'MEDIA_READ'});
const decode=value=>value.replace(/<v\s+([^>]+)>/gi,'$1: ').replace(/<[^>]+>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[entity])).replace(/&#(\d+);/g,(_match,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
export function parseSubtitles(input){
  const value=String(input||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(value.length>1024*1024||/<(?:html|script)\b/i.test(value))return '';
  let cues=[];
  if(/<(?:tt|tt:tt)\b/i.test(value))cues=[...value.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/gi)].map(match=>decode(match[1]));
  else for(const block of value.split(/\n\s*\n/)){
    if(/^\s*(?:NOTE|STYLE|REGION)\b/.test(block))continue;
    const lines=block.split('\n'),index=lines.findIndex(line=>/(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(line));
    if(index>=0)cues.push(decode(lines.slice(index+1).join(' ')));
  }
  const output=[];for(const cue of cues.map(clean).filter(Boolean))if(output.at(-1)!==cue)output.push(cue);
  const text=output.join(' ');return validTranscript(text)?text:'';
}

export function validateMediaURL(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.hostname.includes(':')||/^(?:localhost$|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)||/\.(?:localhost|local|internal)$/i.test(url.hostname))return null;
    url.hash='';return url.href;
  }catch{return null;}
}

export async function downloadMedia(value,{context,referrer,signal,maxBytes=150*1024*1024,subtitle=false,requestFactory=request.newContext.bind(request)}={}){
  signal?.throwIfAborted();let url=validateMediaURL(value);if(!url)throw mediaError('当前媒体没有可直接读取的 HTTPS 地址；请检查字幕或手动核对流式媒体。');
  const cookies=await context.cookies([url,'https://ucontent.unipus.cn/']).catch(()=>{throw mediaError('媒体登录会话不可读取，请重新进入课程。');});signal?.throwIfAborted();
  const client=await requestFactory({storageState:{cookies,origins:[]},ignoreHTTPSErrors:false}).catch(()=>{throw mediaError('媒体下载会话未能建立，请稍后重试。');});
  const abort=()=>{client.dispose().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    for(let redirect=0;redirect<=3;redirect++){
      signal?.throwIfAborted();
      const origin=new URL(referrer||'https://ucontent.unipus.cn/').origin;
      const response=await client.get(url,{timeout:45000,maxRedirects:0,failOnStatusCode:false,headers:{Referer:origin+'/'}});
      signal?.throwIfAborted();const status=response.status(),headers=response.headers();
      if([301,302,303,307,308].includes(status)){
        const next=validateMediaURL(new URL(headers.location||'',url).href);if(!next||!headers.location)throw mediaError('媒体跳转地址不可读取。');url=next;continue;
      }
      const range=status===206?String(headers['content-range']||'').match(/^bytes\s+0-(\d+)\/(\d+)$/i):null;
      const completeRange=range&&Number(range[1])+1===Number(range[2]);
      if(status<200||status>=300||status===206&&!completeRange)throw mediaError(`媒体读取失败（HTTP ${status}），请检查课程登录状态。`);
      if(Number(headers['content-length']||0)>maxBytes)throw mediaError(subtitle?'字幕文件过大，已停止读取。':'音视频超过 150 MB，已停止读取。');
      const contentType=String(headers['content-type']||'').toLowerCase();
      if(/text\/html|application\/json/.test(contentType))throw mediaError('媒体地址返回了登录页或错误信息，请重新进入课程。');
      const body=await response.body();signal?.throwIfAborted();
      if(status===206&&body.length!==Number(range[2]))throw mediaError('媒体只返回了部分音视频，无法完整转写。');
      if(!body.length||body.length>maxBytes)throw mediaError('媒体内容为空或超过大小限制。');
      if(!subtitle&&(/mpegurl|dash\+xml/.test(contentType)||body.subarray(0,100).toString().trimStart().startsWith('#EXTM3U')))throw mediaError('当前媒体使用流式播放列表，需要可读取的字幕或音视频文件。');
      return body;
    }
    throw mediaError('媒体跳转次数过多，请重新进入课程。');
  }catch(error){signal?.throwIfAborted();if(error.code==='MEDIA_READ')throw error;throw mediaError('媒体下载失败或超时，请检查网络和课程登录状态。');}
  finally{signal?.removeEventListener('abort',abort);await client.dispose().catch(()=>{});}
}

export class MediaMaterials {
  constructor(directory,{download=downloadMedia,speech=new LocalSpeech(directory)}={}){this.download=download;this.speech=speech;}
  async resolve(record,{context,referrer,signal,checkpoint=async()=>{},onProgress=()=>{}}={}){
    const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
    await check();
    if(validTranscript(record.cueText))return {text:record.cueText,source:'播放器字幕'};
    const tracks=[...(record.tracks||[])].sort((a,b)=>Number(/^en\b/i.test(b.language))-Number(/^en\b/i.test(a.language)));
    for(const track of tracks){
      try{
        onProgress('正在读取音视频字幕…');
        const body=await this.download(track.url,{context,referrer,signal,subtitle:true,maxBytes:1024*1024});await check();
        const text=parseSubtitles(body.toString('utf8'));if(text)return {text,source:'音视频字幕'};
      }catch(error){signal?.throwIfAborted();await check();}
    }
    if(record.duration>1800)throw new Error('该音视频超过 30 分钟，需要手动核对。');
    let lastError;
    for(const source of record.sources||[]){
      await check();
      try{
        onProgress('网页没有可用字幕，正在读取本项目音轨…');
        const body=await this.download(source,{context,referrer,signal});await check();
        const result=await this.speech.transcribe(body,{signal,onProgress});await check();return result;
      }catch(error){signal?.throwIfAborted();await check();lastError=error;}
    }
    throw lastError||new Error('音视频地址尚未载入或使用了流式播放，请重新进入本项目后重试。');
  }
}
