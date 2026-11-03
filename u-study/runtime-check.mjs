import {stat,rename} from 'node:fs/promises';
import path from 'node:path';

export const APP_VERSION='1.4.20';
export function assertRuntime(version=process.versions.node){
  const [major,minor]=version.split('.').map(Number);
  if(!Number.isInteger(major)||major<20||major===20&&minor<19)throw new Error('需要 Node.js 20.19 或更新版本，请更新后启动。');
}
export async function rotateLogs(directory,{maxBytes=2*1024*1024,keep=3}={}){
  for(const name of ['server.log','server-error.log']){
    const file=path.join(directory,name),info=await stat(file).catch(()=>null);if(!info||info.size<maxBytes)continue;
    for(let index=keep-1;index>=1;index--)await rename(file+'.'+index,file+'.'+(index+1)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await rename(file,file+'.1');
  }
}
