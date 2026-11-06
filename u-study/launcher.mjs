import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { openDashboard } from './server.mjs';
import {assertRuntime,rotateLogs,APP_VERSION,sourceBuildId} from './runtime-check.mjs';
import {openStudyWindow} from './workspace-start.mjs';
import {LOCAL_AUTH,authorization,readLocalAccess} from './local-access.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const url=`http://127.0.0.1:${port}`;
const runtime=path.join(root,'.runtime');

async function serviceInfo(){
  try{
    const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1200),redirect:'error'});
    const health=await response.json().catch(()=>null);
    if(health?.app==='u-study'){
      if(response.ok&&health.ok===true)return {status:'running',version:health.version||'未知版本',buildId:health.buildId,instanceId:health.instanceId,localAuth:health.localAuth};
      if(response.status===503&&health.starting===true)return {status:'starting'};
    }
    return {status:'occupied'};
  }catch(error){return {status:error.cause?.code==='ECONNREFUSED'?'stopped':'unresponsive'};}
}
async function serviceStatus(){return (await serviceInfo()).status;}

async function waitForStatus(expected,timeout=20000){
  const deadline=Date.now()+timeout;
  do{
    const status=await serviceStatus();
    if(status===expected)return;
    if(status==='occupied')throw new Error(`${port} 端口被其他程序占用，请设置 PORT 后重试。`);
    await delay(250);
  }while(Date.now()<deadline);
  throw new Error(expected==='running'?`服务启动超时，请查看 ${path.join(runtime,'server-error.log')}`:'服务仍在关闭中，请稍后重试。');
}

async function startBackground(){
  await mkdir(runtime,{recursive:true});await rotateLogs(runtime);
  const output=await open(path.join(runtime,'server.log'),'a');
  const errors=await open(path.join(runtime,'server-error.log'),'a');
  try{
    await output.write(`\n[${new Date().toISOString()}] 启动本地服务 v${APP_VERSION}\n`);
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',output.fd,errors.fd]});
      child.once('error',reject);
      child.once('spawn',()=>{child.unref();resolve();});
    });
  }finally{await output.close();await errors.close();}
}

function requestShutdown(token){
  return fetch(`${url}/api/shutdown`,{method:'POST',headers:{...authorization(token),'Content-Type':'application/json','X-UStudy':'1',Origin:url},body:'{}',signal:AbortSignal.timeout(25000),redirect:'error'});
}

export async function main(args=process.argv.slice(2),{startService=startBackground,readAccess=readLocalAccess}={}){
  assertRuntime();
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT 必须是 1024 到 65535 之间的端口。');
  const accessFor=(info,allowLegacy=false)=>{
    if(info.localAuth===LOCAL_AUTH)return readAccess(runtime,port,info.instanceId);
    if(allowLegacy&&info.localAuth===undefined)return;
    throw new Error('后台的本地访问协议与启动器不兼容，请停止后台后重新启动。');
  };
  const service=await serviceInfo();let status=service.status;
  if(status==='occupied')throw new Error(`${port} 端口被其他程序占用，请设置 PORT 后重试。`);
  if(args.includes('--stop')){
    if(status==='stopped'){console.log('U Study 已停止。');return;}
    if(status!=='running')throw new Error('服务暂时没有响应，无法确认安全关闭。请查看 .runtime 中的日志。');
    const response=await requestShutdown(await accessFor(service,true));
    if(!response.ok)throw new Error((await response.json()).error||'服务未能关闭。');
    await waitForStatus('stopped');console.log('U Study 已停止，课程与登录数据已保留。');return;
  }
  const buildId=await sourceBuildId(root),matchesBuild=info=>info.version===APP_VERSION&&info.buildId===buildId;
  if(status==='running'&&!matchesBuild(service)){
    const token=await accessFor(service,true);
    const response=await fetch(`${url}/api/state`,{headers:authorization(token),signal:AbortSignal.timeout(4000),redirect:'error'});
    const state=response.ok?await response.json():null;
    if(!state||state.windowOpen||state.syncing||state.operation||(state.tasks||[]).some(task=>['waiting','running','paused','review','stopping'].includes(task.status)))throw Object.assign(new Error(`当前后台尚未加载本机代码更新（后台 v${service.version} / 本机 v${APP_VERSION}）。请先保存草稿，点击「安全退出」或双击「一键停止.cmd」，再重新启动；本次未复用旧后台。`),{code:'OUTDATED_SERVICE'});
    console.log('检测到后台尚未加载本机代码更新，当前没有任务或登录窗口，正在重新加载…');
    const stopped=await requestShutdown(token);
    if(!stopped.ok)throw new Error('旧后台未能正常关闭，请使用停止入口后重新启动。');
    await waitForStatus('stopped');status='stopped';
  }
  if(status==='stopped')await startService();
  if(status!=='running')await waitForStatus('running');
  const ready=await serviceInfo();if(!matchesBuild(ready))throw new Error('后台尚未加载本机最新代码，请检查服务日志后重新启动。');
  const accessToken=await accessFor(ready);
  console.log(`U Study v${ready.version} 已就绪：${url}\n服务在后台运行，关闭此窗口不会中断工作台。\n需要退出时，双击「停止 U Study.cmd」。`);
  if(!args.includes('--no-open'))await openDashboard(url,accessToken);
  if(args.includes('--all')){
    console.log('正在检查并打开 U校园专用窗口…');
    const result=await openStudyWindow(url,{accessToken});console.log(result.message);return result;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`启动器：${error.message}`);process.exitCode=1;});
