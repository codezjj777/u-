import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,copyFile,readFile,appendFile} from 'node:fs/promises';
import {releaseFiles} from '../release-files.mjs';
import {sourceBuildId} from '../runtime-check.mjs';
import {dashboardURL,readLocalAccess} from '../local-access.mjs';

export async function shutdownBrowserCases(t,context,root){
  await t.test('same-version updates preserve the running backend until safe exit saves its task and terminates the owned process',async()=>{
    const directory=await mkdtemp(path.join(root,'safe-exit-')),application=path.join(directory,'app');await mkdir(application,{recursive:true});
    for(const file of releaseFiles){const target=path.join(application,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.resolve(file),target);}
    await copyFile(new URL('./fixtures/shutdown-server.mjs',import.meta.url),path.join(application,'shutdown-runner.mjs'));
    const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,[path.join(application,'shutdown-runner.mjs')],{cwd:application,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PORT:String(port),USTUDY_API_KEY:'',USTUDY_API_ENDPOINT:'',USTUDY_API_MODEL:''}});
    let output='',browserClosed=false;child.stdout.on('data',chunk=>{output=(output+chunk).slice(-6000);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-6000);});child.on('message',message=>{if(message?.type==='browser-closed')browserClosed=true;});
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let page;
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Shutdown test startup timed out: '+output)),15000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Shutdown test process exited early: '+output));});});
      const base=`http://127.0.0.1:${port}`,loaded=await(await fetch(base+'/api/health')).json();assert.equal(loaded.buildId,await sourceBuildId(application));
      const accessToken=await readLocalAccess(path.join(application,'.runtime'),port,loaded.instanceId);
      await appendFile(path.join(application,'lesson-actions.mjs'),'\n// Updated on disk while the old backend is running\n');assert.notEqual(await sourceBuildId(application),loaded.buildId);assert.equal((await(await fetch(base+'/api/health')).json()).buildId,loaded.buildId);
      const launcher=spawn(process.execPath,[path.join(application,'launcher.mjs'),'--no-open'],{cwd:application,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port)}});let launchOutput='';launcher.stdout.on('data',chunk=>launchOutput+=chunk);launcher.stderr.on('data',chunk=>launchOutput+=chunk);const launchCode=await new Promise((resolve,reject)=>{launcher.once('error',reject);launcher.once('exit',resolve);});assert.equal(launchCode,1,launchOutput);assert.match(launchOutput,/尚未加载本机代码更新/);assert.equal((await(await fetch(base+'/api/health')).json()).instanceId,loaded.instanceId);
      page=await context.newPage();await page.route(base+'/**',route=>route.continue());await page.addInitScript(()=>{localStorage.setItem('ustudy-demo','false');window.closeAttempts=0;window.close=()=>window.closeAttempts++;});
      const requests=[];page.on('request',request=>{if(request.url().startsWith(base+'/api/'))requests.push(request.url());});await page.goto(dashboardURL(base,accessToken));await page.waitForFunction(()=>document.querySelector('#connection-state').textContent.includes('等待登录'));await page.locator('#study-time-nav').click();
      await page.screenshot({path:path.join(root,'safe-exit-button.png')});await page.locator('#safe-exit').click();await page.locator('#shutdown-overlay[data-state=busy]').waitFor();assert.equal(await page.locator('.app-shell').evaluate(el=>el.inert),true);await page.screenshot({path:path.join(root,'safe-exit-saving.png')});
      await page.locator('#shutdown-overlay[data-state=done]').waitFor({timeout:20000});assert.match(await page.locator('#shutdown-message').innerText(),/学习记录已保存/);const result=await exited;assert.equal(result.code,0,output);assert.equal(browserClosed,true,output);assert.equal(child.exitCode,0);
      await page.waitForFunction(()=>window.closeAttempts===1);const before=requests.length;await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(1700);assert.equal(requests.length,before,'intentional exit must stop answer and study-time reconnection');
      await page.screenshot({path:path.join(root,'safe-exit-complete.png')});const saved=JSON.parse(await readFile(path.join(application,'.runtime','state.json'),'utf8'));assert.equal(saved.tasks[0].status,'stopped');assert.equal(saved.settings.model,'saved-shutdown-model');assert.ok(saved.tasks[0].logs.some(log=>log.message==='退出前的待保存记录'));
      const released=http.createServer();await new Promise((resolve,reject)=>{released.once('error',reject);released.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>released.close(resolve));assert.equal(requests.filter(url=>url.endsWith('/api/shutdown')).length,1);
    }finally{
      await page?.close().catch(()=>{});
      if(child.exitCode===null){child.send({type:'cleanup'});await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill();}
    }
  });
}
