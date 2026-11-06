import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Automation} from '../automation.mjs';
import {createApp} from '../server.mjs';
import {accessToken,authorizedDashboard} from './fixtures/local-access.mjs';
import {collectCoursesFromDOM} from '../platform-dom.mjs';
import {courseProgressHTML} from './fixtures/course-progress.mjs';

export async function courseProgressBrowserCases(t,context,root){
  const coursePage=await context.newPage();let dashboard,server;
  const directory=path.join(root,'course-progress'),store=await new Store(directory,{env:{}}).load(),engine=new Automation(store);
  try{
    await coursePage.route('https://ucloud.unipus.cn/app/cmgt/course-management',route=>route.fulfill({contentType:'text/html',body:courseProgressHTML}));
    await coursePage.goto('https://ucloud.unipus.cn/app/cmgt/course-management');
    // Start from the unknown percentages the old reader persisted.
    store.data.courses=(await coursePage.evaluate(collectCoursesFromDOM)).courses.map(course=>({...course,progress:null,status:'active'}));await store.flush();
    engine.coursePage=async()=>coursePage;
    server=createApp({store,automation:engine,port:0,accessToken});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    dashboard=await context.newPage();await dashboard.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());await dashboard.addInitScript(()=>localStorage.setItem('ustudy-demo','false'));await dashboard.goto(authorizedDashboard(base));
    await t.test('synchronizing whole-book task counts updates percentage labels, completion badges, details and persisted state',async()=>{
      await dashboard.waitForFunction(()=>document.querySelector('#course-grid .course-progress .progress-label strong')?.textContent==='未提供');assert.equal(await dashboard.locator('#course-grid .course-card').count(),5);
      await engine.sync({signal:new AbortController().signal});
      await dashboard.waitForFunction(()=>document.querySelector('#course-grid .course-progress .progress-label strong')?.textContent==='100%');
      assert.deepEqual(await dashboard.locator('#course-grid .course-progress .progress-label strong').allTextContents(),['100%','100%','25%','未提供','5.32%']);
      assert.deepEqual(await dashboard.locator('#course-grid .course-status').allTextContents(),['已完成','已完成','学习中','学习中','学习中']);assert.match(await dashboard.locator('#metric-completed').innerText(),/^02/);
      await dashboard.locator('#course-grid [data-course-detail]').first().click();assert.match(await dashboard.locator('#course-dialog-content').innerText(),/课程进度\s*100%/);await dashboard.locator('#course-dialog [data-close]').click();
      await store.flush();const reloaded=await new Store(directory,{env:{}}).load();assert.deepEqual(reloaded.data.courses.map(c=>c.progress),[100,100,25,null,5.32]);assert.equal(new Set(reloaded.data.courses.map(c=>c.id)).size,5);
    });
    await t.test('a later platform progress change updates the same book percentage without changing another edition or retaining a completed badge',async()=>{
      await coursePage.locator('#book2-done').evaluate(el=>el.textContent='47');await engine.sync({signal:new AbortController().signal});
      await dashboard.waitForFunction(()=>document.querySelector('#course-grid .course-progress .progress-label strong')?.textContent==='50%');
      assert.deepEqual(await dashboard.locator('#course-grid .course-progress .progress-label strong').allTextContents(),['50%','100%','25%','未提供','5.32%']);assert.match(await dashboard.locator('#course-grid .course-status').first().innerText(),/学习中/);assert.match(await dashboard.locator('#metric-completed').innerText(),/^01/);
      assert.deepEqual(store.data.courses.map(c=>c.progress),[50,100,25,null,5.32]);
    });
    await t.test('a completed answer task automatically refreshes platform progress after its browser lease is released without another answer request',async()=>{
      const requests=[];dashboard.on('request',request=>{if(request.method()==='POST')requests.push(new URL(request.url()).pathname);});
      const task={id:'finished-book',courseId:store.data.courses[0].id,courseTitle:store.data.courses[0].title,status:'running',updatedAt:Date.now(),logs:[],answered:0,pages:0};
      store.windowOpen=true;store.data.tasks=[task];store.operation={kind:'answer'};store.changed({persist:false});
      await dashboard.waitForFunction(()=>document.querySelector('.running-label')?.textContent.includes('正在处理必修'));
      await coursePage.locator('#book2-done').evaluate(el=>el.textContent='94');task.status='completed';task.updatedAt=Date.now()+1;store.changed({persist:false});
      await dashboard.waitForFunction(()=>document.querySelector('.running-label')?.textContent==='已完成');assert.equal(requests.includes('/api/sync'),false);
      store.operation=null;store.changed({persist:false});
      await dashboard.waitForFunction(()=>document.querySelector('#course-grid .course-progress .progress-label strong')?.textContent==='100%');
      assert.equal(requests.filter(path=>path==='/api/sync').length,1);assert.equal(requests.includes('/api/tasks'),false);assert.equal(store.data.courses[0].status,'completed');assert.equal(task.status,'completed');
    });
  }finally{await dashboard?.close();await coursePage.close();await server?.shutdown();await store.flush();}
}
