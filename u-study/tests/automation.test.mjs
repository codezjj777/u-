import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {EventEmitter} from 'node:events';
import {Automation,COURSE_HOME,describeExerciseFailure} from '../automation.mjs';
import {AIRequestError} from '../answer-provider.mjs';
import '../dist/core.js';
function fixture(){const store={directory:'.cache',data:{tasks:[],courses:[],bank:[],settings:{}},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});},addActivity(){},notice(){}};const engine=new Automation(store);engine.readExerciseFeedback=async()=>({summary:false,failed:false});engine.waitSubmissionFeedback=async()=>({summary:false,failed:false});engine.verifyQuestion=async()=>{};return {engine,store};}

test('browser launches with its sandbox enabled, including a fallback browser',async t=>{
  const previous=process.env.USTUDY_BROWSER;delete process.env.USTUDY_BROWSER;
  t.after(()=>{if(previous===undefined)delete process.env.USTUDY_BROWSER;else process.env.USTUDY_BROWSER=previous;});
  const attempts=[],context={setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(){}};
  t.mock.method(chromium,'launchPersistentContext',async(directory,options)=>{
    attempts.push({directory,options});
    assert.equal(options.chromiumSandbox,true);
    assert.equal((options.args||[]).includes('--no-sandbox'),false);
    if(options.channel==='msedge')throw new Error('Edge unavailable for this test');
    return context;
  });
  const {engine,store}=fixture();
  assert.equal(await engine.ensureBrowser(),context);
  assert.deepEqual(attempts.map(a=>a.options.channel),['msedge','chrome']);
  assert.equal(store.windowOpen,true);
  assert.equal(await engine.ensureBrowser(),context);
  assert.equal(attempts.length,2);
});

test('opening a course waits for its card and uses its scoped target instead of global title text',async()=>{
  const {engine}=fixture();let url=COURSE_HOME,reads=0,clicks=0,front=false;
  const page=new EventEmitter();Object.assign(page,{isClosed:()=>false,url:()=>url,waitForLoadState:async()=>{},bringToFront:async()=>{front=true;}});
  const frame={locator:selector=>{assert.equal(selector,'[data-ustudy-course-entry="0"]');return {click:async()=>{clicks++;url='https://ucontent.unipus.cn/course/42';}};}};
  const course={id:'title-英语（第三版）',title:'英语（第三版）',url:COURSE_HOME,entry:{title:'英语（第三版）',pageIndex:0}};
  engine.ensureBrowser=async()=>({});engine.coursePage=async()=>page;engine.navigate=async()=>{};
  engine.readCourses=async()=>++reads===1?{courses:[],entries:[]}:{courses:[course],entries:[{id:'updated-course-id',title:'英语(第三版)',selector:'[data-ustudy-course-entry="0"]',frame}]};
  assert.equal(await engine.openCourse(course),page);assert.equal(reads,2);assert.equal(clicks,1);assert.equal(front,false);assert.equal(page.listenerCount('popup'),0);
  assert.equal(await engine.openCourseForUser(course),page);assert.equal(front,true,'only an explicit user open brings the course to the foreground');
});

test('automatic course-list reads leave the foreground alone while explicit login still shows the browser',async()=>{
  const {engine}=fixture();let focused=0,navigated=0;
  const page={url:()=>COURSE_HOME,isClosed:()=>false},context={pages:()=>[page]};
  engine.ensureBrowser=async()=>context;engine.focusPage=async target=>{assert.equal(target,page);focused++;};engine.navigate=async()=>{navigated++;};
  assert.equal(await engine.coursePage(),page);assert.equal(focused,0);
  await engine.connectBrowser();assert.equal(focused,1);assert.equal(navigated,1);
});

test('course matching prefers its stable id when different courses have the same name',async()=>{const {engine}=fixture();const course={id:'course-42',title:'同名课程'};engine.readCourses=async()=>({courses:[course],entries:[{id:'course-10',title:course.title,selector:'wrong'},{id:course.id,title:course.title,selector:'right'}]});const result=await engine.waitCourseList({isClosed:()=>false},0,{course,timeout:0});assert.equal(result.entry.selector,'right');});

test('identical textbook titles are selected within the requested class and scoring period',async()=>{const {engine}=fixture();const group={name:'大学英语',className:'B1 班',period:'2026/08/03-2027/02/03'};const course={id:'saved',title:'综合教程2',group};engine.readCourses=async()=>({courses:[course],entries:[{id:'old',title:course.title,group:{...group,period:'2026/02/27-2026/08/27'},selector:'old-semester'},{id:'other',title:course.title,group:{...group,className:'B2 班'},selector:'other-class'},{id:'new-id',title:course.title,group,selector:'right'}]});const result=await engine.waitCourseList({isClosed:()=>false},0,{course,timeout:0});assert.equal(result.entry.selector,'right');});

test('a missing scoring period never falls back to a textbook in another semester',async()=>{const {engine}=fixture();const group={name:'大学英语',className:'B1 班',period:'2026/08/03-2027/02/03'};const course={id:'saved',title:'综合教程2',group};engine.readCourses=async()=>({courses:[course],entries:[{id:'saved',title:course.title,group:{...group,period:'2026/02/27-2026/08/27'},selector:'wrong'}]});await assert.rejects(engine.waitCourseList({isClosed:()=>false},0,{course,timeout:0}),/未找到/);});

test('an unactivated textbook cannot start an automatic-answer task',()=>{const {engine,store}=fixture();store.data.courses=[{id:'inactive',title:'教程3',requiresActivation:true}];assert.throws(()=>engine.startTask('inactive'),/尚未激活/);assert.equal(store.data.tasks.length,0);});

test('true duplicate course entries are reported without choosing the first',async()=>{const {engine}=fixture();const course={id:'title-同名课程',title:'同名课程'};engine.readCourses=async()=>({courses:[course],entries:[{id:course.id,title:course.title,selector:'a'},{id:course.id,title:course.title,selector:'b'}]});await assert.rejects(engine.waitCourseList({isClosed:()=>false},0,{course,timeout:0}),/2 个同名课程/);});

