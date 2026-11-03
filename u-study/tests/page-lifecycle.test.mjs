import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PageLifecycle} from '../page-lifecycle.mjs';
import {Automation,COURSE_HOME} from '../automation.mjs';

class Page extends EventEmitter{
  constructor(url='https://ucontent.unipus.cn/learn/empty',activity={}){super();this.address=url;this.state=activity;this.closed=false;this.closes=0;}
  url(){return this.address;}
  isClosed(){return this.closed;}
  async close(){this.closes++;this.closed=true;this.emit('close');}
  async bringToFront(){}
  async waitForLoadState(){}
  frames(){return [{url:()=>this.address,evaluate:async()=>this.state}];}
}
class Context{
  constructor(pages=[]){this.all=pages;this.created=0;this.peak=pages.length;}
  pages(){return this.all.filter(page=>!page.isClosed());}
  async newPage(){this.created++;const page=new Page('about:blank');this.all.push(page);this.peak=Math.max(this.peak,this.pages().length);return page;}
}
function fixture(){
  const store={directory:'.cache',data:{tasks:[],courses:[],bank:[],settings:{}},changed(){},addLog(task,message){task.logs.push({message});},addActivity(){},notice(){}};
  return {store,engine:new Automation(store)};
}
const directory=entries=>({ready:true,activeUnitId:'unit4',units:[],entries,collapsed:[],loading:false});

