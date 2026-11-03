import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Store } from './store.mjs';
import { Automation } from './automation.mjs';
import { testAIConnection } from './ai-connection.mjs';
import * as UStudy from './shared/core.mjs';
import {validateSettings} from './settings.mjs';
import {OperationManager} from './operation-manager.mjs';
import {createStateHub} from './state-events.mjs';
import {assertRuntime,APP_VERSION} from './runtime-check.mjs';
import {StudyTimeController} from './study-time.mjs';
import {handleStudyTimeRequest} from './study-time-http.mjs';
import {sharedStudyTimeBrowserAccess} from './study-time-browser.mjs';
export {validateSettings} from './settings.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY=9*1024*1024;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const securityHeaders={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
function json(res,status,data){res.writeHead(status,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,maxBytes=MAX_BODY){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(new Error(`请求内容超过 ${Math.round(maxBytes/1024/1024)} MB。`),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('请求必须是有效 JSON。'),{status:400});}}
function resolveAPIKey(value,endpoint,store){
  if(value!==undefined&&typeof value!=='string')throw new Error('API Key 格式无效。');
  if((value||'').length>8192)throw new Error('API Key 长度异常。');
  const provided=(value||'').trim();
  if(store.keySource==='environment'){
    if(provided)throw new Error('当前使用环境变量 Key，不能通过网页覆盖。');
    if(endpoint!==store.keyEndpoint)throw new Error('环境变量 Key 仅用于启动时的接口；请配置 USTUDY_API_ENDPOINT 并重启服务。');
  }
  return provided||(endpoint===store.keyEndpoint?store.apiKey:'');
}
export function createApp({store,automation,port=4173,staticRoot=path.join(ROOT,'dist'),onShutdown,testConnection=testAIConnection,studyTime}){
  const hub=createStateHub(store);
  const learning=studyTime||new StudyTimeController({directory:path.join(store.directory||path.join(ROOT,'.runtime'),'study-time'),courses:()=>store.data.courses,browserAccess:sharedStudyTimeBrowserAccess(automation)});
  const operations=automation.operations||new OperationManager(operation=>{store.operation=operation;store.changed({persist:false});});
  let aiTesting=false;
  const server=http.createServer(async(req,res)=>{
    try{
      const actualPort=server.address()?.port||port;
      const permittedHosts=new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);
      if(!permittedHosts.has(req.headers.host)){json(res,403,{error:'仅允许本机访问。'});return;}
      const requestURL=new URL(req.url,`http://127.0.0.1:${actualPort}`),pathname=requestURL.pathname;
      if(req.method==='OPTIONS'){json(res,403,{error:'不允许跨域请求。'});return;}
      if(pathname.startsWith('/api/')){
        if(req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'不允许跨站访问本地服务。'});return;}
        if(req.method!=='GET'){
          const origins=new Set([`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`]);
          if(req.headers['x-ustudy']!=='1'||!String(req.headers['content-type']||'').startsWith('application/json')||(req.headers.origin&&!origins.has(req.headers.origin))){json(res,403,{error:'请求来源验证失败。'});return;}
        }
        if(pathname.startsWith('/api/study-time/')){await handleStudyTimeRequest(req,res,pathname,learning,json);return;}
        if(req.method==='GET'&&pathname==='/api/health'){json(res,200,{ok:true,app:'u-study',version:APP_VERSION});return;}
        if(req.method==='GET'&&pathname==='/api/state'){json(res,200,store.publicState());return;}
        if(req.method==='GET'&&pathname==='/api/bank/export'){json(res,200,store.data.bank);return;}
        if(req.method==='GET'&&pathname==='/api/events'){
          res.writeHead(200,{...securityHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();hub.add(res);return;
        }
        if(req.method!=='POST'){json(res,405,{error:'不支持此请求方法。'});return;}
        const input=await body(req,pathname==='/api/settings'?128*1024*1024:MAX_BODY);
        if(pathname==='/api/shutdown'){
          if(typeof onShutdown!=='function'){json(res,503,{error:'当前服务不支持通过启动器关闭。'});return;}
          res.once('finish',()=>setImmediate(onShutdown));json(res,202,{accepted:true});return;
        }
        if(pathname==='/api/connect'){json(res,200,await automation.connect());return;}
        if(pathname==='/api/lesson/inspect'){
          if(typeof input.taskId!=='string'||!/^[-\w]{1,100}$/.test(input.taskId))throw new Error('只读题页检测的任务标识无效。');
          json(res,200,await automation.inspectCurrentLesson({taskId:input.taskId}));return;
        }
        if(pathname==='/api/media/preview'){
          for(const [name,max] of [['courseId',2000],['unitId',200],['entryKey',5000]])if(typeof input[name]!=='string'||!input[name]||input[name].length>max)throw new Error('请提供有效的课程、单元和目录项目。');
          if(input.solve!==undefined&&typeof input.solve!=='boolean')throw new Error('答案预览开关无效。');
          if(input.inspect!==undefined&&typeof input.inspect!=='boolean'||input.inspect&&input.solve)throw new Error('只读页面检测参数无效。');
          const controller=new AbortController(),onClose=()=>{if(!res.writableFinished)controller.abort();};res.once('close',onClose);
          try{const result=await automation.previewMedia(input,{signal:controller.signal});if(!res.destroyed)json(res,200,result);}catch(error){if(!error.mediaChange)throw error;json(res,error.status||400,{error:error.message,mediaChange:error.mediaChange});}finally{res.off('close',onClose);}return;
        }
        if(pathname==='/api/sync'){automation.startSync();json(res,202,{accepted:true});return;}
        if(pathname==='/api/open-course'){
          if(automation.busy()||store.syncing||automation.catalogLoading)throw new Error('请先停止当前任务或等待同步、目录读取结束。');
          const course=store.data.courses.find(c=>c.id===input.courseId);if(!course)throw new Error('课程不存在，请先同步。');await (automation.openCourseForUser?automation.openCourseForUser(course):operations.run('open',()=>automation.openCourse(course)));store.addActivity(`已打开「${UStudy.courseLabel(course)}」。`,'external');json(res,200,{opened:true});return;
        }
        if(pathname==='/api/ai/test'){
          if(aiTesting)throw Object.assign(new Error('已有 AI 连接测试正在进行，请稍候。'),{status:409});
          const settings=validateSettings({aiEnabled:true,endpoint:input.endpoint,model:input.model});
          const apiKey=resolveAPIKey(input.apiKey,settings.endpoint,store);
          if(!apiKey)throw new Error('请填写 API Key；切换接口后需填写对应的 Key。');
          const controller=new AbortController(),onClose=()=>{if(!res.writableFinished)controller.abort();};
          aiTesting=true;res.once('close',onClose);
          try{const result=await testConnection({endpoint:settings.endpoint,model:settings.model,apiKey},{signal:controller.signal});if(!res.destroyed)json(res,200,result);}
          finally{aiTesting=false;res.off('close',onClose);}
          return;
        }
        if(pathname==='/api/settings'){
          if(automation.busy())throw new Error('请先停止当前任务，再修改答题设置。');
          const result=await operations.run('settings',async()=>{
            const settings=validateSettings(input.settings),key=resolveAPIKey(input.apiKey,settings.endpoint,store);
            if(settings.aiEnabled&&!key)throw new Error('请填写 API Key；切换接口后需填写对应的 Key。');
            const bank=input.bank===undefined?store.data.bank:UStudy.validateBank(input.bank);
            return store.saveConfiguration({settings,bank,...(typeof input.apiKey==='string'&&input.apiKey.trim()?{apiKey:key}:{})});
          });
          json(res,200,result);return;
        }
        if(pathname==='/api/manual-entries/clear'){
          if(automation.busy()||store.syncing||automation.catalogLoading)throw Object.assign(new Error('请先停止任务并等待读取结束，再清除手动项目标记。'),{status:409});
          json(res,200,await operations.run('settings',()=>store.clearManualEntries()));return;
        }
        if(pathname==='/api/units'){
          if(input.unitId!==undefined&&(typeof input.unitId!=='string'||!input.unitId||input.unitId.length>200))throw new Error('单元标识无效。');
          const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(Object.assign(new Error('读取目录超时，请检查课程窗口后重试。'),{status:408})),55000);
          timeout.unref();const onClose=()=>{if(!res.writableFinished)controller.abort();};res.once('close',onClose);
          try{const result=await automation.unitsForCourse(input.courseId,input.unitId,{signal:controller.signal});controller.signal.throwIfAborted();if(!res.destroyed)json(res,200,result);}
          finally{clearTimeout(timeout);res.off('close',onClose);}return;
        }
        if(pathname==='/api/tasks'){
          if(typeof input.unitId!=='string'||!input.unitId||input.unitId.length>200)throw new Error('请先读取课程目录并选择一个单元。');
          if(input.oralReplacement!==undefined&&(!input.oralReplacement||typeof input.oralReplacement!=='object'||Array.isArray(input.oralReplacement)||typeof input.oralReplacement.entryKey!=='string'||input.oralReplacement.entryKey.length>5000||!/^[a-f0-9]{64}$/.test(input.oralReplacement.recordingKey||'')||!/^[a-f0-9]{64}$/.test(input.oralReplacement.draftKey||'')))throw new Error('口语替换参数无效。');
          const task=input.oralReplacement?automation.startTask(input.courseId,input.unitId,{oralReplacement:input.oralReplacement}):automation.startTask(input.courseId,input.unitId);json(res,202,{task});return;
        }
        const match=pathname.match(/^\/api\/tasks\/([\w-]+)\/(pause|resume|stop|replace-oral)$/);
        if(match){json(res,200,{task:automation.controlTask(match[1],match[2])});return;}
        json(res,404,{error:'接口不存在。'});return;
      }
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'不支持此请求方法。'});return;}
      let relative;try{relative=decodeURIComponent(pathname);}catch{json(res,400,{error:'地址格式无效。'});return;}
      if(relative.includes('\0')||relative.includes('\\')){json(res,403,{error:'无效文件路径。'});return;}
      const target=path.resolve(staticRoot,'.'+(relative==='/'?'/index.html':relative));
      if(!target.startsWith(path.resolve(staticRoot)+path.sep)){json(res,403,{error:'不能访问此文件。'});return;}
      if(!types[path.extname(target)]){json(res,404,{error:'文件不存在。'});return;}
      try{const info=await stat(target);if(!info.isFile())throw new Error('not a file');const content=await readFile(target);res.writeHead(200,{...securityHeaders,'Content-Type':types[path.extname(target)],'Content-Length':content.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);}catch{json(res,404,{error:'文件不存在。'});}
    }catch(error){if(res.destroyed)return;if(!res.headersSent)json(res,error.status||400,{error:error.message||'操作未完成。'});else res.end();}
  });
  server.on('close',()=>{hub.close();void learning.close().catch(()=>{});});
  server.shutdown=async()=>{try{await learning.close();}finally{hub.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
  return server;
}
export function openDashboard(url){
  const candidates=[path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),path.join(process.env.ProgramFiles||'C:\\Program Files','Google','Chrome','Application','chrome.exe')];
  const executable=candidates.find(existsSync);
  if(!executable)throw new Error(`未找到 Edge 或 Chrome。请在浏览器中打开 ${url}`);
  return new Promise((resolve,reject)=>{const child=spawn(executable,[`--app=${url}`],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
export async function main(){
  assertRuntime();
  const port=Number(process.env.PORT||4173);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT 必须是 1024 到 65535 之间的端口。');
  const store=await new Store(path.join(ROOT,'.runtime')).load(),automation=new Automation(store);
  let shuttingDown=false;
  const shutdown=async()=>{
    if(shuttingDown)return;shuttingDown=true;
    const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
    try{await automation.close();await server.shutdown();process.exitCode=0;}
    catch(error){console.error(error.message);process.exitCode=1;}
    finally{clearTimeout(deadline);}
  };
  const server=createApp({store,automation,port,onShutdown:()=>{void shutdown();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${port}`;console.log(`U Study v${APP_VERSION} 已启动：${url}\n无需浏览器扩展。双击「停止 U Study.cmd」可关闭后台服务。`);
  process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
  if(process.argv.includes('--open'))await openDashboard(url);
  return {server,store,automation};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.code==='EADDRINUSE'?'4173 端口已被占用。若 U Study 已启动，请直接打开 http://127.0.0.1:4173；否则设置 PORT 后重试。':error.message);process.exitCode=1;});