test('an empty loading page is reported as loading timeout rather than a duplicate course',async()=>{const {engine}=fixture();engine.readCourses=async()=>({courses:[],entries:[]});await assert.rejects(engine.waitCourseList({isClosed:()=>false},0,{course:{title:'Course'},timeout:0}),/课程列表加载超时/);});

test('expired login and a missing course have distinct actionable messages',async()=>{const {engine}=fixture(),page={isClosed:()=>false};engine.readCourses=async()=>({courses:[],entries:[],login:true});await assert.rejects(engine.waitCourseList(page,0,{timeout:0}),/登录已失效/);engine.readCourses=async()=>({courses:[{id:'another'}],entries:[]});await assert.rejects(engine.waitCourseList(page,0,{course:{id:'missing',title:'目标课程'},timeout:0}),/未找到「目标课程」/);});

test('temporary SSO redirects can finish before a course is treated as logged out',async()=>{const {engine}=fixture();let reads=0;engine.readCourses=async()=>++reads===1?{courses:[],entries:[],login:true}:{courses:[{id:'loaded'}],entries:[],login:false};const snapshot=await engine.waitCourseList({isClosed:()=>false},0);assert.equal(snapshot.courses[0].id,'loaded');assert.equal(reads,2);});

test('stopping a task aborts course opening before launching a browser',async()=>{const {engine}=fixture();let launched=false;engine.ensureBrowser=async()=>{launched=true;};const controller=new AbortController();controller.abort();await assert.rejects(engine.openCourse({}, {signal:controller.signal}),{name:'AbortError'});assert.equal(launched,false);});

test('clicking a course must produce navigation or a course popup before it is reported open',async()=>{const {engine}=fixture();const page={isClosed:()=>false,url:()=>COURSE_HOME};await assert.rejects(engine.waitCourseNavigation(page,()=>null,COURSE_HOME,{timeout:0}),/点击后未进入课程内容/);const popup={isClosed:()=>false,url:()=> 'https://ucontent.unipus.cn/course/42',waitForLoadState:async()=>{}};assert.equal(await engine.waitCourseNavigation(page,()=>popup,COURSE_HOME,{timeout:0}),popup);await assert.rejects(engine.waitCourseNavigation(page,()=>({...popup,url:()=> 'https://other.test/course'}),COURSE_HOME,{timeout:0}),/未支持的网址/);});

test('pagination waits for new course identities rather than accepting the previous page',async()=>{const {engine}=fixture();let reads=0;engine.readCourses=async()=>({courses:[{id:++reads===1?'old':'new'}],entries:[]});const snapshot=await engine.waitCourseList({isClosed:()=>false},1,{previousFingerprint:'old'});assert.equal(reads,2);assert.equal(snapshot.courses[0].id,'new');});
test('single choice only checks the target radio, never tries to uncheck another',async()=>{const {engine}=fixture(),calls=[];const frame={locator:s=>({setChecked:async checked=>calls.push([s,checked])})};await engine.fillQuestion(frame,{type:'single',targets:[{selector:'one',kind:'native'},{selector:'two',kind:'native'}]},{indexes:[1],answers:['two']});assert.deepEqual(calls,[['two',true]]);});
test('multi choice clears old selections and selects all matching options',async()=>{const {engine}=fixture(),calls=[];const frame={locator:s=>({setChecked:async checked=>calls.push([s,checked])})};await engine.fillQuestion(frame,{type:'multiple',targets:[{selector:'one',kind:'native'},{selector:'two',kind:'native'},{selector:'three',kind:'native'}]},{indexes:[0,2],answers:['one','three']});assert.deepEqual(calls,[['one',true],['two',false],['three',true]]);});
test('blank count mismatch stops before touching fields',async()=>{const {engine}=fixture();await assert.rejects(engine.fillQuestion({}, {type:'text',targets:[{selector:'a'},{selector:'b'}]},{answers:['one']}),/数量/);});
test('text filling verifies the value written',async()=>{const {engine}=fixture();let value;const frame={locator:()=>({fill:async x=>value=x,inputValue:async()=>value})};await engine.fillQuestion(frame,{type:'text',targets:[{selector:'a'}]},{answers:['answer']});assert.equal(value,'answer');});
test('pausing blocks further work, resuming unblocks, stopping aborts',async()=>{const {engine,store}=fixture(),task={id:'one',status:'running',logs:[]};store.data.tasks=[task];const ctl=new AbortController();engine.controllers.set(task.id,ctl);engine.controlTask('one','pause');let finished=false;const wait=engine.gate(task,ctl.signal).then(()=>{finished=true;});await sleep(20);assert.equal(finished,false);engine.controlTask('one','resume');await wait;assert.equal(finished,true);engine.controlTask('one','stop');assert.equal(ctl.signal.aborted,true);assert.equal(task.status,'stopped');});
test('missing answer source prevents task creation',()=>{const {engine,store}=fixture();store.data.courses=[{id:'c',title:'Course',url:'https://ucloud.unipus.cn/a'}];assert.throws(()=>engine.startTask('c'),/题库/);assert.equal(store.data.tasks.length,0);});
test('a missing bank answer stops before any field or submit is touched',async()=>{const {engine}=fixture(),task={id:'test',logs:[],status:'waiting',answered:0,pages:0};const snapshot={frame:{},questions:[{question:'Missing question?',options:['a','b'],type:'single',targets:[]}],signature:'same'};const page={url:()=>'https://ucontent.unipus.cn/learn/42'};engine.waitQuestions=async()=>snapshot;let filled=false;engine.fillQuestion=async()=>filled=true;await assert.rejects(engine.answerEntry(task,page, {autoSubmit:true},new AbortController().signal),/题库未匹配/);assert.equal(filled,false);assert.equal(task.answered,0);});
test('changed question during AI or bank resolution stops before filling',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Choose answer.',answer:'yes'}]);const task={id:'test',logs:[],status:'waiting',answered:0,pages:0};
  const page={url:()=>'https://ucontent.unipus.cn/learn/42'};const wait=engine.waitQuestions.bind(engine);let initial=true;
  engine.waitQuestions=async(...args)=>{if(initial){initial=false;return {frame:{},questions:[{question:'Choose answer.',options:['yes','no'],type:'single'}],signature:'before'};}return wait(...args);};
  engine.readLearningState=async()=>({});engine.readQuestions=async()=>({signature:'after'});
  await assert.rejects(engine.answerEntry(task,page, {autoSubmit:true},new AbortController().signal),/题目发生变化/);assert.equal(task.answered,0);
});

