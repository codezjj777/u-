const labels={connect:'连接登录窗口',sync:'同步课程',open:'打开课程',catalog:'读取目录',answer:'处理答题任务',settings:'保存设置'};

/** One owner for operations that navigate the shared browser or change task settings. */
export class OperationManager {
  constructor(onChange=()=>{}){this.active=null;this.closing=false;this.onChange=onChange;this.pending=new Set();}
  acquire(kind,{signal,timeoutMs=180000}={}){
    signal?.throwIfAborted();
    if(this.closing)throw Object.assign(new Error('服务正在关闭，请稍后重试。'),{status:503});
    if(this.active)throw Object.assign(new Error(`正在${labels[this.active.kind]||'处理操作'}，请等待结束。`),{status:409});
    const controller=new AbortController(),timeout=timeoutMs?setTimeout(()=>controller.abort(Object.assign(new Error('操作超时，已取消，请检查课程窗口后重试。'),{status:408})),timeoutMs):null;
    timeout?.unref();
    const lease={kind,startedAt:Date.now(),signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,abort:reason=>controller.abort(reason),release:()=>{
      if(this.active!==lease)return;clearTimeout(timeout);this.active=null;this.onChange(null);
    }};
    this.active=lease;this.onChange({kind,label:labels[kind],startedAt:lease.startedAt});return lease;
  }
  track(promise){const tracked=promise.finally(()=>this.pending.delete(tracked));this.pending.add(tracked);return tracked;}
  run(kind,work,options){
    let lease;try{lease=this.acquire(kind,options);}catch(error){return Promise.reject(error);}
    return this.track(Promise.resolve().then(()=>{lease.signal.throwIfAborted();return work(lease.signal);}).then(result=>{lease.signal.throwIfAborted();return result;}).finally(()=>lease.release()));
  }
  async close(){this.closing=true;this.active?.abort(new Error('服务正在关闭。'));await Promise.allSettled(this.pending);}
}
