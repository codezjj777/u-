import {spawn} from 'node:child_process';

// Wait for close after cancellation so the task lock includes process cleanup.
export function runSpeechProcess(command,args,{signal,timeoutMs=600000,onMessage,onOutput,env=process.env,maxOutput=2*1024*1024}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env});
    let stdout='',pending='',outputSize=0,failure,closed=false;
    const stop=error=>{failure ||= error;if(!closed)child.kill();};
    const abort=()=>stop(signal.reason||new DOMException('任务已停止。','AbortError'));
    const timer=setTimeout(()=>stop(new Error('本地语音处理超时，请检查音视频长度后重试。')),timeoutMs);timer.unref();
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      outputSize+=Buffer.byteLength(chunk);if(outputSize>maxOutput){stop(new Error('语音识别输出过长，已停止。'));return;}
      stdout+=chunk;onOutput?.(chunk);pending+=chunk;
      for(let end;(end=pending.indexOf('\n'))>=0;){const line=pending.slice(0,end).trim();pending=pending.slice(end+1);try{if(line)onMessage?.(JSON.parse(line));}catch{/* Libraries may write an ordinary progress line. */}}
    });
    child.stderr.on('data',chunk=>{outputSize+=Buffer.byteLength(chunk);if(outputSize>maxOutput)stop(new Error('语音处理错误输出过长，已停止。'));onOutput?.(chunk);});
    child.once('error',error=>{failure ||= error;});
    child.once('close',code=>{
      closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(failure)reject(failure);else if(code!==0)reject(Object.assign(new Error('本地语音处理未完成。'),{exitCode:code,stdout}));else resolve(stdout);
    });
    if(signal?.aborted)abort();
  });
}