test('waiting for network-blocked loading never reads stale questions or clicks through the mask',async()=>{
  const {engine}=fixture(),task={id:'loading',status:'waiting',logs:[]};let read=false,clicked=false;
  engine.readLearningState=async()=>({loading:true,networkIssue:true});engine.readQuestions=async()=>{read=true;};engine.action=async()=>{clicked=true;};
  await assert.rejects(engine.waitQuestions(task,{}, {},new AbortController().signal,{timeout:10}),/网络异常.*未载入/);
  assert.equal(read,false);assert.equal(clicked,false);assert.match(task.logs[0].message,/网络异常/);
});

test('a directory never triggers a continue-learning action',async()=>{
  const {engine}=fixture(),task={id:'directory',status:'waiting',logs:[]};let clicks=0;
  const frame={url:()=> 'https://ucloud.unipus.cn/app/cmgt/resource-detail/42'},page={frames:()=>[frame]};
  engine.readLearningState=async()=>({loading:false,directory:true});engine.readQuestions=async()=>null;engine.action=async()=>{clicks++;return true;};
  await assert.rejects(engine.waitQuestions(task,page,{},new AbortController().signal,{timeout:700}),/当前仍是课程目录/);assert.equal(clicks,0);
});

test('waiting for a submitted question to change never reopens the course entry',async()=>{
  const {engine}=fixture(),task={id:'next',status:'waiting',logs:[]};let clicked=false;
  const frame={url:()=> 'https://ucontent.unipus.cn/learn/42',evaluate:async()=>false},page={frames:()=>[frame]};
  engine.readLearningState=async()=>({loading:false});engine.readQuestions=async()=>null;engine.action=async()=>{clicked=true;};
  await assert.rejects(engine.waitQuestions(task,page,{},new AbortController().signal,{previous:'old',timeout:10}),/题目没有切换/);assert.equal(clicked,false);
});

test('custom U校园 selections are verified by the selected class and are not clicked twice',async()=>{
  const {engine}=fixture();let selected=false,clicks=0;const element={classList:{contains:name=>name==='selected'&&selected}};
  const frame={locator:()=>({evaluate:async fn=>fn(element),click:async()=>{selected=true;clicks++;}})};
  const question={type:'single',targets:[{selector:'choice',kind:'unipus-choice'}]},answer={indexes:[0],answers:['Reading']};
  await engine.fillQuestion(frame,question,answer);await engine.fillQuestion(frame,question,answer);assert.equal(selected,true);assert.equal(clicks,1);
});

test('all visible question frames are read and each question is written to its owning frame',async()=>{
  const {engine,store}=fixture(),url='https://ucontent.unipus.cn/learn/frames';
  const questions=['First question?','Second question?'].map((question,i)=>({id:'q'+i,question,type:'text',options:[],targets:[{selector:'#answer',kind:'text'}]}));
  const frames=questions.map((question,i)=>({url:()=>url+'/'+i,evaluate:async()=>({questions:[question],issues:[]})}));
  const page={isClosed:()=>false,url:()=>url,frames:()=>frames};
  const snapshot=await engine.readQuestions(page,{});assert.equal(snapshot.questions.length,2);assert.deepEqual(snapshot.questionFrames,frames);
  store.data.bank=UStudy.validateBank(questions.map(question=>({question:question.question,answer:'answer'})));
  engine.waitQuestions=async()=>snapshot;const filled=[];engine.fillQuestion=async(frame,question)=>filled.push([frame,question.id]);
  const task={id:'frames',status:'running',logs:[],answered:0,pages:0};
  const result=await engine.answerEntryAttempt(task,page,{autoSubmit:false},new AbortController().signal);
  assert.equal(result.review,true);assert.deepEqual(filled,[[frames[0],'q0'],[frames[1],'q1']]);assert.equal(task.answered,2);
});

test('hidden frame ancestors are excluded while visible nested exercise frames remain active',async()=>{
  const {engine}=fixture(),url='https://ucontent.unipus.cn/learn';
  const main={url:()=>url,parentFrame:()=>null},hidden={url:()=>url+'/old',parentFrame:()=>main,frameElement:async()=>({isVisible:async()=>false,dispose:async()=>{}})};
  const child={url:()=>url+'/old-child',parentFrame:()=>hidden,frameElement:async()=>({isVisible:async()=>true,evaluate:async()=>true,dispose:async()=>{}})};
  assert.deepEqual(await engine.activeFrames({frames:()=>[main,hidden,child]}),[main]);
});

test('partial recognition blocks every write, AI request and submission',async()=>{
  const {engine}=fixture();engine.waitQuestions=async()=>({questions:[{question:'Recognized'}],issues:['Missing one answer field.']});
  engine.askModel=engine.fillQuestion=engine.action=async()=>assert.fail('partial exercises cannot be processed');
  const task={id:'partial',status:'running',logs:[],answered:0,pages:0};
  const result=await engine.answerEntryAttempt(task,{}, {aiEnabled:true,autoSubmit:true},new AbortController().signal);
  assert.equal(result.review,true);assert.match(result.message,/识别不完整/);assert.equal(task.answered,0);
});

test('the final pre-fill read also rejects newly missing frames or controls',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Complete this.',answer:'yes'}]);
  const question={question:'Complete this.',type:'text',options:[],targets:[{selector:'#one',kind:'text'}]},url='https://ucontent.unipus.cn/learn';
  const good={frame:{},questions:[question],signature:'complete'},incomplete={frame:{},questions:[question],signature:'missing-field',issues:['Missing field']};let reads=0;
  engine.waitQuestions=async()=>++reads===1?good:incomplete;engine.fillQuestion=async()=>assert.fail('a changed page cannot be filled');
  await assert.rejects(engine.answerEntryAttempt({id:'changed',status:'running',logs:[],answered:0,pages:0},{url:()=>url},{},new AbortController().signal),/题目发生变化/);
});

