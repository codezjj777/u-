import {setTimeout as sleep} from 'node:timers/promises';

export const liveTaskStatuses=new Set(['waiting','running','paused','review','stopping']);
/** @typedef {import('./shared/contracts.mjs').Task} Task */
export class TaskRuntime {
  constructor(store){this.store=store;this.controllers=new Map();this.runs=new Map();}
  busy(){return this.runs.size>0||this.store.data.tasks.some(task=>liveTaskStatuses.has(task.status));}
  control(id,action){
    const task=this.store.data.tasks.find(t=>t.id===id);
    if(!task||!liveTaskStatuses.has(task.status)||task.status==='stopping')throw new Error('此任务已结束或正在停止。');
    if(action==='stop'){
      task.status=this.runs.has(id)?'stopping':'stopped';this.controllers.get(id)?.abort();
      this.store.addLog(task,task.status==='stopping'?'正在停止，等待当前操作退出。':'任务已停止。已提交的答案不会撤回。');
    }else if(action==='pause'&&['running','waiting'].includes(task.status)){task.status='paused';this.store.addLog(task,'任务已暂停，当前已发出的单个操作结束后等待。');}
    else if(action==='resume'&&['paused','review'].includes(task.status)){task.status='running';this.store.addLog(task,'任务继续，将重新核对题目及当前必修项目的完成状态。');}
    else throw new Error('当前任务状态无法执行此操作。');
    this.store.changed();return task;
  }
  async gate(task,signal){
    signal?.throwIfAborted();while(['paused','review'].includes(task.status)){await sleep(100,undefined,{signal});}signal?.throwIfAborted();
    if(['stopped','stopping'].includes(task.status))throw new DOMException('任务已停止。','AbortError');
  }
  start(task,controller,work,onFinally=()=>{}){
    this.controllers.set(task.id,controller);
    const pending=Promise.resolve().then(work).catch(error=>{
      if(['stopping','stopped'].includes(task.status)){task.status='stopped';return;}
      const aborted=error?.name==='AbortError'||error?.code==='ABORT_ERR',reason=controller.signal.aborted?controller.signal.reason:error?.cause||error;
      const message=aborted?(reason?.message&&!/^(?:the |this )?operation (?:was )?aborted[.!]?$/i.test(reason.message)?reason.message:'任务操作已取消，请检查登录窗口后重新启动任务。'):error?.message||'任务中断，请检查登录窗口。';
      task.status='failed';this.store.addLog(task,message,'error');this.store.notice(`答题任务需要处理：${message}`);
    }).finally(async()=>{
      if(task.status==='stopping')task.status='stopped';
      try{await onFinally();}finally{this.controllers.delete(task.id);this.runs.delete(task.id);this.store.changed();}
    });
    this.runs.set(task.id,pending);return pending;
  }
  async close(){
    for(const task of this.store.data.tasks)if(liveTaskStatuses.has(task.status)){task.status=this.runs.has(task.id)?'stopping':'stopped';this.controllers.get(task.id)?.abort();}
    await Promise.allSettled(this.runs.values());
  }
}
export async function measureStage(task,stage,work){
  const started=performance.now();
  try{return await work();}finally{
    task.metrics||={};const previous=task.metrics[stage]||{count:0,totalMs:0};
    task.metrics[stage]={count:previous.count+1,totalMs:previous.totalMs+Math.round(performance.now()-started)};
  }
}
