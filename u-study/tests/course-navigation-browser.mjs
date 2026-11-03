import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Automation,COURSE_HOME} from '../automation.mjs';

export async function courseNavigationBrowserCases(t,context){
  const base='https://ucloud.unipus.cn/offline-course-navigation';
  const destination='https://ucontent.unipus.cn/offline-course-navigation/lesson';
  for(const mode of ['same-tab','popup','course-card'])await t.test(`a ${mode} entry opens once when navigation takes longer than the click timeout`,async()=>{
    const source=await context.newPage(),held=[],popups=[];let clicks=0;
    const catalogURL=mode==='course-card'?COURSE_HOME:base+'/catalog';
    const route=async route=>{
      const url=route.request().url();
      if(url===base+'/pending')return new Promise(resolve=>held.push(async()=>{await route.fulfill({body:'<!doctype html><p>Released</p>'}).catch(()=>{});resolve();}));
      if(url===base+'/idle')return route.fulfill({body:'<!doctype html><p>Idle frame</p>'});
      if(url===destination){await sleep(900);return route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Exercise 2</h1>'}).catch(()=>{});}
      if(url===catalogURL)return route.fulfill({contentType:'text/html',body:`<!doctype html><iframe id="background" src="${base}/idle"></iframe><button id="entry">Exercise 2</button><script>document.querySelector('#entry').onclick=()=>{document.querySelector('#background').src='${base}/pending';${mode==='same-tab'?`location.href='${destination}';`:`window.open('${destination}');`}}</script>`});
      return route.abort();
    };
    await context.route('**/offline-course-navigation/**',route);if(mode==='course-card')await source.route(COURSE_HOME,route);
    source.on('popup',page=>popups.push(page));
    try{
      await source.goto(catalogURL);source.setDefaultTimeout(350);
      const engine=new Automation({data:{tasks:[],courses:[],bank:[]},changed(){}});
      const entry={key:JSON.stringify(['id-unit4-tab',['Active reading','Getting the idea'],'Exercise 2']),title:'Exercise 2',path:['Active reading','Getting the idea'],required:true,pending:true,completed:false,selector:'#entry',frame:source.mainFrame()};
      const nativeClick=source.mainFrame().locator('#entry').click.bind(source.mainFrame().locator('#entry'));
      const frame={locator:selector=>{assert.equal(selector,'#entry');return {click:async options=>{clicks++;return nativeClick(options);}};}};
      engine.focusPage=async()=>{};
      engine.ensureBrowser=async()=>context;
      engine.navigate=async(page,url)=>page.goto(url,{waitUntil:'domcontentloaded'});
      const directory={ready:true,activeUnitId:'id-unit4-tab',units:[],collapsed:[],entries:[entry],frame};
      engine.prepareDirectory=async()=>directory;
      const originalPages=new Set(context.pages());
      let page;
      if(mode==='course-card'){
        const course={id:'offline-book',title:'Offline book',url:COURSE_HOME,entry:{title:'Offline book',pageIndex:0}};
        engine.coursePage=async()=>source;engine.waitCourseList=async()=>({entry:{...entry,frame}});
        page=await engine.openCourse(course);
      }else{
        const task={id:'navigation-'+mode,courseId:'offline-book',unitId:'id-unit4-tab',entryKey:entry.key,status:'running'};
        const catalog={page:source,url:catalogURL};
        page=await engine.openRequiredEntry(task,catalog,directory,entry,new AbortController().signal);
        assert.equal(engine.taskPages.get(task.id),page);
        assert.notEqual(catalog.page,page);
        assert.equal(catalog.page.url(),catalogURL);
      }
      assert.equal(page.url(),destination);assert.equal(await page.locator('h1').innerText(),'Exercise 2');assert.equal(clicks,1);
      assert.equal(source.listenerCount('popup'),1); // Only the test observer remains.
      for(const created of context.pages())if(!originalPages.has(created)&&created!==page)await created.close();
    }finally{
      for(const release of held)await release();
      for(const popup of popups)await popup.close().catch(()=>{});
      await source.close();await context.unroute('**/offline-course-navigation/**',route);
    }
  });
}