test('a detached sibling frame stops filling even if its URL and question text are unchanged',()=>{
  const {engine}=fixture(),url='https://ucontent.unipus.cn/learn';
  assert.throws(()=>engine.assertEntryPage({url:()=>url},url,{frames:[{frame:{url:()=>url,isDetached:()=>true},url}]}),/已切换/);
});

test('multiple group submit buttons never fall through to a next-page click',async()=>{
  const {engine,store}=fixture(),url='https://ucontent.unipus.cn/learn';
  const question={question:'Choose one.',type:'single',options:['yes','no'],targets:[{},{}]},frame={url:()=>url,evaluate:async(_fn,options)=>{assert.equal(options.kind,'submit');return {selector:null,count:2};}};
  const snapshot={frame,questions:[question],signature:'same'};engine.waitQuestions=async()=>snapshot;engine.fillQuestion=async()=>{};engine.action=async()=>assert.fail('no action is allowed with multiple submit buttons');
  store.data.bank=UStudy.validateBank([{question:question.question,answer:'yes'}]);
  const result=await engine.answerEntryAttempt({id:'groups',status:'running',logs:[],answered:0,pages:0},{url:()=>url},{autoSubmit:true},new AbortController().signal);
  assert.equal(result.review,true);assert.match(result.message,/多个提交入口/);
});

test('invalid choice indexes are rejected before any checkbox is changed',async()=>{
  let writes=0;const frame={locator:()=>({setChecked:async()=>writes++})};
  await assert.rejects(fixture().engine.fillQuestion(frame,{type:'multiple',targets:[{kind:'native'}]},{indexes:[3],answers:['bad']}),/索引/);assert.equal(writes,0);
});

test('study-time notices are dismissed before reading questions, including the final pre-fill check',async()=>{
  const {engine}=fixture(),task={id:'notice',status:'running',logs:[]};let dismissed=false,reads=0;
  const frame={url:()=> 'https://ucontent.unipus.cn/learn/42'},page={frames:()=>[frame]},snapshot={signature:'ready'};
  engine.readLearningState=async()=>({studyNotice:!dismissed});engine.action=async(_frame,kind)=>{assert.equal(kind,'notice');dismissed=true;return true;};
  engine.readQuestions=async()=>{assert.equal(dismissed,true);reads++;return snapshot;};
  assert.equal(await engine.waitQuestions(task,page,{},new AbortController().signal,{timeout:2000,openExercise:false}),snapshot);assert.equal(reads,2);
});

function directoryFixture(entries,unitId='id-unit4-tab'){
  return {units:[{id:'id-unit4-tab',label:'Unit 4',selector:'#unit4'},{id:'id-unit5-tab',label:'Unit 5',selector:'#unit5'}],activeUnitId:unitId,ready:true,loading:false,collapsed:[],fingerprint:unitId,entries:entries.map((entry,i)=>({key:String(i),title:'Exercise '+(i+1),path:['Reading'],required:true,pending:true,completed:false,selector:'#row'+i,...entry}))};
}
test('task creation requires a unit from the actual loaded course catalog',()=>{
  const {engine,store}=fixture();store.data.courses=[{id:'course',title:'Course'}];store.data.bank=[{question:'Example',answers:['yes']}];
  assert.throws(()=>engine.startTask('course'),/读取课程目录/);assert.throws(()=>engine.startTask('course','invented-unit'),/读取课程目录/);assert.equal(store.data.tasks.length,0);
});
test('switching units waits for the new body rather than accepting stale rows',async()=>{
  const {engine}=fixture();let reads=0,clicks=0;
  const frame={locator:()=>({click:async()=>{clicks++;}})};
  engine.readDirectory=async()=>({...directoryFixture([],++reads===1?'id-unit5-tab':'id-unit4-tab'),fingerprint:reads<3?'old body':'new body',frame});
  const result=await engine.prepareDirectory({},'id-unit4-tab',{timeout:2000});assert.equal(clicks,1);assert.equal(reads,4);assert.equal(result.fingerprint,'new body');
});
test('each required row is checked again and a changed optional row is not clicked',async()=>{
  const {engine}=fixture(),task={id:'task',unitId:'id-unit4-tab',status:'running'};let clicked=false;
  const directory=directoryFixture([{required:false}]);directory.frame={locator:()=>({click:async()=>{clicked=true;}})};
  engine.prepareDirectory=async()=>directory;
  await assert.rejects(engine.openRequiredEntry(task,{},directory,{key:'0'},new AbortController().signal),/状态已变化/);assert.equal(clicked,false);
});
test('a footer next action saves one leaf and never fills its optional destination',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Choose the answer.',answer:'yes'}]);let url='https://ucontent.unipus.cn/learn/required',reads=0,fills=0;const actions=[];
  const page={url:()=>url},task={id:'task',status:'running',logs:[],answered:0,pages:0};
  const snapshot={page,frame:{},questions:[{question:'Choose the answer.',type:'single',options:['yes','no'],targets:[]}],signature:'required',pageURL:url};
  engine.waitQuestions=async()=>{reads++;return snapshot;};engine.fillQuestion=async()=>{fills++;};
  engine.action=async(_frame,kind)=>{actions.push(kind);if(kind==='next'){url='https://ucontent.unipus.cn/learn/optional';return true;}return false;};
  await engine.answerEntry(task,page,{autoSubmit:true},new AbortController().signal);assert.equal(fills,1);assert.equal(reads,2);assert.deepEqual(actions,['submit','next']);assert.equal(task.answered,1);
});
test('a route change with identical question text still stops before filling',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Choose the answer.',answer:'yes'}]);let url='https://ucontent.unipus.cn/learn/required',reads=0,filled=false;
  const page={url:()=>url},task={id:'task',status:'running',logs:[],answered:0,pages:0};
  engine.waitQuestions=async()=>{if(++reads===2)url='https://ucontent.unipus.cn/learn/optional';return {frame:{},signature:'same',questions:[{question:'Choose the answer.',type:'single',options:['yes','no']}],pageURL:url};};engine.fillQuestion=async()=>{filled=true;};
  await assert.rejects(engine.answerEntry(task,page,{autoSubmit:true},new AbortController().signal),/项目已切换/);assert.equal(filled,false);
});

