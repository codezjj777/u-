import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {downloadMedia} from './media-materials.mjs';
import {imageAsset,verifyBankImages,MAX_PAGE_IMAGE_BYTES} from './image-materials.mjs';
import {runSpeechProcess} from './speech-process.mjs';
const worker=fileURLToPath(new URL('./video_frames_worker.py',import.meta.url));
const failure=()=>new Error('视频画面尚未完整读取，不能仅凭音频判断眼神或动作；请检查视频地址和本地解码组件后重试。');
const stamp=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${(seconds%60).toFixed(2).padStart(5,'0')}`;
export class VideoFrames{
  constructor(directory,{download=downloadMedia,runProcess=runSpeechProcess}={}){this.root=path.resolve(directory);this.directory=path.join(this.root,'video-frames');this.download=download;this.runProcess=runProcess;}
  async resolve(record,{context,referrer,signal,checkpoint=async()=>{},count=12}={}){
    if(record.kind!=='video'||!Number.isInteger(count)||count<1||count>12)throw failure();
    const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};let body;
    for(const source of record.sources||[]){await check();try{body=await this.download(source,{context,referrer,signal});}catch{signal?.throwIfAborted();continue;}await check();break;}
    if(!Buffer.isBuffer(body)||!body.length||body.length>150*1024*1024)throw failure();
    const digest=createHash('sha256').update('video-frames-v1\0'+count+'\0').update(body).digest('hex'),cache=path.join(this.directory,digest+'.json');
    const validate=result=>{
      if(result?.version!==1||result.digest!==digest||!Number.isFinite(result.duration)||result.duration<=0||result.duration>1800||result.frames?.length!==count)throw failure();
      verifyBankImages([{imageAssets:[...new Map(result.frames.map(f=>[f.digest,f])).values()]}]);
      if(result.frames.some(f=>!Number.isFinite(f.time)||f.time<0||f.time>result.duration+0.5||f.width>640||f.height>360)||result.frames.reduce((sum,f)=>sum+f.dataURL.length*3/4,0)>MAX_PAGE_IMAGE_BYTES)throw failure();
      return result.frames.map((f,i)=>({...f,label:`Video frame ${i+1}/${count} @ ${stamp(f.time)} (sampled, not continuous video)`}));
    };
    const cached=await readFile(cache,'utf8').then(JSON.parse).catch(()=>null);if(cached)try{return validate(cached);}catch{}
    const executable=path.join(this.root,'speech','python',process.platform==='win32'?'Scripts/python.exe':'bin/python');if(!await stat(executable).catch(()=>null))throw failure();
    await mkdir(this.directory,{recursive:true});const temporary=await mkdtemp(path.join(this.directory,'tmp-'));
    try{
      const input=path.join(temporary,'input.media');await writeFile(input,body);await check();
      const output=await this.runProcess(executable,['-u',worker,'--input',input,'--output',temporary,'--count',String(count)],{signal,timeoutMs:120000});await check();
      const result=output.trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).findLast(value=>value?.ok);
      if(!result||result.frames?.length!==count)throw failure();
      const frames=[];for(const [i,f] of result.frames.entries()){if(f.file!==`frame-${String(i).padStart(2,'0')}.png`)throw failure();frames.push({...imageAsset(await readFile(path.join(temporary,f.file))),time:f.time});}
      const data={version:1,digest,duration:result.duration,frames},assets=validate(data),staging=path.join(temporary,'frames.json');await writeFile(staging,JSON.stringify(data));await rename(staging,cache).catch(()=>{});return assets;
    }catch(error){signal?.throwIfAborted();throw failure();}
    finally{if(!temporary.startsWith(this.directory+path.sep))throw failure();await rm(temporary,{recursive:true,force:true});}
  }
}

export async function mountVideoFramesFromDOM({key,selector,sources,frames}){
  const video=document.querySelector(selector);if(!video||video.tagName!=='VIDEO'||video.getAttribute('data-ustudy-media-key')!==key)throw new Error('视频材料已切换，尚未附加画面。');
  const urls=[video.getAttribute('src'),...Array.from(video.querySelectorAll('source')).map(el=>el.getAttribute('src'))].filter(Boolean).map(url=>new URL(url,document.baseURI).href);
  if(!urls.length||urls.some(url=>!sources.includes(url)))throw new Error('视频地址已变化，尚未附加画面。');
  const scope=video.closest('.layout-material-container,.question-common-abs-material,.layout-container,main');if(!scope)throw new Error('视频材料容器尚未就绪。');
  const activeKeys=[...scope.querySelectorAll('video[data-ustudy-media-key]')].map(el=>el.getAttribute('data-ustudy-media-key'));
  for(const el of scope.querySelectorAll('[data-ustudy-video-frames]'))if(el.getAttribute('data-ustudy-video-frames')===key||!activeKeys.includes(el.getAttribute('data-ustudy-video-frames')))el.remove();
  const group=document.createElement('section');group.setAttribute('data-ustudy-video-frames',key);group.style.cssText='position:fixed;left:-24000px;top:0;width:640px;pointer-events:none;';
  try{
    const images=frames.map(frame=>{const figure=document.createElement('figure'),caption=document.createElement('figcaption'),image=document.createElement('img');caption.textContent=frame.label;image.alt=frame.label;image.src=frame.dataURL;image.loading='eager';image.style.cssText='display:block;max-width:640px;';figure.append(caption,image);group.append(figure);return image;});scope.append(group);
    let timer;try{await Promise.race([Promise.all(images.map(image=>image.decode())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('视频画面解码超时。')),5000);})]);}finally{clearTimeout(timer);}if(images.some(image=>!image.complete||!image.naturalWidth))throw new Error('视频画面尚未解码。');
  }catch(error){group.remove();throw error;}
}
