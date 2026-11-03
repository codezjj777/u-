import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';

// context.newPage() creates a foreground target and can raise the native
// browser window even without Page.bringToFront. Use an explicitly unfocused
// target in the same context, and bind it through public Playwright/CDP APIs.
export async function createBackgroundPage(context,{timeoutMs=10000}={}){
  const previous=new Set(context.pages()),anchor=[...previous].find(page=>!page.isClosed());
  if(!anchor||typeof context.newCDPSession!=='function')throw new Error('后台课程窗口尚未就绪，请先打开 U校园登录窗口。');
  const session=await context.newCDPSession(anchor);let targetId,created;
  try{
    const {targetInfo}=await session.send('Target.getTargetInfo');
    ({targetId}=await session.send('Target.createTarget',{url:'about:blank#ustudy-background-'+randomUUID(),background:true,focus:false,...(targetInfo.browserContextId?{browserContextId:targetInfo.browserContextId}:{})}));
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      for(const page of context.pages()){
        if(previous.has(page)||page.isClosed())continue;
        let probe;
        try{probe=await context.newCDPSession(page);const {targetInfo}=await probe.send('Target.getTargetInfo');if(targetInfo.targetId===targetId){created=page;return page;}}
        finally{await probe?.detach().catch(()=>{});}
      }
      await sleep(30);
    }
    throw new Error('后台课程标签页创建超时，尚未改用会抢占前台的创建方式。');
  }finally{
    if(targetId&&!created)await session.send('Target.closeTarget',{targetId}).catch(()=>{});
    await session.detach().catch(()=>{});
  }
}

export async function showBrowserPage(page){
  // bringToFront activates a tab but does not restore a minimized Chromium
  // window. Only explicit user actions call this helper; automatic work must
  // not restore a window the user minimized or take focus from another app.
  let session;
  try{
    const context=typeof page.context==='function'?page.context():null;
    if(typeof context?.newCDPSession==='function'){
      session=await context.newCDPSession(page);
      const {windowId,bounds}=await session.send('Browser.getWindowForTarget');
      if(bounds?.windowState==='minimized')await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
    }
  }catch{}finally{await session?.detach().catch(()=>{});}
  await page.bringToFront();
}

export async function ensureBrowserSession(){
    if(this.context)return this.context;if(this.launching)return this.launching;
    this.launching=(async()=>{
      let context,lastError;
      const channels=process.env.USTUDY_BROWSER?[process.env.USTUDY_BROWSER]:['msedge','chrome'];
      for(const channel of channels){
        if(!['msedge','chrome'].includes(channel))throw new Error('USTUDY_BROWSER 只能是 msedge 或 chrome。');
        try{context=await chromium.launchPersistentContext(path.join(this.store.directory,'browser-profile'),{channel,chromiumSandbox:true,headless:false,viewport:null,acceptDownloads:false,timeout:20000});break;}catch(error){lastError=error;}
      }
      if(!context){
        const detail=lastError?.message||'';
        const message=/EPERM|EACCES|access is denied|访问被拒绝/i.test(detail)?'当前受限运行环境阻止启动登录窗口。请在项目目录双击「启动 U Study.cmd」运行。':/user data directory|ProcessSingleton|already in use/i.test(detail)?'登录窗口配置正被另一个程序使用，请关闭重复启动的 U Study。':'无法启动登录窗口。请确认电脑已安装 Microsoft Edge 或 Google Chrome。';
        throw new Error(message,{cause:lastError});
      }
      this.context=context;this.store.windowOpen=true;this.store.changed({persist:false});
      context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(40000);
      context.on('close',()=>{this.context=null;this.store.windowOpen=false;this.store.connected=false;this.store.changed({persist:false});for(const ctl of this.controllers.values())ctl.abort(new Error('登录窗口已关闭。'));});
      return context;
    })();
    try{return await this.launching;}finally{this.launching=null;}
  }