test('the loaded exercise URL is pinned after initial SPA navigation settles',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Choose the answer.',answer:'yes'}]);
  let url='https://ucontent.unipus.cn/learn',filled=false;
  const page={url:()=>url},task={id:'task',unitId:'id-unit4-tab',status:'running',logs:[],answered:0,pages:0};
  engine.waitQuestions=async()=>{url='https://ucontent.unipus.cn/learn#/courseware/unit4/scenario/writing';return {frame:{},signature:'same',questions:[{question:'Choose the answer.',type:'single',options:['yes','no']}],pageURL:url};};
  engine.fillQuestion=async()=>{filled=true;};
  const result=await engine.answerEntry(task,page,{autoSubmit:false},new AbortController().signal);assert.equal(filled,true);assert.equal(result.review,true);
  task.unitId='id-unit5-tab';filled=false;
  await assert.rejects(engine.answerEntry(task,page,{autoSubmit:false},new AbortController().signal),/其他单元/);assert.equal(filled,false);
});
test('directory completion controls progress and unsupported required content remains partial',async()=>{
  const {engine}=fixture(),task={id:'task',unitId:'id-unit4-tab',unitLabel:'Unit 4',status:'waiting',logs:[],answered:0,pages:0,manualItems:[]};
  const first=directoryFixture([{title:'Completed',completed:true,pending:false},{title:'Optional',required:false},{title:'Video'},{title:'Exercise'}]);
  const final=directoryFixture([{title:'Completed',completed:true,pending:false},{title:'Optional',required:false},{title:'Video'},{title:'Exercise',completed:true,pending:false}]);
  engine.courseDirectory=async()=>({});engine.prepareDirectory=async()=>first;const opened=[];
  engine.openRequiredEntry=async(_task,_catalog,_directory,entry)=>{opened.push(entry.title);return {};};engine.answerEntry=async()=>({manual:true});
  let refreshed=0;engine.refreshTaskDirectory=async()=>{task.requiredTotal=3;task.requiredCompleted=2;return ++refreshed===1?first:final;};
  await engine.runTask(task,{}, {},new AbortController().signal);assert.deepEqual(opened,['Video','Exercise']);assert.equal(task.status,'partial');assert.deepEqual(task.manualItems,['Reading / Video']);assert.equal(task.requiredCompleted,2);
});
test('submission alone does not advance to another required row until the directory confirms completion',async()=>{
  const {engine}=fixture(),task={id:'task',unitId:'id-unit4-tab',unitLabel:'Unit 4',status:'waiting',logs:[],answered:0,pages:0,manualItems:[]};
  const directory=directoryFixture([{}]);let resumed=false,focused=0;engine.focusPage=async()=>{focused++;};
  engine.courseDirectory=async()=>({});engine.prepareDirectory=async()=>directory;engine.openRequiredEntry=async()=>({bringToFront:async()=>{}});engine.answerEntry=async()=>({});
  engine.refreshTaskDirectory=async()=>resumed?{...directory,entries:directory.entries.map(e=>({...e,completed:true,pending:false}))}:directory;
  engine.gate=async()=>{if(task.status==='review'){resumed=true;task.status='running';}};
  await engine.runTask(task,{}, {},new AbortController().signal);assert.equal(resumed,true);assert.equal(task.status,'completed');assert.ok(task.logs.some(log=>/目录尚未显示/.test(log.message)));assert.equal(focused,0,'review notices must not steal focus');
});

test('review preserves the original reason when the lesson closes before it can be focused',async()=>{
  const {engine}=fixture(),task={id:'closed-review',unitId:'id-unit4-tab',unitLabel:'Unit 4',status:'waiting',logs:[],answered:0,pages:0,manualItems:[]};
  engine.courseDirectory=async()=>({});engine.refreshTaskDirectory=async()=>directoryFixture([{}]);engine.openRequiredEntry=async()=>({isClosed:()=>true});engine.answerEntry=async()=>({review:true,message:'原始停止原因：对方音频加载失败。'});engine.focusPage=async()=>assert.fail('must not focus a closed lesson');
  await assert.rejects(engine.runTask(task,{}, {},new AbortController().signal),/课程窗口已关闭/);assert.ok(task.logs.some(log=>/原始停止原因/.test(log.message)));
});

for(const mode of ['same-tab','popup'])test('required catalog clicks handle '+mode+' navigation while preserving a separate directory',async()=>{
  const {engine}=fixture(),task={id:'task',unitId:'id-unit4-tab',status:'running'},entry=directoryFixture([{}]).entries[0];
  let sourceURL='https://ucloud.unipus.cn/app/cmgt/resource-detail/42',newPages=0,focused=0;engine.focusPage=async()=>{focused++;};
  const destination='https://ucontent.unipus.cn/learn#/courseware/unit4/section/exercise';
  const source=new EventEmitter();Object.assign(source,{url:()=>sourceURL,isClosed:()=>false,waitForLoadState:async()=>{},bringToFront:async()=>{}});
  const popup={url:()=>destination,isClosed:()=>false,waitForLoadState:async()=>{},bringToFront:async()=>{}};
  const directory=directoryFixture([{}]);directory.frame={locator:()=>({click:async()=>{if(mode==='popup')source.emit('popup',popup);else sourceURL=destination;}})};
  const catalog={page:source,url:sourceURL};engine.prepareDirectory=async()=>directory;
  engine.ensureBrowser=async()=>({newPage:async()=>assert.fail('automatic catalog creation must not activate a native window')});engine.backgroundPage=async()=>{newPages++;return {directory:true};};engine.navigate=async(page,url)=>{assert.equal(page.directory,true);assert.equal(url,catalog.url);};
  const page=await engine.openRequiredEntry(task,catalog,directory,entry,new AbortController().signal);
  assert.equal(page,mode==='popup'?popup:source);assert.equal(engine.taskPages.get(task.id),page);assert.equal(newPages,mode==='popup'?0:1);assert.equal(source.listenerCount('popup'),0);assert.equal(focused,0);
});

