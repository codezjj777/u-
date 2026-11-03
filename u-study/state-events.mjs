const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>JSON.parse(JSON.stringify(value));
function logDelta(oldLogs=[],newLogs=[]){
  let overlap=Math.min(oldLogs.length,newLogs.length);
  while(overlap&&!same(oldLogs.slice(-overlap),newLogs.slice(0,overlap)))overlap--;
  return {drop:oldLogs.length-overlap,append:newLogs.slice(overlap)};
}

/** A patch only contains changed fields and changed task/log records. */
export function stateDelta(previous,next){
  const changes={};
  for(const key of new Set([...Object.keys(previous),...Object.keys(next)])){
    if(!['tasks','revision'].includes(key)&&!same(previous[key],next[key]))changes[key]=next[key]??null;
  }
  const before=new Map(previous.tasks.map(task=>[task.id,task])),updates=[];
  for(const task of next.tasks){
    const old=before.get(task.id);if(!old){updates.push({id:task.id,replace:task});continue;}
    if(same(old,task))continue;
    const fields={};
    for(const key of new Set([...Object.keys(old),...Object.keys(task)]))if(key!=='logs'&&!same(old[key],task[key]))fields[key]=task[key]??null;
    updates.push({id:task.id,fields,...(!same(old.logs,task.logs)?{logs:logDelta(old.logs,task.logs)}:{})});
  }
  const oldOrder=previous.tasks.map(task=>task.id),order=next.tasks.map(task=>task.id);
  return {instanceId:next.instanceId,baseRevision:previous.revision,revision:next.revision,changes,updates,...(!same(oldOrder,order)?{order}:{})};
}

/** Each slow client retains at most the latest snapshot and a small notice queue. */
export class StateChannel {
  constructor(response,{stallTimeout=30000,onClose=()=>{}}={}){
    this.response=response;this.stallTimeout=stallTimeout;this.onClose=onClose;this.previous=null;this.latest=null;this.notices=[];this.blocked=false;this.closed=false;this.timer=null;
    response.on('drain',()=>{this.blocked=false;clearTimeout(this.timer);this.pump();});
    response.once('close',()=>this.close(false));response.once('error',()=>this.close());
  }
  state(snapshot){this.latest=snapshot;this.pump();}
  notice(value){if(this.notices.length===20)this.notices.shift();this.notices.push(value);this.pump();}
  write(message){
    if(this.closed)return false;
    if(this.response.destroyed||this.response.writableEnded){this.close(false);return false;}
    let accepted;try{accepted=this.response.write(message);}catch{this.close();return false;}
    if(!accepted){
      this.blocked=true;clearTimeout(this.timer);this.timer=setTimeout(()=>this.close(),this.stallTimeout);this.timer.unref();return false;
    }
    return true;
  }
  pump(){
    if(this.closed||this.blocked)return;
    if(this.latest){
      const next=this.latest;this.latest=null;
      const type=this.previous?'patch':'state',value=this.previous?stateDelta(this.previous,next):next;
      this.previous=next;
      if(!this.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`))return;
    }
    while(this.notices.length)if(!this.write(`event: notice\ndata: ${JSON.stringify(this.notices.shift())}\n\n`))return;
  }
  heartbeat(){if(!this.blocked)this.write(': heartbeat\n\n');}
  close(destroy=true){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.latest=null;this.notices=[];this.onClose();if(destroy)this.response.destroy();}
  end(){if(this.closed)return;this.close(false);this.response.end();}
}
export function createStateHub(store){
  const channels=new Set();
  const onState=value=>{const snapshot=clone(value);for(const channel of channels)channel.state(snapshot);};
  const onNotice=value=>{for(const channel of channels)channel.notice(value);};
  store.on('state',onState);store.on('notice',onNotice);
  const heartbeat=setInterval(()=>{for(const channel of channels)channel.heartbeat();},20000);heartbeat.unref();
  return {
    add(response){const channel=new StateChannel(response,{onClose:()=>channels.delete(channel)});channels.add(channel);channel.state(clone(store.publicState()));},
    close(){clearInterval(heartbeat);store.off('state',onState);store.off('notice',onNotice);for(const channel of [...channels])channel.end();}
  };
}