test('empty lesson pages are closed while unmanaged pages are untouched',async()=>{
  const pages=new PageLifecycle(),lesson=new Page(),other=new Page();pages.track(lesson,'lesson');
  assert.equal((await pages.release(lesson)).status,'closed');assert.equal(lesson.closes,1);
  assert.equal((await pages.release(other,{completed:true})).status,'unmanaged');assert.equal(other.closes,0);
});
test('drafts, playback, loading and unreadable frames are retained instead of discarded',async()=>{
  for(const state of [{draft:true},{playing:true},{loading:true},{unknown:true}]){
    const pages=new PageLifecycle(),lesson=new Page(undefined,state);pages.track(lesson,'lesson');
    assert.equal((await pages.release(lesson)).status,'retained');assert.equal(lesson.closes,0);assert.equal(pages.hasDraft(),true);
    await lesson.close();assert.equal(pages.hasDraft(),false);
  }
});
test('a written draft remains protected even if its input is temporarily absent',async()=>{
  const pages=new PageLifecycle(),lesson=new Page();pages.track(lesson,'lesson');pages.protect(lesson,'draft');
  assert.equal((await pages.release(lesson)).reason,'draft');assert.equal(lesson.closes,0);
  assert.equal((await pages.release(lesson,{completed:true})).status,'closed');assert.equal(pages.hasDraft(),false);
});
test('replacing a course catalog closes only the old empty catalog',async()=>{
  const pages=new PageLifecycle(),first=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/1'),second=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/2');
  await pages.replaceCatalog(first);await pages.replaceCatalog(first);assert.equal(first.closes,0);
  await pages.replaceCatalog(second);assert.equal(first.closes,1);assert.equal(second.closes,0);
  second.state={draft:true};const third=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/3');await pages.replaceCatalog(third);assert.equal(second.closes,0);
});
test('initial blank tabs are reused and obsolete restored lessons are cleaned conservatively',async()=>{
  const home=new Page(COURSE_HOME),duplicate=new Page(COURSE_HOME),blank=new Page('about:blank'),lesson=new Page(),draft=new Page('https://ucontent.unipus.cn/learn/draft',{draft:true}),foreign=new Page('https://example.test/private');
  const context=new Context([home,duplicate,blank,lesson,draft,foreign]),pages=new PageLifecycle();pages.attach(context);await pages.pruneEmpty();
  assert.equal(pages.homePage(),home);assert.equal(duplicate.closed,true);assert.equal(blank.closed,true);assert.equal(lesson.closed,true);assert.equal(draft.closed,false);assert.equal(foreign.closed,false);
});
test('course management uses the initial about:blank page instead of adding another tab',async()=>{
  const {engine}=fixture(),blank=new Page('about:blank'),context=new Context([blank]);engine.context=context;
  engine.navigate=async(page,url)=>{page.address=url;};assert.equal(await engine.coursePage(),blank);assert.equal(context.created,0);assert.equal(blank.url(),COURSE_HOME);
});
test('restored loading pages can be cleaned after loading settles instead of staying pinned forever',async()=>{
  const home=new Page(COURSE_HOME),loading=new Page(undefined,{loading:true}),pages=new PageLifecycle();
  pages.attach(new Context([home,loading]));await pages.pruneEmpty();assert.equal(loading.closed,false);
  loading.state={};await pages.pruneEmpty();assert.equal(loading.closed,true);
});
test('reopening the same course reuses its valid catalog even when an older course page was closed',async()=>{
  const {engine}=fixture(),home=new Page(COURSE_HOME),catalog=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/42'),stale=new Page();await stale.close();
  engine.context=new Context([home,catalog]);engine.pages.attach(engine.context);engine.pages.track(catalog,'catalog');
  engine.openedCourses.set('course',{page:stale,url:stale.url()});engine.catalogs.set('course',{page:catalog,url:catalog.url(),units:[]});
  assert.equal(await engine.openCourse({id:'course'}),catalog);assert.equal(engine.context.created,0);
});
test('thirty unsupported required items leave a bounded number of tabs and retain the manual list',async()=>{
  const {engine}=fixture(),home=new Page(COURSE_HOME),catalog=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/42'),context=new Context([home,catalog]);
  engine.context=context;engine.pages.attach(context);engine.pages.track(catalog,'catalog');
  const entries=Array.from({length:30},(_,i)=>({key:String(i),title:'Reading '+i,path:['Section'],required:true,pending:true,completed:false})),snapshot=directory(entries);
  const task={id:'many',unitId:'unit4',unitLabel:'Unit 4',status:'running',logs:[],manualItems:[],answered:0,pages:0};
  engine.courseDirectory=async()=>({page:catalog});engine.refreshTaskDirectory=async()=>snapshot;
  engine.openRequiredEntry=async()=>{const page=await context.newPage();page.address='https://ucontent.unipus.cn/learn/reading';engine.pages.track(page,'lesson',{taskId:task.id});return page;};
  engine.answerEntry=async()=>({manual:true});await engine.runTask(task,{}, {},new AbortController().signal);
  assert.equal(context.peak,3);assert.equal(context.pages().length,2);assert.equal(task.manualItems.length,30);assert.equal(task.status,'partial');
});
test('an unsupported page with a draft pauses for review instead of opening another item',async()=>{
  const {engine}=fixture(),lesson=new Page(undefined,{draft:true});engine.pages.track(lesson,'lesson',{taskId:'one'});
  const entry={key:'one',title:'Manual',path:[],required:true,pending:true,completed:false},task={id:'one',unitId:'unit4',status:'running',logs:[],manualItems:[],answered:0,pages:0};
  let reviewed=false;
  engine.courseDirectory=async()=>({page:{}});engine.openRequiredEntry=async()=>lesson;engine.answerEntry=async()=>({manual:true});
  engine.readExerciseFeedback=async()=>({failed:false});engine.refreshTaskDirectory=async()=>directory([{...entry,completed:reviewed,pending:!reviewed}]);
  engine.gate=async()=>{if(task.status==='review'){reviewed=true;assert.equal(lesson.closed,false);task.status='running';}};
  await engine.runTask(task,{}, {},new AbortController().signal);assert.equal(reviewed,true);assert.equal(lesson.closed,true);assert.equal(task.status,'completed');
});
test('cancelling popup navigation releases its empty page while keeping the directory',async()=>{
  const {engine}=fixture(),catalog=new Page('https://ucloud.unipus.cn/app/cmgt/resource-detail/42'),popup=new Page(),task={id:'cancel',unitId:'unit4',status:'running'},controller=new AbortController();
  engine.pages.track(catalog,'catalog');
  const entry={key:'one',selector:'#one',required:true,pending:true};
  engine.prepareDirectory=async()=>({...directory([entry]),frame:{locator:()=>({click:async()=>{catalog.emit('popup',popup);}})}});
  engine.waitCourseNavigation=async()=>{controller.abort();controller.signal.throwIfAborted();};
  await assert.rejects(engine.openRequiredEntry(task,{page:catalog,url:catalog.url()},null,entry,controller.signal),{name:'AbortError'});
  await engine.pages.releaseTask(task.id);assert.equal(popup.closed,true);assert.equal(catalog.closed,false);
});
test('task cleanup remains part of the running lock until async page cleanup completes',async()=>{
  const {engine,store}=fixture(),task={id:'async',status:'running',logs:[]};store.data.tasks=[task];
  let release,entered;const cleanup=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const pending=engine.runtime.start(task,new AbortController(),async()=>{task.status='completed';},async()=>{entered();await cleanup;});
  await started;assert.equal(engine.busy(),true);release();await pending;assert.equal(engine.busy(),false);
});