test('a directory without required labels never becomes a falsely completed task',async()=>{
  const {engine}=fixture(),task={id:'task',unitId:'id-unit4-tab',unitLabel:'Unit 4',status:'waiting',logs:[],answered:0,pages:0,manualItems:[]};
  engine.courseDirectory=async()=>({});engine.refreshTaskDirectory=async()=>directoryFixture([{required:false}]);let opened=false;engine.openRequiredEntry=async()=>{opened=true;};
  await assert.rejects(engine.runTask(task,{}, {},new AbortController().signal),/没有读取到必修标记/);assert.equal(opened,false);assert.notEqual(task.status,'completed');assert.equal(task.answered,0);
});

test('late editable questions are not skipped just because directions rendered first',async()=>{
  const {engine}=fixture(),task={id:'late',status:'running',logs:[]},snapshot={signature:'essay',questions:[{}]};let reads=0;
  engine.readLearningState=async()=>({contentReady:true});engine.readQuestions=async()=>++reads>=7?snapshot:null;
  assert.equal(await engine.waitQuestions(task,{}, {},new AbortController().signal,{allowUnsupported:true,timeout:6000}),snapshot);
  engine.readQuestions=async()=>null;
  assert.equal(await engine.waitQuestions(task,{}, {},new AbortController().signal,{allowUnsupported:true,timeout:10}),null);
});

test('only a pre-fill loading failure reloads the same leaf once',async()=>{
  const {engine,store}=fixture();store.data.bank=UStudy.validateBank([{question:'Choose the answer.',answer:'yes'}]);let reads=0,reloads=0,fills=0;
  const url='https://ucontent.unipus.cn/learn#/courseware/unit4/scenario/essay',page={url:()=>url,reload:async()=>{reloads++;}},task={id:'retry',status:'running',logs:[],answered:0,pages:0};
  engine.waitQuestions=async()=>{if(++reads===1)throw new Error('U校园提示网络异常，必修练习未载入。');return {frame:{},signature:'same',pageURL:url,questions:[{question:'Choose the answer.',type:'single',options:['yes','no']}]};};
  engine.fillQuestion=async()=>{fills++;};await engine.answerEntry(task,page,{autoSubmit:false},new AbortController().signal);assert.equal(reloads,1);assert.equal(fills,1);
  engine.waitQuestions=async()=>{throw new Error('U校园提示网络异常，必修练习未载入。');};
  await assert.rejects(engine.answerEntry(task,page,{},new AbortController().signal),/网络异常/);assert.equal(reloads,2);assert.equal(fills,1);
});

test('answer requests have bounded cancellable timeouts and redact upstream failures',async()=>{
  const {engine}=fixture(),question={question:'Choose.',type:'single',options:['yes','no']},settings={endpoint:'https://ai.example.test/v1/chat/completions',model:'test'},signal=new AbortController().signal;
  await assert.rejects(engine.askModel(question,settings,'private-key',signal,{timeoutMs:10,maxAttempts:1,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,200);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});})}),/AI 答题请求超时/);
  await assert.rejects(engine.askModel(question,settings,'private-key',signal,{fetchImpl:async()=>{throw new Error('private-key');}}),error=>/请求失败/.test(error.message)&&!error.message.includes('private-key'));
  const answer=await engine.askModel(question,settings,'private-key',signal,{fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"answers":["yes"]}'}}]}))});assert.deepEqual(answer.answers,['yes']);
});

function aiRecoveryFixture(){
  const {engine,store}=fixture(),url='https://ucontent.unipus.cn/offline-recognition/ai-recovery';store.apiKey='fixture-key';
  const questions=[1,2,3].map(index=>({question:'Question '+index,type:'single',options:['yes','no'],targets:[{selector:'#yes-'+index,kind:'native'},{selector:'#no-'+index,kind:'native'}]}));
  const frame={url:()=>url,evaluate:async()=>{}},page={url:()=>url,bringToFront:async()=>{}},snapshot={frame,pageURL:url,frameURL:url,signature:'same',questions},task={id:'ai-recovery',status:'running',logs:[],answered:0,pages:0};
  engine.waitQuestions=engine.readQuestions=async()=>snapshot;const requests=[],filled=[];let failed=false;
  engine.askModel=async(question,settings,key,signal,options)=>{await options.beforeAttempt();requests.push(question.question);if(question===questions[2]&&!failed){failed=true;throw new AIRequestError('AI fixture transient failure',{code:'AI_NETWORK_ERROR',retryable:true});}return {source:'AI',answers:['yes'],indexes:[0]};};
  engine.fillQuestion=async(frame,question)=>filled.push(question.question);
  return {engine,store,page,snapshot,task,requests,filled};
}

test('recoverable AI failures wait for resume and retain prior page answers without writing partial results',async()=>{
  const {engine,store,page,task,requests,filled}=aiRecoveryFixture(),gate=engine.gate.bind(engine);let reviewed=0;
  engine.gate=async(task,signal)=>{if(task.status==='review'){reviewed++;assert.deepEqual(filled,[]);assert.deepEqual(requests,['Question 1','Question 2','Question 3']);task.status='running';}return gate(task,signal);};
  const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true,autoSubmit:false},new AbortController().signal);
  assert.equal(reviewed,1);assert.deepEqual(requests,['Question 1','Question 2','Question 3','Question 3']);assert.deepEqual(filled,['Question 1','Question 2','Question 3']);assert.equal(task.answered,3);assert.equal(result.review,true);assert.equal(store.data.bank.length,0);assert.ok(task.logs.some(log=>log.message.includes('前 2 道已准备的答案')));
});

