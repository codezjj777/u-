import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {protectForCurrentUser,unprotectForCurrentUser,writePrivateFile} from './local-secrets.mjs';

export const LOCAL_AUTH='bearer-v1';
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const accessFile=(directory,port)=>path.join(directory,`local-access-${port}.json`);
const purpose='local access';

export function createAccessToken(){return randomBytes(32).toString('base64url');}
export function authorization(token){return token?{Authorization:`Bearer ${token}`} : {};}

export function hasLocalAccess(header,token){
  const supplied=header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  return !!supplied&&tokenPattern.test(token)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(token));
}

export async function publishLocalAccess(directory,port,instanceId,token){
  const record=JSON.stringify({instanceId,token});
  const content=process.platform==='win32'?JSON.stringify({protected:await protectForCurrentUser(record,purpose)}):record;
  await writePrivateFile(accessFile(directory,port),content);
}

export async function readLocalAccess(directory,port,instanceId){
  try{
    const file=JSON.parse(await readFile(accessFile(directory,port),'utf8'));
    const record=process.platform==='win32'?JSON.parse(await unprotectForCurrentUser(file.protected,purpose)):file;
    if(typeof instanceId==='string'&&record.instanceId===instanceId&&typeof record.token==='string'&&tokenPattern.test(record.token))return record.token;
  }catch{}
  throw new Error('无法验证本地服务。请使用启动后台的系统账号，从同一个 U Study 目录启动或停止。');
}

export function dashboardURL(base,token){return `${base}/#access=${token}`;}
