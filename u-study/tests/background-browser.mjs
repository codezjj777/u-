import assert from 'node:assert/strict';
import {createBackgroundPage} from '../browser-session.mjs';
import {Automation} from '../automation.mjs';

async function actualFocus(context,page){const session=await context.newCDPSession(page);try{await session.send('Emulation.setFocusEmulationEnabled',{enabled:false});}finally{await session.detach();}}
export async function backgroundBrowserCases(t,context){
  await t.test('default creation reproduces activation but repeated background creation and closing preserve the observer focus',async()=>{
    const anchor=await context.newPage(),observer=await context.newPage();let old;const created=[];
    try{
      await actualFocus(context,observer);await observer.bringToFront();assert.equal(await observer.evaluate(()=>document.hasFocus()),true);
      old=await context.newPage();assert.equal(await observer.evaluate(()=>document.hasFocus()),false,'the old newPage path reproduces focus stealing');await old.close();await observer.bringToFront();
      for(let i=0;i<4;i++){
        const page=await createBackgroundPage(context);created.push(page);assert.ok(context.pages().includes(page));assert.equal(await observer.evaluate(()=>document.hasFocus()),true);await page.close();assert.equal(await observer.evaluate(()=>document.hasFocus()),true);
      }
    }finally{for(const page of [...created,old,observer,anchor])if(page&&!page.isClosed())await page.close();}
  });
  await t.test('same-tab required entry creates its replacement directory in the background and finishing the lesson does not activate it',async()=>{
    const source=await context.newPage(),observer=await context.newPage();let catalog;
    try{
      const from='https://ucontent.unipus.cn/offline-recognition/offline-focus/catalog',to='https://ucontent.unipus.cn/offline-recognition/offline-focus/lesson#/courseware/unit4/exercise';
      await source.route('https://ucontent.unipus.cn/offline-recognition/offline-focus/**',route=>route.fulfill({contentType:'text/html',body:'<a id="entry" href="'+to+'">Exercise</a>'}));await source.goto(from);
      const task={id:'background-entry',courseId:'book',unitId:'id-unit4-tab',status:'running'},entry={key:'entry',title:'Exercise',required:true,pending:true,completed:false,selector:'#entry'};
      const store={data:{tasks:[]},changed(){},addLog(){},addActivity(){}},engine=new Automation(store);engine.pages.attach(context);engine.pages.track(source,'catalog');engine.ensureBrowser=async()=>context;engine.prepareDirectory=async()=>({ready:true,activeUnitId:task.unitId,entries:[entry],frame:source.mainFrame()});engine.focusPage=async()=>assert.fail('no foreground calls while opening a required entry');catalog={page:source,url:from};
      await actualFocus(context,observer);await observer.bringToFront();
      const lesson=await engine.openRequiredEntry(task,catalog,{},entry,new AbortController().signal);assert.equal(lesson,source);assert.notEqual(catalog.page,source);assert.equal(catalog.page.url(),from);assert.equal(await observer.evaluate(()=>document.hasFocus()),true);
      assert.equal((await engine.pages.release(lesson,{completed:true})).status,'closed');assert.equal(await observer.evaluate(()=>document.hasFocus()),true);assert.equal(catalog.page.isClosed(),false);
    }finally{for(const page of [catalog?.page,source,observer])if(page&&!page.isClosed())await page.close();}
  });
  await t.test('a background target stays in its source browser context instead of creating a page in another session',async()=>{
    const isolated=await context.browser().newContext();let observer;
    try{
      const anchor=await isolated.newPage();observer=await context.newPage();await actualFocus(context,observer);await observer.bringToFront();const before=context.pages().length;
      const a=await isolated.newCDPSession(anchor),b=await context.newCDPSession(observer);try{assert.notEqual((await a.send('Browser.getWindowForTarget')).windowId,(await b.send('Browser.getWindowForTarget')).windowId,'use two distinct browser windows, not just two tabs');}finally{await a.detach();await b.detach();}
      const page=await createBackgroundPage(isolated);assert.equal(page.context(),isolated);assert.equal(isolated.pages().length,2);assert.equal(context.pages().length,before);assert.equal(await observer.evaluate(()=>document.hasFocus()),true);
      await page.close();assert.equal(await observer.evaluate(()=>document.hasFocus()),true);
    }finally{await isolated.close();await observer?.close();}
  });
}
