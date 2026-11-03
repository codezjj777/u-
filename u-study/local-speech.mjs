import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runSpeechProcess} from './speech-process.mjs';

const worker=fileURLToPath(new URL('./speech_worker.py',import.meta.url));
const messages={missing_dependencies:'本地语音组件未安装，请运行「准备听力识别.cmd」。',missing_model:'本地语音模型未就绪，请运行「准备听力识别.cmd」。',no_audio:'该媒体没有可读取的音轨。',media_too_long:'音轨为空或超过 30 分钟，请手动核对本项目。',empty_audio:'没有读取到有效音频。',unclear_audio:'转写内容不足或语音不清晰，无法可靠作答。',invalid_media:'音视频文件无效或超过 150 MB。',speech_failed:'本地语音识别失败，请检查媒体文件或重新运行听力识别准备入口。'};
export const validTranscript=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=60000&&value.trim().split(/\s+/).length>=3;

export class LocalSpeech {
  constructor(directory,{runProcess=runSpeechProcess,timeoutMs=600000}={}){this.directory=path.resolve(directory,'speech');this.runProcess=runProcess;this.timeoutMs=timeoutMs;}
  async transcribe(body,{signal,onProgress=()=>{}}={}){
    signal?.throwIfAborted();
    if(!Buffer.isBuffer(body)||!body.length||body.length>150*1024*1024)throw new Error(messages.invalid_media);
    const digest=createHash('sha256').update('base.en-v1\0').update(body).digest('hex');
    const cacheDirectory=path.join(this.directory,'transcripts'),cacheFile=path.join(cacheDirectory,digest+'.json');
    const cached=await readFile(cacheFile,'utf8').then(JSON.parse).catch(()=>null);
    if(cached?.version===1&&cached.digest===digest&&validTranscript(cached.text)){onProgress('使用本机已缓存的音视频转写。');return {text:cached.text,source:'本地转写缓存'};}
    const executable=path.join(this.directory,'python',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(!await stat(executable).catch(()=>null))throw new Error(messages.missing_dependencies);
    await mkdir(path.join(this.directory,'tmp'),{recursive:true});await mkdir(cacheDirectory,{recursive:true});
    const temporary=await mkdtemp(path.join(this.directory,'tmp','audio-')),input=path.join(temporary,'input.media');
    try{
      await writeFile(input,body);signal?.throwIfAborted();onProgress('正在本机转写音轨，识别期间可以暂停或停止任务…');
      const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1'};
      delete env.USTUDY_API_KEY;delete env.OPENAI_API_KEY;delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
      let output,lastProgress=Date.now();
      try{
        output=await this.runProcess(executable,['-u',worker,'transcribe','--model-dir',path.join(this.directory,'model'),'--input',input],{signal,env,timeoutMs:this.timeoutMs,onMessage:message=>{
          if(message.event==='progress'&&message.duration&&Date.now()-lastProgress>15000){lastProgress=Date.now();onProgress(`本地转写进度：${Math.min(100,Math.round(message.seconds/message.duration*100))}%。`);}
        }});
      }catch(error){
        signal?.throwIfAborted();
        const result=String(error.stdout||'').trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).findLast(value=>value?.code);
        if(result?.code)throw new Error(messages[result.code]||messages.speech_failed);
        if(/超时/.test(error.message))throw error;
        throw new Error(messages.speech_failed);
      }
      signal?.throwIfAborted();
      const result=output.trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).findLast(value=>value?.ok===true);
      if(!validTranscript(result?.text)||!Number.isFinite(result?.duration)||result.duration<=0||result.duration>1800)throw new Error(messages.unclear_audio);
      const staging=path.join(temporary,'transcript.json');
      await writeFile(staging,JSON.stringify({version:1,digest,text:result.text,model:'base.en',duration:result.duration}));
      await rename(staging,cacheFile).catch(()=>onProgress('转写已完成，本次缓存未保存。'));
      return {text:result.text.trim(),source:'本地语音转写'};
    }finally{
      if(!temporary.startsWith(this.directory+path.sep))throw new Error('语音临时目录无效。');
      await rm(temporary,{recursive:true,force:true});
    }
  }
}
