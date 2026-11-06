import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';

function dpapi(operation, input, purpose){
  const failure=()=>new Error('Windows 当前用户的密钥保护不可用。');
  if(process.platform!=='win32')throw failure();
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const entropy=Buffer.from(`U Study ${purpose} v1`).toString('base64');
  const script=`$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$entropy = [Convert]::FromBase64String('${entropy}')
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$result = [Security.Cryptography.ProtectedData]::${operation}($bytes, $entropy, $scope)
[Console]::Write([Convert]::ToBase64String($result))`;
  const command=Buffer.from(script,'utf16le').toString('base64');
  const env={...process.env};
  for(const key of Object.keys(env))if(key.toUpperCase()==='USTUDY_API_KEY')delete env[key];
  // The secret travels through stdin/stdout, never through command arguments or logs.
  return new Promise((resolve,reject)=>{
    const child=execFile(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',command],
      {windowsHide:true,timeout:8000,maxBuffer:512*1024,env},(error,stdout)=>{
        const result=stdout.trim();
        if(error||!result||Buffer.from(result,'base64').toString('base64')!==result)reject(failure());
        else resolve(result);
      });
    child.stdin.on('error',()=>reject(failure()));
    child.stdin.end(input);
  });
}

export function protectForCurrentUser(value,purpose){
  return dpapi('Protect',Buffer.from(value,'utf8').toString('base64'),purpose);
}

export async function unprotectForCurrentUser(value,purpose){
  if(typeof value!=='string'||!value||value.length>512*1024)throw new Error('加密凭据格式无效。');
  return Buffer.from(await dpapi('Unprotect',value,purpose),'base64').toString('utf8');
}

export async function writePrivateFile(file,content){
  const temporary=`${file}.${randomUUID()}.tmp`;
  try{
    await writeFile(temporary,content,{encoding:'utf8',flag:'wx',mode:0o600});
    await rename(temporary,file);
  }finally{await unlink(temporary).catch(()=>{});}
}
