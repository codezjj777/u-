import {authorization} from './local-access.mjs';

const activeStatuses=new Set(['waiting','running','paused','review','stopping']);

/** Open the study window only when doing so cannot navigate an existing task/draft. */
export async function openStudyWindow(base,{accessToken,fetchImpl=fetch,timeoutMs=65000}={}){
  const headers=authorization(accessToken);
  const stateResponse=await fetchImpl(`${base}/api/state`,{headers,signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!stateResponse.ok)throw new Error('工作台已启动，但无法读取登录窗口状态，请在工作台重试连接。');
  const state=await stateResponse.json();
  if(state.windowOpen)return {status:'already-open',message:'U校园专用窗口已打开，继续使用当前窗口。'};
  if(state.syncing||state.operation||(state.tasks||[]).some(task=>activeStatuses.has(task.status)))return {status:'busy',message:'已有操作正在进行，已保留当前任务；可从工作台继续。'};
  const response=await fetchImpl(`${base}/api/connect`,{
    method:'POST',headers:{...headers,'Content-Type':'application/json','X-UStudy':'1',Origin:base},body:'{}',redirect:'error',signal:AbortSignal.timeout(timeoutMs)
  });
  let result;try{result=await response.json();}catch{throw new Error('工作台已启动，但登录窗口未能确认打开，请在工作台重试连接。');}
  if(!response.ok)throw new Error(result.error||'登录窗口打开失败，请在工作台重试连接。');
  if(!result.windowOpen)throw new Error('登录窗口尚未确认打开，请在工作台重试连接。');
  return {status:'opened',message:'U校园专用窗口已打开；完成登录后，在工作台点击「同步课程」。'};
}
