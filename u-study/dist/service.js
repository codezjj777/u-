/* Local service transport: retries reads, never replays a submitted action. */
(() => {
  const LOCAL_URL='http://127.0.0.1:4173/';
  const unavailable=message=>Object.assign(new Error(message),{code:'SERVICE_UNAVAILABLE'});
  const validState=value=>value&&Array.isArray(value.courses)&&Array.isArray(value.tasks)&&Array.isArray(value.activity)&&value.settings&&typeof value.settings==='object'&&!Array.isArray(value.settings);
  function applyPatch(snapshot,patch){
    if(!snapshot||patch.instanceId!==undefined&&snapshot.instanceId!==patch.instanceId||snapshot.revision!==patch.baseRevision||!Number.isInteger(patch.revision)||patch.revision<=patch.baseRevision)return null;
    const tasks=new Map(snapshot.tasks.map(task=>[task.id,task]));
    for(const update of patch.updates||[]){
      if(update.replace){tasks.set(update.id,update.replace);continue;}
      const previous=tasks.get(update.id);if(!previous)return null;
      const next={...previous,...update.fields};
      if(update.logs)next.logs=[...(previous.logs||[]).slice(update.logs.drop),...update.logs.append];
      tasks.set(update.id,next);
    }
    const order=patch.order||snapshot.tasks.map(task=>task.id);if(order.some(id=>!tasks.has(id)))return null;
    return {...snapshot,...patch.changes,revision:patch.revision,tasks:order.map(id=>tasks.get(id))};
  }

  function createClient({fetchImpl=(...args)=>fetch(...args),EventSourceImpl=globalThis.EventSource,location=globalThis.location,onState=()=>{},onNotice=()=>{},onConnectionChange=()=>{},schedule=setTimeout,cancel=clearTimeout,retryDelay=1500,requestTimeout=65000,probeTimeout=4000}={}){
    const localPage=location?.protocol==='http:'&&['127.0.0.1','localhost'].includes(location?.hostname);
    const wrongPage=`当前页面未连接到 U Study 本地服务，请从 ${LOCAL_URL} 打开工作台。`;
    let online=false,reported=null,stopped=true,stream=null,retryTimer=null,nextDelay=retryDelay,connecting=null,generation=0,lifetime=new AbortController(),probe=null,snapshot=null;
    function accept(value){
      if(snapshot&&value.instanceId===snapshot.instanceId&&Number.isInteger(value.revision)&&value.revision<snapshot.revision)return snapshot;
      snapshot=value;setOnline(true);onState(value);return value;
    }

    function setOnline(value){
      if(value&&stopped)return;
      online=value;
      if(value){if(retryTimer!==null)cancel(retryTimer);retryTimer=null;nextDelay=retryDelay;}
      if(reported!==value){reported=value;onConnectionChange(value);}
    }
    function retry(){
      if(stopped||!localPage||retryTimer!==null||online)return;
      const delay=nextDelay;nextDelay=Math.min(nextDelay*2,10000);
      retryTimer=schedule(()=>{retryTimer=null;if(!stopped&&!online)return refresh().catch(()=>{});},delay);
    }
    function offline(){setOnline(false);retry();}
    async function raw(path,data,method,signal,timeout){
      if(!localPage){offline();throw unavailable(wrongPage);}
      const lifetimeSignal=lifetime.signal,timeoutSignal=AbortSignal.timeout(timeout),combined=AbortSignal.any([lifetimeSignal,timeoutSignal,...(signal?[signal]:[])]);
      let response;
      try{
        response=await fetchImpl(`/api${path}`,{method:data===undefined?'GET':method,headers:{'Content-Type':'application/json','X-UStudy':'1'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:combined});
      }catch(error){
        if(signal?.aborted||lifetimeSignal.aborted)throw error;
        if(timeoutSignal.aborted&&path!=='/state')throw Object.assign(new Error('本次操作等待超时，已取消。请核对当前状态后再重试。'),{code:'REQUEST_TIMEOUT'});
        offline();throw unavailable('暂时无法连接本地服务，正在自动重连。请确认「启动 U Study.cmd」仍在运行。');
      }
      let result;
      try{result=await response.json();}
      catch(error){if(signal?.aborted||lifetimeSignal.aborted)throw error;if(timeoutSignal.aborted&&path!=='/state')throw Object.assign(new Error('本次操作等待超时，请核对当前状态后再重试。'),{code:'REQUEST_TIMEOUT'});offline();throw unavailable(wrongPage);}
      if(path!=='/state')setOnline(true);
      if(!response.ok)throw Object.assign(new Error(result?.error||'操作未完成，请重试。'),{status:response.status});
      return result;
    }
    function refresh(){
      if(connecting)return connecting;
      const revision=generation;probe=new AbortController();
      const pending=(async()=>{
        const value=await raw('/state',undefined,'GET',probe.signal,probeTimeout);
        if(stopped||revision!==generation)throw new DOMException('连接检查已取消。','AbortError');
        if(!validState(value)){offline();throw unavailable(wrongPage);}
        return accept(value);
      })().finally(()=>{if(connecting===pending){connecting=null;probe=null;}});
      connecting=pending;
      pending.catch(()=>{if(!stopped&&!online)retry();});
      return pending;
    }
    function openStream(){
      if(stream||!localPage||!EventSourceImpl)return;
      try{
        stream=new EventSourceImpl('/api/events');
        stream.addEventListener('state',event=>{
          let value;try{value=JSON.parse(event.data);}catch{return;}
          if(stopped||!validState(value))return;
          accept(value);
        });
        stream.addEventListener('patch',event=>{
          if(stopped)return;let patch;try{patch=JSON.parse(event.data);}catch{return;}
          const value=applyPatch(snapshot,patch);
          if(!value){
            void refresh().then(()=>{
              // A fetch already in progress may have captured an older snapshot.
              // Once it completes, issue a fresh read if the missed patch is newer.
              if(!stopped&&(patch.instanceId===undefined||patch.instanceId===snapshot?.instanceId)&&snapshot?.revision<patch.revision)return refresh();
            }).catch(()=>{});return;
          }accept(value);
        });
        stream.addEventListener('notice',event=>{try{onNotice(JSON.parse(event.data));}catch{}});
        stream.addEventListener('error',()=>{if(!stopped)offline();});
      }catch{stream=null;}
    }
    function activate(){if(stopped){stopped=false;generation++;lifetime=new AbortController();}openStream();}
    function start(){activate();return refresh();}
    function ensureConnected(){activate();return online?Promise.resolve():refresh();}
    async function request(path,data,method='POST',signal){
      if(path==='/state'){activate();return refresh();}
      await ensureConnected();return raw(path,data,method,signal,requestTimeout);
    }
    function stop(){
      stopped=true;generation++;lifetime.abort();probe?.abort();connecting=null;probe=null;
      if(retryTimer!==null)cancel(retryTimer);retryTimer=null;stream?.close();stream=null;setOnline(false);
    }
    return Object.freeze({start,stop,request,ensureConnected,isConnected:()=>online});
  }
  globalThis.UStudyService=Object.freeze({createClient,LOCAL_URL,applyPatch});
})();
