import {stat,rename,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {releaseFiles} from './release-files.mjs';

export const APP_VERSION='1.4.31';
export const APP_INFO=Object.freeze({version:APP_VERSION,modifiedAt:'2026-11-06'});
const sourceFiles=releaseFiles.filter(file=>/\.(?:mjs|js|py|html|css|cmd)$/.test(file)||['package.json','package-lock.json','speech-requirements.txt'].includes(file));
export async function sourceBuildId(directory=path.dirname(fileURLToPath(import.meta.url))){
  const sources=await Promise.all(sourceFiles.map(file=>readFile(path.join(directory,file))));
  const hash=createHash('sha256');
  for(const [index,source] of sources.entries())hash.update(sourceFiles[index]).update('\0').update(source).update('\0');
  return hash.digest('hex');
}
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
