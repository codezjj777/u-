// Copied beside the application server by the isolated shutdown integration test.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {main} from './server.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const app=await main();
const context=await chromium.launchPersistentContext(path.join(root,'.runtime','test-browser'),{channel:process.env.USTUDY_TEST_BROWSER||'msedge',headless:true,chromiumSandbox:true});
await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Offline shutdown test</body></html>'}));
await context.pages()[0].goto('https://ucontent.unipus.cn/offline-recognition/shutdown');
const close=context.close.bind(context);
context.close=async()=>{await close();await new Promise(resolve=>process.send({type:'browser-closed'},()=>resolve()));};
app.automation.context=context;app.automation.pages.attach(context);app.store.windowOpen=true;
app.store.data.courses=[{id:'quit-course',title:'退出验证课程',url:'https://ucloud.unipus.cn/app/cmgt/course-management',status:'active',progress:12}];
app.store.data.settings.model='saved-shutdown-model';
const task={id:'quit-live',courseId:'quit-course',courseTitle:'退出验证课程',unitId:'unit1',unitLabel:'Unit 1',entryKey:JSON.stringify(['unit1',[],'shutdown']),currentEntry:'正在处理的测试任务',status:'running',logs:[],answered:0,pages:0,createdAt:Date.now()};
app.store.data.tasks=[task];app.store.addLog(task,'退出前的待保存记录');
const controller=new AbortController();
app.automation.runtime.start(task,controller,async()=>new Promise((resolve,reject)=>{
  controller.signal.addEventListener('abort',()=>setTimeout(()=>reject(controller.signal.reason),1200),{once:true});
}));
// This handle deliberately keeps Node alive after its HTTP listener closes.
setInterval(()=>{},1000);
process.on('message',async message=>{if(message?.type==='cleanup'){try{await app.automation.close();await app.server.shutdown();}finally{process.exit(1);}}});
process.send({type:'ready',pid:process.pid});