test('changed material after an AI wait invalidates every saved answer before a retry or write',async()=>{
  const {engine,page,snapshot,task,requests,filled}=aiRecoveryFixture(),gate=engine.gate.bind(engine);
  engine.gate=async(task,signal)=>{if(task.status==='review'){engine.readQuestions=async()=>({...snapshot,signature:'different-material'});task.status='running';}return gate(task,signal);};
  await assert.rejects(engine.answerEntryAttempt(task,page,{aiEnabled:true},new AbortController().signal),/AI 请求期间题目或阅读材料发生变化/);assert.deepEqual(filled,[]);assert.equal(requests.length,3);
});

test('stopping an AI recovery wait discards pending answers without filling or storing them',async()=>{
  const {engine,store,page,task,requests,filled}=aiRecoveryFixture(),gate=engine.gate.bind(engine),controller=new AbortController();
  engine.gate=async(task,signal)=>{if(task.status==='review')controller.abort(new Error('fixture-stop'));return gate(task,signal);};
  await assert.rejects(engine.answerEntryAttempt(task,page,{aiEnabled:true},controller.signal),/fixture-stop/);assert.equal(requests.length,3);assert.deepEqual(filled,[]);assert.equal(store.data.bank.length,0);
});

test('nonrecoverable AI authentication errors do not enter resume loops or write earlier prepared answers',async()=>{
  const {engine,page,task,filled}=aiRecoveryFixture();let reviewed=false;
  engine.askModel=async()=>{throw new AIRequestError('认证失败（HTTP 401）',{code:'AI_HTTP_ERROR',httpStatus:401});};engine.gate=async task=>{if(task.status==='review')reviewed=true;};
  await assert.rejects(engine.answerEntryAttempt(task,page,{aiEnabled:true},new AbortController().signal),/认证失败/);assert.equal(reviewed,false);assert.deepEqual(filled,[]);
});

test('AI missing-material reports wait for manual review rather than crashing, guessing or marking a fillable page as skippable',async()=>{
  const {engine,store,page,task,filled}=aiRecoveryFixture();let requests=0;
  engine.askModel=async()=>{requests++;throw new AIRequestError('需要核对原文或音视频材料。',{code:'AI_MISSING_MATERIAL'});};
  const result=await engine.answerEntryAttempt(task,page,{aiEnabled:true},new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/材料/);assert.equal(requests,1);assert.deepEqual(filled,[]);assert.equal(task.answered,0);assert.equal(store.data.bank.length,0);
});

test('complete picture fields enter material preparation without waiting for the ordinary loading timeout',async()=>{
  const {engine}=fixture(),task={id:'pending-pictures',status:'running',logs:[]},page={},snapshot={signature:'pictures-ready',questions:[{question:'Describe.'}],issues:['图片材料待准备'],imageIssues:['图片材料待准备'],imageRequests:[{key:'one'}]};let reads=0;
  engine.readLearningState=async()=>({contentReady:true});engine.readQuestions=async()=>{reads++;return snapshot;};
  const started=performance.now();assert.equal(await engine.waitQuestions(task,page,{},new AbortController().signal,{timeout:5000}),snapshot);assert.equal(reads,2);assert.ok(performance.now()-started<3000);
});

function correctionFixture({text=false,unchanged=false}={}){
  const {engine,store}=fixture();store.apiKey='test-key';
  const url='https://ucontent.unipus.cn/learn#/courseware/unit4/conversation/exercise2';
  const page={url:()=>url},frame={url:()=>url};
  const question=text?{question:'Explain this expression.',type:'text',options:[],targets:[{selector:'text'}]}:{question:'Choose the correct answer.',type:'single',options:['First','Second','Third'],targets:[]};
  const snapshot={frame,signature:'same',pageURL:url,frameURL:url,questions:[question]},task={id:'correction',status:'running',logs:[],answered:0,pages:0};
  const feedback={summary:true,failed:true,total:text?8:1,objective:text?2:1,subjective:text?6:0,correct:0,incorrect:text?2:1,frame,pageURL:url,frameURL:url};
  const actions=[],corrections=[];let requests=0,fills=0;
  engine.waitQuestions=async()=>snapshot;engine.fillQuestion=async()=>{fills++;};
  engine.askModel=async(_question,_settings,_key,_signal,options)=>{corrections.push(options?.correction);const index=unchanged?0:requests%3;requests++;return {source:'AI',answers:[text?'A text answer':question.options[index]],indexes:text?[]:[index]};};
  engine.action=async(_frame,kind)=>{actions.push(kind);return true;};
  engine.waitSubmissionFeedback=async()=>feedback;engine.readExerciseFeedback=async()=>feedback;
  return {engine,store,task,page,frame,feedback,snapshot,actions,corrections,counts:()=>({requests,fills}),settings:{autoSubmit:true,aiEnabled:true},signal:new AbortController().signal};
}

test('failed submissions automatically return to modify with a strict limit of two retries',async()=>{
  const f=correctionFixture(),result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.review,true);assert.match(result.message,/2 次自动修改上限/);assert.deepEqual(f.actions,['submit','revise','submit','revise','submit']);assert.equal(f.task.answered,3);
  assert.deepEqual(f.corrections[1].previousAnswers,['First']);assert.match(f.corrections[1].feedback,/错误 1 道/);assert.deepEqual(f.counts(),{requests:3,fills:3});
});

test('an unchanged re-evaluated answer never gets filled or submitted a second time',async()=>{
  const f=correctionFixture({unchanged:true}),result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.review,true);assert.match(result.message,/停止重复提交/);assert.deepEqual(f.actions,['submit','revise']);assert.deepEqual(f.counts(),{requests:2,fills:1});assert.equal(f.task.pages,1);
});

test('a partial text page cannot repair objective errors belonging to a larger exercise',async()=>{
  const f=correctionFixture({text:true}),result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.review,true);assert.match(result.message,/客观题 2 道.*错误 2 道/);assert.match(result.message,/1 组题、1 个作答项，尚不能对应小结中的全部题目/);assert.deepEqual(f.actions,['submit','revise']);assert.deepEqual(f.counts(),{requests:1,fills:1});
});

