/* Local service transport: retries reads, never replays a submitted action. */
(() => {
  const LOCAL_URL='http://127.0.0.1:4173/';
  const unavailable=message=>Object.assign(new Error(message),{code:'SERVICE_UNAVAILABLE'});
  const wrongPage=`当前页面未连接到 U Study 本地服务，请双击「一键启动.cmd」打开工作台（默认地址 ${LOCAL_URL}）。`;
  const accessError=()=>Object.assign(new Error('本地访问未授权，请双击「一键启动.cmd」重新打开工作台。'),{code:'LOCAL_AUTH_REQUIRED',status:401});
  const isLocalPage=location=>location?.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);
  const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
  const tokenKey='ustudy-local-access';
  function readPageToken(){
    const location=globalThis.location;
    if(!isLocalPage(location))return;
    const fragment=location.hash;
    if(fragment.startsWith('#access=')){
      const token=fragment.slice('#access='.length);
      history.replaceState(history.state,'',location.pathname+location.search);
      if(validToken(token)){
        try{sessionStorage.setItem(tokenKey,token);}catch{}
        return token;
      }
    }
    try{return sessionStorage.getItem(tokenKey);}catch{}
  }
  const pageToken=readPageToken();

  async function fetchLocal(path,options,{fetchImpl=fetch,location=globalThis.location,accessToken=pageToken}={}){
    if(!isLocalPage(location))throw unavailable(wrongPage);
    if(!validToken(accessToken))throw accessError();
    const response=await fetchImpl(`/api${path}`,{...options,
      headers:{...options.headers,Authorization:`Bearer ${accessToken}`},mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store'});
    if(response.status===401){await response.body?.cancel();throw accessError();}
    return response;
  }

  async function readEvents(fetcher,onEvent,signal){
    const response=await fetcher('/events',{headers:{Accept:'text/event-stream'},signal});
    if(!response.ok||!response.headers.get('Content-Type')?.startsWith('text/event-stream')||!response.body){
      await response.body?.cancel();
      throw unavailable('本地事件流暂时不可用。');
    }
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='';
    try{
      // The local server sends one JSON data line per event and LF heartbeats.
      while(!signal.aborted){
        const {done,value}=await reader.read();
        if(done)break;
        const searchFrom=Math.max(0,buffer.length-1);
        buffer+=decoder.decode(value,{stream:true});
        let start=0,end=buffer.indexOf('\n\n',searchFrom);
        while(end!==-1){
          const event=buffer.slice(start,end).match(/^event: (state|patch|notice)\ndata: ([\s\S]+)$/);
          start=end+2;end=buffer.indexOf('\n\n',start);
          if(!event)continue;
          let data;try{data=JSON.parse(event[2]);}catch{continue;}
          onEvent(event[1],data);
        }
        buffer=buffer.slice(start);
      }
    }finally{await reader.cancel().catch(()=>{});}
  }

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

  function createClient({fetchImpl=fetch,openEvents=readEvents,location=globalThis.location,accessToken=pageToken,onState=()=>{},onNotice=()=>{},onConnectionChange=()=>{},schedule=setTimeout,cancel=clearTimeout,retryDelay=1500,requestTimeout=65000,probeTimeout=4000}={}){
    const localPage=isLocalPage(location);
    const fetcher=(path,options)=>fetchLocal(path,options,{fetchImpl,location,accessToken});
    let accessRequired=localPage&&!validToken(accessToken);
    let online=false,reported=null,stopped=true,stream=null,retryTimer=null,nextDelay=retryDelay,connecting=null,generation=0,lifetime=new AbortController(),probe=null,snapshot=null,shutdownResponse=null,shutdownPending=null;
    function accept(value){
      if(snapshot&&value.instanceId===snapshot.instanceId&&Number.isInteger(value.revision)&&value.revision<snapshot.revision)return snapshot;
      snapshot=value;setOnline(true);onState(value);retry();return value;
    }

    function setOnline(value){
      if(value&&stopped)return;
      online=value;
      if(value&&(stream||!openEvents)){cancelRetry();nextDelay=retryDelay;}
      const connection=accessRequired?'unauthorized':value?'online':'offline';
      if(reported!==connection){reported=connection;onConnectionChange(value,accessRequired);}
    }
    function cancelRetry(){if(retryTimer!==null)cancel(retryTimer);retryTimer=null;}
    function retry(){
      if(stopped||!localPage||accessRequired||retryTimer!==null||(online&&(stream||!openEvents)))return;
      const delay=nextDelay;nextDelay=Math.min(nextDelay*2,10000);
      retryTimer=schedule(()=>{
        retryTimer=null;if(stopped||accessRequired)return;
        openStream();if(!online)return refresh().catch(()=>{});
      },delay);
    }
    function offline(){setOnline(false);retry();}
    function denyAccess(){accessRequired=true;cancelRetry();closeStream();setOnline(false);}
    async function raw(path,data,method,signal,timeout){
      if(!localPage){offline();throw unavailable(wrongPage);}
      if(accessRequired){denyAccess();throw accessError();}
      const lifetimeSignal=lifetime.signal,timeoutSignal=AbortSignal.timeout(timeout),combined=AbortSignal.any([lifetimeSignal,timeoutSignal,...(signal?[signal]:[])]);
      let response;
      try{
        response=await fetcher(path,{method:data===undefined?'GET':method,headers:{'Content-Type':'application/json','X-UStudy':'1'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:combined});
      }catch(error){
        if(signal?.aborted||lifetimeSignal.aborted)throw error;
        if(error.code==='LOCAL_AUTH_REQUIRED'){denyAccess();throw error;}
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
      if(stream||!localPage||accessRequired||!openEvents)return;
      const controller=new AbortController();stream=controller;
      function ended(error){
        if(stream!==controller)return;
        stream=null;
        if(error?.code==='LOCAL_AUTH_REQUIRED')denyAccess();
        else offline();
      }
      function onEvent(type,data){
        if(stream!==controller||stopped)return;
        if(type==='state'){if(validState(data))accept(data);return;}
        if(type==='notice'){onNotice(data);return;}
        const patch=data,value=applyPatch(snapshot,patch);
        if(value){accept(value);return;}
        void refresh().then(()=>{
          // A fetch already in progress may have captured an older snapshot.
          if(!stopped&&(patch.instanceId===undefined||patch.instanceId===snapshot?.instanceId)&&snapshot?.revision<patch.revision)return refresh();
        }).catch(()=>{});
      }
      void openEvents(fetcher,onEvent,controller.signal).then(()=>ended(),ended);
    }
    function closeStream(){stream?.abort();stream=null;}
    function activate(){if(stopped){stopped=false;generation++;lifetime=new AbortController();}openStream();}
    function start(){activate();return refresh();}
    function ensureConnected(){activate();return online?Promise.resolve():refresh();}
    async function request(path,data,method='POST',signal){
      if(path==='/state'){activate();return refresh();}
      await ensureConnected();return raw(path,data,method,signal,requestTimeout);
    }
    function stop(){
      stopped=true;generation++;lifetime.abort();probe?.abort();connecting=null;probe=null;
      cancelRetry();closeStream();setOnline(false);
    }
    function shutdown({signal,onProgress=()=>{},timeoutMs=25000,pollMs=250}={}){
      if(shutdownPending)return shutdownPending;
      const pending=(async()=>{
        if(!shutdownResponse){
          onProgress('saving');
          const result=await request('/shutdown',{},'POST',signal);
          if(result?.accepted!==true)throw new Error('后台尚未确认退出请求，请重试。');
          shutdownResponse=result;stop();
        }
        onProgress('stopping');let refused=0;const deadline=Date.now()+timeoutMs,instanceId=snapshot?.instanceId;
        while(Date.now()<deadline){
          signal?.throwIfAborted();
          try{
            const response=await fetchImpl('/api/health',{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(probeTimeout),...(signal?[signal]:[])])});
            refused=0;
            if(response.ok){
              const health=await response.json();
              if(health?.app!=='u-study'||instanceId&&health.instanceId&&health.instanceId!==instanceId)throw Object.assign(new Error('检测到程序已重新启动，请刷新工作台后再退出。'),{code:'SERVICE_RESTARTED'});
            }
          }catch(error){
            signal?.throwIfAborted();if(error.code==='SERVICE_RESTARTED')throw error;
            if(error.name==='TypeError'){if(++refused>=2)return shutdownResponse;}else refused=0;
          }
          if(pollMs>0)await new Promise(resolve=>setTimeout(resolve,pollMs));
        }
        throw Object.assign(new Error('尚未确认后台退出，请重试退出，或运行「一键停止.cmd」。'),{code:'SHUTDOWN_TIMEOUT'});
      })().finally(()=>{if(shutdownPending===pending)shutdownPending=null;});
      shutdownPending=pending;return pending;
    }
    return Object.freeze({start,stop,request,shutdown,ensureConnected,isConnected:()=>online});
  }
  globalThis.UStudyService=Object.freeze({createClient,fetchLocal,LOCAL_URL,applyPatch});
})();