test('automatic revise cannot fill another exercise even when it has identical question text',async()=>{
  const f=correctionFixture();let moved=false;
  f.page.url=()=>moved?'https://ucontent.unipus.cn/learn#/courseware/unit4/conversation/optional':f.snapshot.pageURL;
  f.engine.action=async(_frame,kind)=>{f.actions.push(kind);if(kind==='revise')moved=true;return true;};
  f.engine.waitQuestions=async()=>({...f.snapshot,pageURL:f.page.url()});
  const result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.review,true);assert.match(result.message,/需要从目录重新确认/);assert.deepEqual(f.counts(),{requests:1,fills:1});assert.deepEqual(f.actions,['submit','revise']);
});

test('a successful correction still returns to directory verification rather than declaring completion',async()=>{
  const f=correctionFixture();let submissions=0;
  f.engine.waitSubmissionFeedback=async()=>++submissions===1?f.feedback:{summary:true,failed:false};
  const result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.feedback.failed,false);assert.equal(result.review,undefined);assert.equal(f.task.status,'running');assert.deepEqual(f.actions,['submit','revise','submit']);
});

test('manual submit mode never clicks revise or requests a correction',async()=>{
  const f=correctionFixture(),result=await f.engine.answerEntry(f.task,f.page,{...f.settings,autoSubmit:false},f.signal);
  assert.equal(result.review,true);assert.deepEqual(f.actions,[]);assert.deepEqual(f.counts(),{requests:1,fills:1});
});

test('a changed summary prevents a stale automatic revise click',async()=>{
  const f=correctionFixture();f.engine.readExerciseFeedback=async()=>({...f.feedback,pageURL:'https://ucontent.unipus.cn/other'});
  const result=await f.engine.answerEntry(f.task,f.page,f.settings,f.signal);
  assert.equal(result.review,true);assert.match(result.message,/小结已变化/);assert.deepEqual(f.actions,['submit']);
});

test('submission observation waits for a delayed failed summary and obeys cancellation',async()=>{
  const {engine}=fixture();let reads=0;engine.readExerciseFeedback=async()=>++reads>=3?{summary:true,failed:true}:{summary:false,failed:false};
  const task={status:'running'};
  const feedback=await Automation.prototype.waitSubmissionFeedback.call(engine,task,{},new AbortController().signal,{timeout:1000,settleMs:0});assert.equal(feedback.failed,true);assert.ok(reads>=3);
  const controller=new AbortController();controller.abort();await assert.rejects(Automation.prototype.waitSubmissionFeedback.call(engine,task,{},controller.signal),{name:'AbortError'});
});

test('continuing review reports objective failure and never trusts stale directory completion',async()=>{
  const {engine}=fixture(),task={id:'summary-review',unitId:'id-unit4-tab',unitLabel:'Unit 4',status:'waiting',logs:[],answered:0,pages:0,manualItems:[]};
  const directory=directoryFixture([{}]);let resolved=false,refreshes=0,reviews=0;
  engine.courseDirectory=async()=>({});engine.openRequiredEntry=async()=>({bringToFront:async()=>{}});engine.answerEntry=async()=>({});
  engine.refreshTaskDirectory=async()=>{refreshes++;return resolved?{...directory,entries:directory.entries.map(e=>({...e,completed:true,pending:false}))}:directory;};
  engine.readExerciseFeedback=async()=>resolved?{summary:true,failed:false}:{summary:true,failed:true,objective:2,correct:0,incorrect:2};
  engine.gate=async()=>{if(task.status==='review'){reviews++;assert.equal(refreshes,1);resolved=true;task.status='running';}};
  await engine.runTask(task,{}, {},new AbortController().signal);assert.equal(reviews,1);assert.equal(task.status,'completed');assert.ok(task.logs.some(log=>/客观题 2 道，正确 0 道，错误 2 道/.test(log.message)));
  assert.doesNotMatch(describeExerciseFailure({}),/undefined|null/);
});

test('correction requests include prior answers as data and never include credentials in the payload',async()=>{
  const {engine}=fixture();let payload;
  const correction={feedback:'客观题 2 道，错误 2 道。',previousAnswers:['no']};
  const answer=await engine.askModel({question:'Choose.',type:'single',options:['yes','no'],context:'The answer is yes.'},{endpoint:'https://ai.example.test/v1/chat/completions',model:'test'},'private-key',new AbortController().signal,{correction,fetchImpl:async(_url,options)=>{payload=options.body;return new Response(JSON.stringify({choices:[{message:{content:'{"answers":["yes"]}'}}]}));}});
  assert.deepEqual(JSON.parse(JSON.parse(payload).messages[1].content).correction,correction);assert.equal(payload.includes('private-key'),false);assert.deepEqual(answer.answers,['yes']);
});

test('unit discovery can return locked units but answer preparation must wait for real requirements',async()=>{
  const {engine}=fixture(),pending={...directoryFixture([{required:false,status:'已锁定'}]),allLocked:true,ready:false};engine.readDirectory=async()=>pending;
  assert.equal((await engine.prepareDirectory({},'id-unit4-tab',{allowLocked:true})).allLocked,true);
  await assert.rejects(engine.prepareDirectory({},'id-unit4-tab',{timeout:0}),/全部显示「已锁定」/);
  let reads=0;engine.readDirectory=async()=>++reads<3?pending:{...directoryFixture([{}]),allLocked:false,fingerprint:'loaded'};
  const ready=await engine.prepareDirectory({},'id-unit4-tab',{timeout:2000});assert.equal(ready.ready,true);assert.equal(reads,4);
});
test('progress updates in an old unit body cannot masquerade as the newly selected unit',async()=>{
  const {engine}=fixture();let reads=0;const frame={locator:()=>({click:async()=>{}})};
  engine.readDirectory=async()=>{reads++;return {...directoryFixture([],reads===1?'id-unit5-tab':'id-unit4-tab'),heading:reads<4?'Time off':'Horns of a dilemma',fingerprint:reads<4?'old progress '+reads:'new body',frame};};
  const result=await engine.prepareDirectory({},'id-unit4-tab',{timeout:2000});assert.equal(result.heading,'Horns of a dilemma');assert.equal(reads,5);
});
