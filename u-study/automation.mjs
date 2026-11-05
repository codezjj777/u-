import {stat} from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import {ensureBrowserSession,showBrowserPage,createBackgroundPage} from './browser-session.mjs';
import {askModel,AIRequestError} from './answer-provider.mjs';
import {fillQuestion,verifyQuestion,prepareTextAnswer,TextInputError} from './answer-writer.mjs';
import {TaskRuntime,measureStage} from './task-runtime.mjs';
import {OperationManager} from './operation-manager.mjs';
import {PageLifecycle} from './page-lifecycle.mjs';
import {MediaMaterials} from './media-materials.mjs';
import {ImageMaterials,MAX_PAGE_IMAGE_BYTES} from './image-materials.mjs';
import {VOCABULARY_HANDLER,isVocabularyEntry,readVocabularyFromDOM,advanceVocabularyCards} from './vocabulary-cards.mjs';
import {isVideoViewEntry,finishVideoView,dragVideoProgress} from './video-view.mjs';
import {isAudioViewEntry,finishAudioView,dragAudioProgress} from './audio-view.mjs';
import {ExerciseLearningSession} from './exercise-learning.mjs';
import {OralSpeech} from './oral-speech.mjs';
import {ORAL_HANDLER,isOralRetellEntry} from './oral-activity.mjs';
import {ROLEPLAY_HANDLER,isRoleplayEntry} from './roleplay.mjs';
import {captureCorrectionAttempt,analyzeCorrectionHistory,correctionPromptFor,protectCorrectionAnswer} from './correction-history.mjs';
import {VideoFrames,mountVideoFramesFromDOM} from './video-frames.mjs';
import * as UStudy from './shared/core.mjs';
import { QUESTION_CONTROLS_HANDLER, collectQuestionsFromDOM, readExerciseNavigationFromDOM, readLearningStateFromDOM, findActionInDOM } from './platform-dom.mjs';
import { requiredQueue, summarizeDirectory } from './course-directory.mjs';

// Reload only the local directory reader when its source changes, so adapting
// a new directory layout does not discard the user's in-memory API key.
const directoryReaderURL=new URL('./course-directory.mjs',import.meta.url);
let directoryReaderVersion='',directoryReader;
async function currentDirectoryReader(){
  const version=String((await stat(directoryReaderURL)).mtimeMs);
  if(version!==directoryReaderVersion){directoryReader=(await import(`${directoryReaderURL.href}?v=${version}`)).collectDirectoryFromDOM;directoryReaderVersion=version;}
  return directoryReader;
}
// Like directory markup, player control markup can be adapted without losing
// a logged-in session. Only this read-only DOM adapter is refreshed.
const videoReaderURL=new URL('./video-view.mjs',import.meta.url);
let videoReaderVersion='',videoReader;
async function currentVideoReader(){
  const version=String((await stat(videoReaderURL)).mtimeMs);
  if(version!==videoReaderVersion){videoReader=(await import(`${videoReaderURL.href}?v=${version}`)).readVideoViewFromDOM;videoReaderVersion=version;}
  return videoReader;
}
const audioReaderURL=new URL('./audio-view.mjs',import.meta.url);
let audioReaderVersion='',audioReader;
async function currentAudioReader(){
  const version=String((await stat(audioReaderURL)).mtimeMs);
  if(version!==audioReaderVersion){audioReader=(await import(`${audioReaderURL.href}?v=${version}`)).readAudioViewFromDOM;audioReaderVersion=version;}
  return audioReader;
}
// Read-only platform markup can change independently of the task controller.
// Refresh course and lesson parsers without restarting the logged-in session.
const completionReaderURL=new URL('./platform-dom.mjs',import.meta.url);
let completionReaderVersion='',completionReaders;
async function currentCompletionReaders(){
  const version=String((await stat(completionReaderURL)).mtimeMs);
  if(version!==completionReaderVersion){const module=await import(`${completionReaderURL.href}?completion=${version}`);completionReaders={feedback:module.readExerciseFeedbackFromDOM,action:module.findActionInDOM,state:module.readLearningStateFromDOM,notice:module.readStudyNoticesFromDOM,courses:module.collectCoursesFromDOM};completionReaderVersion=version;}
  return completionReaders;
}

const oralHandlerURL=new URL('./oral-activity.mjs',import.meta.url);
let oralHandlerVersion='',oralHandler;
async function currentOralHandler(){const version=String((await stat(oralHandlerURL)).mtimeMs);if(version!==oralHandlerVersion){oralHandler=await import(`${oralHandlerURL.href}?oral=${version}`);oralHandlerVersion=version;}return oralHandler;}

const lessonActionsURL=new URL('./lesson-actions.mjs',import.meta.url);
let lessonActionsVersion='',lessonActions;
async function currentLessonActions(){const version=String((await stat(lessonActionsURL)).mtimeMs);if(version!==lessonActionsVersion){lessonActions=await import(`${lessonActionsURL.href}?actions=${version}`);lessonActionsVersion=version;}return lessonActions;}

const discussionHandlerURL=new URL('./discussion-board.mjs',import.meta.url);
let discussionHandlerVersion='',discussionHandler;
async function currentDiscussionHandler(){const version=String((await stat(discussionHandlerURL)).mtimeMs);if(version!==discussionHandlerVersion){discussionHandler=await import(`${discussionHandlerURL.href}?discussion=${version}`);discussionHandlerVersion=version;}return discussionHandler;}

const roleplayHandlerURL=new URL('./roleplay.mjs',import.meta.url);
let roleplayHandlerVersion='',roleplayHandler;
async function currentRoleplayHandler(){const version=String((await stat(roleplayHandlerURL)).mtimeMs);if(version!==roleplayHandlerVersion){roleplayHandler=await import(`${roleplayHandlerURL.href}?roleplay=${version}`);roleplayHandlerVersion=version;}return roleplayHandler;}

export const COURSE_HOME = 'https://ucloud.unipus.cn/app/cmgt/course-management';
const isPlatform = value => !!UStudy.safeCourseUrl(value);
const signature = UStudy.questionSignature;
const MAX_CORRECTION_RETRIES=2;
const MAX_EXERCISE_PAGES=30;
const submittedAnswerKey=(snapshot,answers)=>JSON.stringify([snapshot.signature,answers.map(answer=>answer.answers.map(value=>value.normalize('NFKC').replace(/\s+/g,' ').trim()))]);
const submissionGradeKey=feedback=>JSON.stringify(['summary','failed','total','objective','subjective','correct','incorrect','partial','unanswered'].map(key=>feedback[key]).concat(feedback.grading?.pending===true));
const entryTitle=task=>{try{const key=JSON.parse(task.entryKey);return Array.isArray(key)&&typeof key[2]==='string'?key[2]:'';}catch{return '';}};
function submittedSummary(feedback){
  if(!feedback?.summary||feedback.failed||feedback.grading?.pending||feedback.unanswered>0||!(feedback.total>0))return false;
  if(feedback.completion)return feedback.completion.allAnswered===true;
  return feedback.unanswered===0&&feedback.objective!==null&&feedback.subjective!==null&&feedback.objective+feedback.subjective===feedback.total;
}
function correctionCoverage(questions,feedback){
  // Grading categories are independent of UI controls. One text group can
  // contain several objectively graded blanks, dropdowns or matching pairs.
  const groups=questions.length,parts=questions.reduce((sum,question)=>sum+UStudy.questionPartCount(question),0);
  const count=value=>Number.isInteger(value)&&value>=0;
  const categorized=count(feedback.objective)&&count(feedback.subjective)?feedback.objective+feedback.subjective:null;
  const total=count(feedback.total)&&feedback.total>0?feedback.total:categorized;
  const consistent=categorized===null||categorized===total;
  return {groups,parts,total,complete:consistent&&total>0&&(groups===total||parts===total)};
}
function exerciseURL(value){
  try{
    const url=new URL(value),pageKeys=/^(?:page|pageIndex|questionIndex|currentQuestion|questionNo|subpage|step)$/i;
    for(const key of [...url.searchParams.keys()])if(pageKeys.test(key))url.searchParams.delete(key);
    const [route,query]=url.hash.slice(1).split('?'),params=new URLSearchParams(query||'');
    for(const key of [...params.keys()])if(pageKeys.test(key))params.delete(key);
    const normalized=route.replace(/\/(?:questions?|pages?|steps?)\/\d+\/?$/i,'');
    url.hash=normalized+(params.size?'?'+params.toString():'');return url.href;
  }catch{return '';}
}
export function canContinueExercise(before,after,task={}){
  if(!before?.navigation?.known||!after?.navigation?.known||!before.navigation.key||before.navigation.key!==after.navigation.key)return false;
  const title=entryTitle(task);if(title&&UStudy.normalize(title)!==UStudy.normalize(before.navigation.title))return false;
  const a=exerciseURL(before.pageURL),b=exerciseURL(after.pageURL);return !!a&&a===b;
}

export function describeExerciseFailure(feedback){
  const details=[];
  if(feedback.objective!==null&&feedback.objective!==undefined)details.push(`客观题 ${feedback.objective} 道`);
  if(feedback.correct!==null&&feedback.correct!==undefined)details.push(`正确 ${feedback.correct} 道`);
  if(feedback.incorrect!==null&&feedback.incorrect!==undefined)details.push(`错误 ${feedback.incorrect} 道`);
  if(feedback.partial>0)details.push(`部分正确 ${feedback.partial} 道`);
  if(feedback.unanswered>0)details.push(`未作答 ${feedback.unanswered} 道`);
  if(feedback.requirement)details.push(`要求${feedback.requirement}`);
  return `U校园显示未达到闯关条件${details.length?'：'+details.join('，'):''}。`;
}

export class Automation {
  constructor(store){this.store=store;this.context=null;this.launching=null;this.runtime=new TaskRuntime(store);this.controllers=this.runtime.controllers;this.taskPages=new Map();this.learningSessions=new Map();this.catalogs=new Map();this.openedCourses=new Map();this.pages=new PageLifecycle();this.media=new MediaMaterials(store.directory||'.runtime');this.mediaTranscripts=new WeakMap();this.imageReader=new ImageMaterials();this.imageMaterials=new WeakMap();this.catalogLoading=false;this.closing=false;this.operations=new OperationManager(operation=>{store.operation=operation;store.changed({persist:false});});}
  busy(){return this.runtime.busy();}
  async checkpoint(signal){
    signal?.throwIfAborted();const task=this.store.data.tasks.find(item=>this.runtime.runs.has(item.id));
    if(task)await this.gate(task,signal);signal?.throwIfAborted();
  }
  async ensureBrowser(){if(this.closing)throw new Error('服务正在关闭。');const context=await ensureBrowserSession.call(this);this.pages.attach(context);await this.pages.pruneEmpty();return context;}
  async focusPage(page){return showBrowserPage(page);}
  async backgroundPage(context){return createBackgroundPage(context);}
  async navigate(page,url,{signal}={}){
    await this.checkpoint(signal);
    if(!isPlatform(url))throw new Error('课程地址必须属于 U校园的 unipus.cn 域名。');
    try{await page.goto(url,{waitUntil:'domcontentloaded'});await this.checkpoint(signal);}catch(error){await this.checkpoint(signal);if(/ERR_CERT|CERTIFICATE|SSL/i.test(error.message))throw new Error('U校园连接证书校验失败。请检查系统时间和网络证书后重试。');if(/ERR_NAME|ERR_CONNECTION|TIMED_OUT|Timeout/i.test(error.message))throw new Error('U校园页面加载超时，请检查网络后重试。');throw new Error('未能打开 U校园页面，请检查登录窗口。');}
  }
  async connect(options={}){return this.operations.run('connect',signal=>this.connectBrowser({signal}),options);}
  async connectBrowser({signal}={}){
    if(this.busy()||this.catalogLoading)throw new Error('已有任务或目录读取正在进行，请稍候或停止当前任务。');
    const context=await this.ensureBrowser();
    let page=this.pages.homePage()||context.pages().find(p=>p.url().includes('/cmgt/course-management'));
    if(!page)page=await context.newPage();this.pages.track(page,'home');
    await this.focusPage(page);await this.navigate(page,COURSE_HOME,{signal});
    this.store.addActivity('U校园登录窗口已打开。','external');
    return {windowOpen:true};
  }
  async coursePage({signal}={}){
    await this.checkpoint(signal);
    const context=await this.ensureBrowser();
    let page=this.pages.homePage()||context.pages().find(p=>p.url().includes('/cmgt/course-management'));
    if(!page)page=await this.backgroundPage(context);this.pages.track(page,'home');
    if(!page.url().includes('/cmgt/course-management'))await this.navigate(page,COURSE_HOME,{signal});
    return page;
  }
  async readCourses(page,pageIndex){
    const found=[],entries=[];let countHint=0,login=false,nextFrame=null;
    for(const frame of page.frames()){
      if(!isPlatform(frame.url()))continue;
      try{const snapshot=await frame.evaluate((await currentCompletionReaders()).courses,{pageIndex});found.push(...snapshot.courses);entries.push(...(snapshot.entries||[]).map(entry=>({...entry,frame})));countHint=Math.max(countHint,snapshot.countHint);login ||= snapshot.login;if(snapshot.hasNext)nextFrame=frame;}catch(error){if(page.isClosed())throw new Error('登录窗口已关闭。');}
    }
    return {courses:found,entries,countHint,login,nextFrame};
  }
  async waitCourseList(page,pageIndex,{course,previousFingerprint,signal,timeout=20000}={}){
    const deadline=Date.now()+timeout;let snapshot,matches=[];
    do{
      await this.checkpoint(signal);if(page.isClosed())throw new Error('登录窗口已关闭。');
      snapshot=await this.readCourses(page,pageIndex);
      matches=[];
      const fingerprint=snapshot.courses.map(c=>c.id).sort().join('|');
      if(snapshot.courses.length&&fingerprint!==previousFingerprint){
        if(!course)return snapshot;
        const allEntries=snapshot.entries||[];
        const entries=course.group?allEntries.filter(e=>UStudy.courseGroupKey(e.group)===UStudy.courseGroupKey(course.group)):allEntries;
        const byId=entries.filter(e=>e.id===course.id);
        matches=byId.length?byId:entries.filter(e=>UStudy.normalize(e.title)===UStudy.normalize(course.entry?.title||course.title));
        if(matches.length===1)return {...snapshot,entry:matches[0]};
      }
      const remaining=deadline-Date.now();if(remaining<=0)break;
      await sleep(Math.min(250,remaining),undefined,{signal});
    }while(Date.now()<deadline);
    if(snapshot?.login&&!snapshot.courses.length)throw new Error('登录已失效，请在 U校园窗口完成登录。');
    if(matches.length>1)throw new Error(`课程列表中找到 ${matches.length} 个同名课程，请重新同步后按班级和记分周期选择「${course.title}」。`);
    if(previousFingerprint)throw new Error('课程分页尚未载入新内容，请稍后重试。');
    if(!snapshot?.courses.length)throw new Error('课程列表加载超时，请检查 U校园窗口中的网络和登录状态。');
    throw new Error(`当前列表未找到「${course.title}」，请重新同步课程。`);
  }
  async waitCourseNavigation(page,popup,beforeURL,{signal,timeout=15000}={}){
    const deadline=Date.now()+timeout;
    do{
      await this.checkpoint(signal);
      const destination=popup()||page;
      if(destination.isClosed())throw new Error('课程窗口已关闭。');
      const url=destination.url();
      if(url&&url!=='about:blank'&&(destination!==page||url!==beforeURL)){
        if(!isPlatform(url))throw new Error('课程跳转到了未支持的网址，请检查 U校园窗口。');
        await destination.waitForLoadState('domcontentloaded',{timeout:Math.max(1,Math.min(5000,deadline-Date.now()))}).catch(()=>{});await this.checkpoint(signal);
        return destination;
      }
      const remaining=deadline-Date.now();if(remaining<=0)break;
      await sleep(Math.min(200,remaining),undefined,{signal});
    }while(Date.now()<deadline);
    throw new Error('已定位课程卡片，但点击后未进入课程内容。请在 U校园窗口打开课程后重试。');
  }
  startSync(){
    if(this.store.syncing)throw new Error('正在同步课程，请稍候。');
    if(this.busy()||this.catalogLoading)throw new Error('请先停止答题任务或等待目录读取结束，再同步课程。');
    const lease=this.operations.acquire('sync');
    this.store.syncing=true;this.store.changed({persist:false});
    void this.operations.track(this.sync({signal:lease.signal}).catch(error=>{this.store.addActivity(`课程同步未完成：${error.message}`,'info');this.store.notice(error.message);}).finally(()=>{this.store.syncing=false;lease.release();this.store.changed({persist:false});}));
  }
  async sync({signal}={}){
    const page=await this.coursePage({signal});let combined=[],expected=0,complete=false,reason='',lastFingerprint='';
    // Allow the SPA to finish loading before declaring the page unsupported.
    let initial;
    for(let attempt=0;attempt<12;attempt++){await this.checkpoint(signal);initial=await this.readCourses(page,0);if(initial.courses.length||initial.login)break;await sleep(750,undefined,{signal});}
    if(initial?.login&&!initial.courses.length){this.store.connected=false;this.store.changed({persist:false});throw new Error('请先在独立登录窗口完成 U校园登录，再点击同步。');}
    for(let pageIndex=0;pageIndex<50;pageIndex++){
      await this.checkpoint(signal);
      let snapshot=pageIndex===0?initial:await this.readCourses(page,pageIndex);
      if(!snapshot?.courses.length){reason='当前页面未识别到课程卡片，需要按实际页面适配。';break;}
      const fingerprint=snapshot.courses.map(c=>c.id).sort().join('|');
      if(pageIndex>0&&fingerprint===lastFingerprint){reason='分页后内容没有变化，已停止重复读取。';break;}
      lastFingerprint=fingerprint;expected=Math.max(expected,snapshot.countHint);combined=UStudy.mergeCourses(combined,snapshot.courses);
      this.store.notice(`正在读取课程：已找到 ${combined.length} 门。`);
      // Trigger bounded lazy loading, then re-read before moving to another page.
      for(let scroll=0;scroll<3;scroll++){
        await this.checkpoint(signal);
        await page.evaluate(()=>{window.scrollTo(0,document.documentElement.scrollHeight);document.querySelectorAll('[class*="course-list"],[class*="courseList"]').forEach(el=>el.scrollTo?.(0,el.scrollHeight));});
        await sleep(350,undefined,{signal});const more=await this.readCourses(page,pageIndex);const before=combined.length;combined=UStudy.mergeCourses(combined,more.courses);snapshot.nextFrame=more.nextFrame||snapshot.nextFrame;expected=Math.max(expected,more.countHint);if(combined.length===before)break;
      }
      if(!snapshot.nextFrame){complete=!expected||combined.length>=expected;reason=complete?'':'页面提示的总数大于已读取数量，尚未全部同步。';break;}
      if(pageIndex===49){reason='达到 50 页同步上限。';break;}
      await this.checkpoint(signal);await snapshot.nextFrame.locator('[data-ustudy-next-courses="true"]').first().click();
      let changed=false;
      for(let i=0;i<20;i++){await sleep(300,undefined,{signal});const next=await this.readCourses(page,pageIndex+1);if(next.courses.length&&next.courses.map(c=>c.id).sort().join('|')!==lastFingerprint){changed=true;break;}}
      if(!changed){reason='分页按钮没有载入新内容，已停止。';break;}
    }
    if(!combined.length)throw new Error(reason||'没有识别到课程。请在登录窗口进入课程管理页。');
    this.store.data.courses=complete?combined:UStudy.mergeCourses(this.store.data.courses,combined);
    this.store.connected=true;this.store.data.lastSynced=Date.now();this.store.data.syncCoverage={complete,read:combined.length,expected,reason};
    this.store.addActivity(`${complete?'课程同步完成':'课程部分同步'}：${combined.length}${expected?'/'+expected:''} 门。${reason}`,'refresh');
    this.store.notice(complete?`已同步 ${combined.length} 门课程。`:`已读取 ${combined.length} 门课程。${reason}`);
  }
  async openCourseForUser(course,options={}){return this.operations.run('open',signal=>this.openCourse(course,{signal,foreground:true}),options);}
  async openCourse(course,{signal,foreground=false}={}){
    await this.checkpoint(signal);const context=await this.ensureBrowser();let page;
    const cached=[this.openedCourses.get(course.id),this.catalogs.get(course.id)].find(item=>item&&!item.page.isClosed()&&item.page.url()===item.url);
    if(cached){if(foreground)await this.focusPage(cached.page);return cached.page;}
    if(course.entry){
      page=await this.coursePage({signal});await this.navigate(page,course.url,{signal});
      for(let i=0;i<course.entry.pageIndex;i++){
        const snapshot=await this.waitCourseList(page,i,{signal});
        if(!snapshot.nextFrame)throw new Error('无法定位课程所在分页，请重新同步课程。');
        await snapshot.nextFrame.locator('[data-ustudy-next-courses="true"]').click();
        await this.waitCourseList(page,i+1,{signal,previousFingerprint:snapshot.courses.map(c=>c.id).sort().join('|')});
      }
      const {entry}=await this.waitCourseList(page,course.entry.pageIndex,{course,signal});
      const beforeURL=page.url();let popup=null;const onPopup=value=>{popup=value;this.pages.track(value,'opening-course');};
      const source=page;source.on('popup',onPopup);
      try{await this.checkpoint(signal);await entry.frame.locator(entry.selector).click({noWaitAfter:true});page=await this.waitCourseNavigation(source,()=>popup,beforeURL,{signal});}
      finally{source.off('popup',onPopup);}
    }else{page=foreground?await context.newPage():await this.backgroundPage(context);this.pages.track(page,'opening-course');await this.navigate(page,course.url,{signal});}
    await this.checkpoint(signal);await this.pages.replaceCatalog(page,{courseId:course.id});
    this.openedCourses.set(course.id,{page,url:page.url()});this.pruneCourseRecords();if(foreground)await this.focusPage(page);return page;
  }
  pruneCourseRecords(){for(const records of [this.catalogs,this.openedCourses])for(const [id,catalog] of records)if(catalog.page.isClosed?.())records.delete(id);}
  async readDirectory(page){
    if(page.isClosed())throw new Error('课程目录窗口已关闭。');
    const reader=await currentDirectoryReader();
    for(const frame of page.frames()){
      if(!isPlatform(frame.url()))continue;
      const snapshot=await frame.evaluate(reader).catch(error=>{if(page.isClosed())throw new Error('课程目录窗口已关闭。');if(/context.*destroyed|detached|navigation/i.test(error.message))return null;throw error;});
      if(!snapshot)continue;
      if(snapshot.units.length)return {...snapshot,frame};
      if(snapshot.login)throw new Error('登录已失效，请在 U校园窗口完成登录后重新读取目录。');
    }
    return {units:[],entries:[],collapsed:[],ready:false,loading:true};
  }
  async prepareDirectory(page,unitId,{signal,timeout=30000,allowLocked=false}={}){
    const deadline=Date.now()+timeout;let switched=false,previous='',previousHeading='',stable='',snapshot,expansions=0;
    do{
      await this.checkpoint(signal);snapshot=await this.readDirectory(page);
      if(snapshot.units.length){
        if(!unitId&&!snapshot.activeUnitId){await sleep(250,undefined,{signal});continue;}
        if(!unitId)unitId=snapshot.activeUnitId;
        const unit=snapshot.units.find(item=>item.id===unitId);
        if(!unit)throw new Error('目录中没有所选单元，请重新读取单元列表。');
        if(snapshot.activeUnitId!==unitId){
          if(!switched){previous=snapshot.fingerprint;previousHeading=snapshot.heading||'';await this.checkpoint(signal);await snapshot.frame.locator(unit.selector).click();switched=true;stable='';}
        }else if(!snapshot.loading&&(!switched||!previous||(previousHeading?!!snapshot.heading&&snapshot.heading!==previousHeading:snapshot.fingerprint!==previous))){
          if(snapshot.collapsed.length){
            if(++expansions>250)throw new Error('目录展开次数超过上限，请在 U校园检查章节结构。');
            await this.checkpoint(signal);await snapshot.frame.locator(snapshot.collapsed[0].selector).click();stable='';
          }else if(snapshot.ready||allowLocked&&snapshot.allLocked){
            const key=snapshot.activeUnitId+snapshot.fingerprint;
            if(stable===key){if(snapshot.ready)requiredQueue(snapshot,unitId);return snapshot;}
            stable=key;
          }
        }
      }
      if(Date.now()>=deadline)break;
      await sleep(250,undefined,{signal});
    }while(Date.now()<deadline);
    if(snapshot?.allLocked)throw new Error('目录仍全部显示「已锁定」，必修要求和完成状态尚不可读取。请稍后重新读取，或在来源目录核对学习要求。');
    throw new Error(snapshot?.loading?'U校园目录仍在加载，请检查网络和登录状态。':'所选单元的目录没有完整载入，请刷新课程目录后重试。');
  }
  async courseDirectory(course,{signal}={}){
    const cached=this.catalogs.get(course.id);
    if(cached&&!cached.page.isClosed()&&cached.page.url()===cached.url)return cached;
    const page=await this.openCourse(course,{signal});
    const snapshot=await this.prepareDirectory(page,undefined,{signal,allowLocked:true});
    const catalog={page,url:page.url(),units:snapshot.units};this.catalogs.set(course.id,catalog);return catalog;
  }
  async unitsForCourse(courseId,unitId,options={}){return this.operations.run('catalog',signal=>this.loadUnitsForCourse(courseId,unitId,{signal}),{timeoutMs:55000,...options});}
  async loadUnitsForCourse(courseId,unitId,{signal}={}){
    if(this.busy()||this.store.syncing||this.catalogLoading)throw new Error('请等待当前任务、同步或目录读取结束。');
    const course=this.store.data.courses.find(item=>item.id===courseId);if(!course)throw new Error('课程不存在，请先同步课程。');
    if(course.requiresActivation)throw new Error('该教程尚未激活，请先在 U校园完成激活。');
    this.catalogLoading=true;
    try{
      const catalog=await this.courseDirectory(course,{signal});
      const snapshot=await this.prepareDirectory(catalog.page,unitId,{allowLocked:true,signal});
      catalog.units=snapshot.units;
      return {courseId,units:snapshot.units.map(({id,label})=>({id,label})),activeUnitId:snapshot.activeUnitId,availability:snapshot.allLocked?'pending':'ready',summary:summarizeDirectory(snapshot),account:snapshot.account||'',heading:snapshot.heading||'',sourceURL:catalog.url,entries:snapshot.entries.map(({title,path,required,requiredLabel,status,rowText})=>({title,path,required,requiredLabel,status,rowText}))};
    }finally{this.catalogLoading=false;}
  }
  startTask(courseId,unitId,{oralReplacement}={}){
    if(oralReplacement){let entry;try{entry=JSON.parse(oralReplacement.entryKey);}catch{}if(!entry||entry[0]!==unitId||!Array.isArray(entry[1])||typeof entry[2]!=='string'||!/^[a-f0-9]{64}$/.test(oralReplacement.recordingKey||'')||!/^[a-f0-9]{64}$/.test(oralReplacement.draftKey||''))throw new Error('口语替换需要对应目录、已核对旧录音和完整预览草稿。');}
    if(this.store.syncing||this.catalogLoading)throw new Error('请等待课程同步或目录读取结束后再开始答题。');if(this.busy())throw new Error('已有任务正在运行，请先停止当前任务。');
    const course=this.store.data.courses.find(c=>c.id===courseId);if(!course)throw new Error('课程不存在，请先同步课程。');
    if(course.requiresActivation)throw new Error('该教程尚未激活，请先在 U校园完成激活。');
    const settings={...this.store.data.settings};
    if(!this.store.data.bank.length&&!settings.aiEnabled)throw new Error('请先在答题设置中导入题库，或配置 AI 接口。');
    if(settings.aiEnabled&&(!this.store.apiKey||this.store.keyEndpoint!==undefined&&this.store.keyEndpoint!==settings.endpoint))throw new Error('请在答题设置中保存当前接口对应的 API Key。');
    if(this.pages.hasDraft())throw Object.assign(new Error('还有上次任务保留的题页、草稿或播放内容，请先检查并关闭该题页，再开始新任务。'),{status:409});
    const unit=this.catalogs.get(courseId)?.units.find(item=>item.id===unitId);
    if(!unit)throw new Error('请先读取课程目录并选择一个单元。');
    if(this.operations.active||this.operations.closing)throw Object.assign(new Error('已有浏览器操作正在进行，请稍候。'),{status:409});
    const task={id:randomUUID(),courseId,courseTitle:UStudy.courseLabel(course),unitId:unit.id,unitLabel:unit.label,createdAt:Date.now(),updatedAt:Date.now(),status:'waiting',answered:0,pages:0,requiredTotal:0,requiredCompleted:0,manualItems:[],logs:[],source:'题库'};
    if(oralReplacement)task.oralReplacement={entryKey:oralReplacement.entryKey,recordingKey:oralReplacement.recordingKey,draftKey:oralReplacement.draftKey};
    this.store.data.tasks.unshift(task);this.store.data.tasks=this.store.data.tasks.slice(0,50);
    const ctl=new AbortController(),lease=this.operations.acquire('answer',{signal:ctl.signal,timeoutMs:0});
    this.store.addLog(task,`正在读取 ${unit.label} 的必修目录，将跳过选修和已完成项目。`);
    this.runtime.start(task,ctl,()=>this.runTask(task,course,settings,lease.signal),async()=>{
      try{await this.pages.releaseTask(task.id);}
      finally{this.taskPages.delete(task.id);lease.release();}
    });
    return task;
  }
  controlTask(id,action){
    if(action==='replace-oral'){
      const task=this.store.data.tasks.find(item=>item.id===id),review=task?.oralReview,page=this.taskPages.get(id);
      if(task?.status!=='review'||!this.runtime.runs.has(id)||!page||page.isClosed?.()||review?.ready!==true||review.entryKey!==task.entryKey||!/^[a-f0-9]{64}$/.test(review.recordingKey||'')||!/^[a-f0-9]{64}$/.test(review.draftKey||''))throw Object.assign(new Error('当前任务没有可重录的已核对本地音频，请先检查口语题和草稿。'),{status:409});
      task.oralReplacement={entryKey:review.entryKey,recordingKey:review.recordingKey,draftKey:review.draftKey};task.oralRetryRequested=true;
      this.store.addLog(task,`已选择用 ${Math.round(review.seconds)} 秒本地音频重录当前题，正在重新核对旧录音与草稿，不重复请求 AI。`);
      return this.runtime.control(id,'resume');
    }
    return this.runtime.control(id,action);
  }
  async gate(task,signal){return this.runtime.gate(task,signal);}
  async activeFrames(page){
    const frames=[];
    for(const frame of page.frames()){
      if(!isPlatform(frame.url()))continue;
      let visible=true;
      for(let current=frame;typeof current.parentFrame==='function'&&current.parentFrame();current=current.parentFrame()){
        let element;
        try{
          element=await current.frameElement();
          visible=await element.isVisible()&&await element.evaluate(el=>!el.closest('[hidden],[aria-hidden="true"],[inert]'));
        }catch{visible=false;}finally{await element?.dispose().catch(()=>{});}
        if(!visible)break;
      }
      if(visible)frames.push(frame);
    }
    return frames;
  }
  async readOralActivity(page){
    if(typeof page.frames!=='function')return null;
    if(!isPlatform(page.url()))throw new Error('口语题课程地址不属于 U校园，尚未检测。');
    const handler=await currentOralHandler(),found=[],navigations=[];
    for(const frame of await this.activeFrames(page)){
      const navigation=await frame.evaluate(readExerciseNavigationFromDOM).catch(()=>null);if(navigation?.known)navigations.push(navigation);
      const oral=await frame.evaluate(handler.readOralActivityFromDOM).catch(()=>null);if(oral)found.push({...oral,frame,pageURL:page.url(),frameURL:frame.url(),navigation});
    }
    if(!found.length)return null;if(found.length!==1)return {...found[0],ready:false,issue:'多个框架同时显示口语任务，尚未录音。'};
    const oral=found[0];if(!oral.navigation?.known&&navigations.length===1)oral.navigation=navigations[0];oral.key=handler.oralIdentity(oral);return oral;
  }
  async completeOralActivity(task,page,oral,settings,signal){
    this.oralSpeech ||= new OralSpeech(this.store.directory||'.runtime');
    return (await currentOralHandler()).runOralActivity(this,task,page,oral,settings,signal);
  }
  async readQuestions(page,settings){
    if(page.isClosed())throw new Error('课程窗口已关闭。');
    const questions=[],questionFrames=[],frames=[],issues=[],mediaIssues=[],manualIssues=[],mediaRequests=[],videoRequests=[],navigations=[],imageIssues=[],imageRequests=[],imageRecords=[];let hasAnswerControls=false;
    const saved=this.mediaTranscripts.get(page),mediaTranscripts=saved?.url===page.url()?saved.texts:{};
    const savedImages=this.imageMaterials.get(page),images=savedImages?.url===page.url()?savedImages.images:{},imageDigests=Object.fromEntries(Object.entries(images).map(([key,image])=>[key,image.digest]));
    for(const frame of await this.activeFrames(page)){
      const navigation=await frame.evaluate(readExerciseNavigationFromDOM).catch(()=>null);
      if(navigation?.known)navigations.push(navigation);
      try{
        const report=await frame.evaluate(collectQuestionsFromDOM,{questionSelector:settings.questionSelector,includeDiagnostics:true,mediaTranscripts,imageDigests});
        const found=Array.isArray(report)?report:report.questions||[];
        for(const question of found)if(question.images?.length)question.images=question.images.map(ref=>images[ref.key]?{...images[ref.key],key:ref.key,label:ref.label}:ref);
        if(found.length||report.issues?.length)frames.push({frame,url:frame.url(),count:found.length});
        questions.push(...found);questionFrames.push(...found.map(()=>frame));issues.push(...(report.issues||[]));
        hasAnswerControls ||= report.hasAnswerControls===true;if(report.manualOnly)manualIssues.push(...(report.issues||[]));
        mediaIssues.push(...(report.mediaIssues||[]));for(const media of report.mediaRequests||[])mediaRequests.push({...media,frame,referrer:frame.url()});
        for(const video of report.videoRequests||[])videoRequests.push({...video,frame,referrer:frame.url()});
        imageIssues.push(...(report.imageIssues||[]));for(const image of report.imageRequests||[])imageRequests.push({...image,frame,referrer:frame.url()});for(const image of report.imageRecords||[])imageRecords.push({...image,frame,referrer:frame.url()});
      }catch(error){
        if(settings.questionSelector&&/selector|SyntaxError|valid/i.test(error.message))throw new Error('题目容器选择器无效，请检查页面适配设置。');
        frames.push({frame,url:frame.url(),count:0});issues.push('有题目框架读取失败，请等待页面载入或刷新后重新识别。');
      }
    }
    if(!questions.length&&!issues.length)return null;
    const frame=frames[0].frame;
    const navigation=navigations.length&&new Set(navigations.map(item=>item.key)).size===1?navigations[0]:{known:false,key:''};
    return {page,frame,questions,questionFrames,frames,navigation,hasAnswerControls,issues:[...new Set(issues)],mediaIssues:[...new Set(mediaIssues)],imageIssues:[...new Set(imageIssues)],imageRequests,imageRecords,manualOnly:!questions.length&&!hasAnswerControls&&issues.length>0&&issues.every(issue=>manualIssues.includes(issue)),mediaRequests,videoRequests,signature:JSON.stringify([signature(questions),frames.map(item=>[item.url,item.count]),issues,navigation.key]),pageURL:page.url(),frameURL:frame.url()};
  }
  async readVocabulary(page){
    const found=[];
    for(const frame of await this.activeFrames(page)){
      try{
        const report=await frame.evaluate(readVocabularyFromDOM);if(!report)continue;
        const navigation=await frame.evaluate(readExerciseNavigationFromDOM),pageURL=page.url(),frameURL=frame.url();
        found.push({...report,page,frame,pageURL,frameURL,navigation,binding:JSON.stringify([pageURL,frameURL,navigation.key])});
      }catch{if(page.isClosed())throw new Error('课程窗口已关闭。');}
    }
    if(found.length>1)return {recognized:true,ready:false,requiresReview:true,issue:'多个框架同时显示词卡，尚未自动翻动。'};
    return found[0]||null;
  }
  assertVocabularyEntry(task,page,snapshot){
    if(!isVocabularyEntry(task)||!snapshot?.navigation?.known||UStudy.normalize(snapshot.navigation.title)!==UStudy.normalize(entryTitle(task))||UStudy.normalize(snapshot.navigation.chapter)!=='vocabulary')throw new Error('当前词卡与所选 Vocabulary 目录项目无法对应，尚未继续翻动。');
    this.assertEntryPage(page,snapshot.pageURL,snapshot);
    const routeUnit=page.url().match(/\/courseware\/([^/?#]+)/)?.[1];
    if(routeUnit&&routeUnit!==task.unitId.replace(/^id-/,'').replace(/-tab$/,''))throw new Error('词卡进入了其他单元，已停止翻动。');
  }
  async completeVocabulary(task,page,snapshot,signal,options={}){
    this.pages.protect(page,'vocabulary-progress');
    try{
      this.assertVocabularyEntry(task,page,snapshot);await this.disposeExerciseLearning(task.id);let logged=-1;
      const result=await advanceVocabularyCards({initial:snapshot,signal,checkpoint:()=>this.gate(task,signal),
        read:async()=>{const fresh=await this.readVocabulary(page);if(fresh)this.assertVocabularyEntry(task,page,fresh);return fresh;},
        click:async current=>{
          await this.gate(task,signal);const fresh=await this.readVocabulary(page);this.assertVocabularyEntry(task,page,fresh);
          if(!fresh.ready||fresh.binding!==current.binding||fresh.key!==current.key||!fresh.selector)throw new Error('点击前词卡已变化，尚未继续翻动。');
          await fresh.frame.locator(fresh.selector).click({timeout:5000});
        },
        onProgress:current=>{if(current.current!==logged&&(logged<0||current.current%10===0||current.current===current.total)){logged=current.current;this.store.addLog(task,`词卡学习：${entryTitle(task)} · ${current.current}/${current.total}。`);}},...options});
      this.store.addLog(task,`已确认词卡结束页：全部 ${result.total} 个词条已浏览，正在回查必修目录。`);
      return {vocabularyDone:true,total:result.total};
    }catch(error){signal?.throwIfAborted();return {review:true,message:`${error.message} 已保留词卡页，请核对进度，手动完成后点击「继续核对」，或停止后重新开始本单元。`};}
  }
  async readVideoView(page,task,settings={}){
    return this.readMediaView(page,task,settings,'video');
  }
  async readAudioView(page,task,settings={}){
    return this.readMediaView(page,task,settings,'audio');
  }
  async readMediaView(page,task,settings,kind){
    const label=kind==='audio'?'音频':'视频',found=[],reader=await (kind==='audio'?currentAudioReader():currentVideoReader()),questions=await this.readQuestions(page,settings);
    for(const frame of await this.activeFrames(page)){
      try{
        let report=await frame.evaluate(reader);if(!report)continue;
        if(questions?.hasAnswerControls||questions?.questions?.length)report={...report,ready:false,requiresReview:true,issue:`${label}页同时有可作答题目，尚未按纯${label}处理。`};
        const navigation=await frame.evaluate(readExerciseNavigationFromDOM),pageURL=page.url(),frameURL=frame.url();
        found.push({...report,page,frame,pageURL,frameURL,navigation,binding:JSON.stringify([pageURL,frameURL,navigation.key,report.sourceKey])});
      }catch{if(page.isClosed())throw new Error('课程窗口已关闭。');}
    }
    if(found.length>1)return {recognized:true,ready:false,requiresReview:true,issue:`多个框架同时显示${label}，无法确认当前项目。`};
    return found[0]||null;
  }
  assertVideoViewEntry(task,page,snapshot){
    return this.assertMediaViewEntry(task,page,snapshot,'video');
  }
  assertAudioViewEntry(task,page,snapshot){
    return this.assertMediaViewEntry(task,page,snapshot,'audio');
  }
  assertMediaViewEntry(task,page,snapshot,kind){
    const label=kind==='audio'?'音频':'视频',eligible=kind==='audio'?isAudioViewEntry:isVideoViewEntry;
    if(!eligible(task)||!snapshot?.navigation?.known||UStudy.normalize(snapshot.navigation.title)!==UStudy.normalize(entryTitle(task)))throw new Error(`当前${label}与所选目录项目无法对应，已停止播放处理。`);
    this.assertEntryPage(page,snapshot.pageURL,snapshot);
    const routeUnit=page.url().match(/\/courseware\/([^/?#]+)/)?.[1];if(routeUnit&&routeUnit!==task.unitId.replace(/^id-/,'').replace(/-tab$/,''))throw new Error(`${label}进入了其他单元，已停止处理。`);
  }
  async completeVideoView(task,page,snapshot,settings,signal,options={}){
    return this.completeMediaView(task,page,snapshot,settings,signal,'video',options);
  }
  async completeAudioView(task,page,snapshot,settings,signal,options={}){
    return this.completeMediaView(task,page,snapshot,settings,signal,'audio',options);
  }
  async completeMediaView(task,page,snapshot,settings,signal,kind,options={}){
    const label=kind==='audio'?'音频':'视频',readView=kind==='audio'?this.readAudioView.bind(this):this.readVideoView.bind(this),assertEntry=kind==='audio'?this.assertAudioViewEntry.bind(this):this.assertVideoViewEntry.bind(this),finish=kind==='audio'?finishAudioView:finishVideoView,drag=kind==='audio'?dragAudioProgress:dragVideoProgress;
    this.pages.protect(page,`${kind}-progress`);const binding=snapshot.binding;
    const read=async()=>{const fresh=await readView(page,task,settings);if(fresh)assertEntry(task,page,fresh);return fresh;};
    const interact=async(record,action,selector,perform,{pausing=false,cleanup=false}={})=>{
      const actionSignal=cleanup?undefined:signal;
      const controlCheck=pausing?async()=>{actionSignal?.throwIfAborted();const current=await read();if(!current||current.binding!==binding)throw new Error(`${label}控件已变化，尚未继续。`);}:checkpoint;
      // Pausing must run before waiting at the task's pause gate, including
      // cleanup after the task's original signal has already been aborted.
      const controller=pausing?{checkpoint:async value=>value?.throwIfAborted()}:this;
      const operation=async()=>(await currentLessonActions()).performControlAction(controller,record.frame,action,selector,perform,{signal:actionSignal,checkpoint:controlCheck,allowMotion:true});
      return pausing?operation():this.withStudyNoticeRecovery(task,page,actionSignal,operation);
    };
    const reveal=async record=>{if(kind==='video')await record.frame.locator(record.playerSelector).hover({timeout:3000});};
    const setPlaying=async(playing,{cleanup=false}={})=>{
      let fresh=await read();if(!fresh||fresh.binding!==binding)throw new Error(`播放操作前${label}已变化，尚未继续。`);
      if(fresh.ended||fresh.paused===!playing)return;
      if(!fresh.playerSelector)throw new Error(`${label}播放控件尚不可用。`);
      // Video.js posters and text layers cover the native video. Hover the
      // enclosing player so its ordinary controls appear through those layers.
      if(kind==='video'){await reveal(fresh);fresh=await read();}
      if(!fresh||fresh.binding!==binding||!fresh.playSelector)throw new Error(`${label}控件已变化，尚未继续。`);
      if(kind==='video'){await fresh.frame.locator(fresh.playSelector).click({timeout:5000});return {clicked:true};}
      let clicked=false;
      await interact(fresh,playing?'play':'pause',fresh.playSelector,async(_locator,point)=>{
        const current=await read();if(!current||current.binding!==binding)throw new Error(`${label}控件已变化，尚未继续。`);
        if(!current.ended&&current.paused!==!playing){if(!point)throw new Error('音频按钮尚不可定位。');await page.mouse.click(point.x,point.y);clicked=true;}
      },{pausing:!playing,cleanup});
      return {clicked};
    };
    const checkpoint=async()=>{
      signal?.throwIfAborted();
      if(task.status==='paused'){
        const fresh=await read(),resume=fresh?.binding===binding&&!fresh.paused&&!fresh.ended;if(resume)await setPlaying(false);
        await this.gate(task,signal);if(resume)await setPlaying(true);
      }else await this.gate(task,signal);
    };
    try{
      assertEntry(task,page,snapshot);await this.disposeExerciseLearning(task.id);
      const result=await finish({initial:snapshot,read,play:()=>setPlaying(true),pause:()=>setPlaying(false),signal,checkpoint,
        seek:async(current,target)=>{
          await checkpoint();await reveal(current);const fresh=await read();
          if(!fresh||fresh.binding!==binding||!fresh.trackSelector)throw new Error(`${label}进度条已变化，尚未拖动。`);
          if(kind==='video'){await drag(page,fresh.frame,fresh,target,{signal,checkpoint});return;}
          await interact(fresh,'seek',fresh.thumbSelector||fresh.trackSelector,async()=>{
            const position=await read();if(!position||position.binding!==binding||!position.trackSelector)throw new Error(`${label}进度条已变化，尚未拖动。`);
            await drag(page,position.frame,position,target,{signal,checkpoint});
          });
        },
        onProgress:phase=>this.store.addLog(task,{seeking:`正在将${label}进度条拖至结束前约 1 秒，随后开始播放。`,seeked:'已核对进度条位置，正在点击播放。','play-clicked':`已点击${label}播放按钮，正在核对实际播放状态。`,playing:`已确认${label}从末尾开始播放，正在等待自然结束。`,'waiting-end':'正在等待播放器的自然结束状态。','resuming-end':'检测到音频在末尾意外暂停，正在从当前位置继续播放。',resumed:'已确认音频继续播放，正在等待自然结束。',ended:`已确认${label}自然播放结束，正在回查必修目录。`}[phase]),...options});
      return {[kind==='audio'?'audioDone':'videoDone']:true,duration:result.duration};
    }catch(error){
      try{const fresh=await read();if(fresh?.binding===binding&&!fresh.paused&&!fresh.ended)await setPlaying(false,{cleanup:true});}catch{}
      signal?.throwIfAborted();
      const message=error.name==='TimeoutError'||/^(?:locator|mouse|page|frame)\./.test(error.message||'')?'播放器控件操作超时或被其他界面遮挡，请确认播放器可见并关闭遮挡后重试。':error.message;
      return {review:true,message:`${message} 已保留${label}页，请核对播放和进度条，手动完成后点击「继续核对」。`};
    }
  }
  async waitNextExercisePage(task,page,settings,previous,signal,{timeout=20000}={}){
    let elapsed=0,stable='';
    while(elapsed<timeout){
      await this.gate(task,signal);const started=Date.now();
      if(page.isClosed())throw new Error('课程窗口已关闭。');
      let state=await this.readLearningState(page);
      if(state.login)throw new Error('翻页后登录校验失败，请重新进入课程。');
      if(state.studyNotice){await this.withStudyNoticeRecovery(task,page,signal,()=>this.dismissStudyNotice(task,page,signal),{noticeOnly:true});state=await this.readLearningState(page);}
      if(!state.loading&&!state.studyNotice){
        if(state.networkIssue)throw new Error('翻页后出现网络异常，后续题目尚未载入。');
        const feedback=await this.readExerciseFeedback(page);if(feedback.summary)return {feedback};
        let snapshot=await this.readQuestions(page,settings);
        if(!snapshot?.questions?.length&&!snapshot?.hasAnswerControls){const oral=await this.readOralActivity(page);if(oral)snapshot={oralActivity:oral,signature:oral.key,navigation:oral.navigation,pageURL:oral.pageURL,frame:oral.frame};}
        if(snapshot&&snapshot.signature!==previous.signature){
          if(stable===snapshot.signature)return {snapshot,boundary:!canContinueExercise(previous,snapshot,task)};
          stable=snapshot.signature;
        }else stable='';
        if(state.directory)return {boundary:true};
      }else stable='';
      elapsed+=Date.now()-started;
      if(elapsed<timeout){const delay=Math.min(400,timeout-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;}
    }
    throw new Error('点击「下一题」后未读到稳定的新题目，后续页面尚未填答，请检查题页。');
  }
  async prepareMedia(task,page,snapshot,settings,signal){
    if(!snapshot.mediaRequests?.length||snapshot.issues?.some(issue=>!snapshot.mediaIssues?.includes(issue)&&!snapshot.imageIssues?.includes(issue)))return snapshot;
    const url=snapshot.pageURL||page.url(),additions={},requests=[...new Map(snapshot.mediaRequests.map(record=>[record.key,record])).values()];
    const checkpoint=async()=>{
      await this.gate(task,signal);this.assertEntryPage(page,url,snapshot);await this.dismissStudyNotice(task,page,signal);
      const fresh=await this.readQuestions(page,settings);
      if(!fresh||fresh.signature!==snapshot.signature)throw Object.assign(new Error('转写期间题目或媒体发生变化，已停止填答，请从目录重新打开本项目。'),{code:'MEDIA_SNAPSHOT_CHANGED',snapshots:[snapshot,fresh]});
    };
    this.store.addLog(task,`检测到 ${requests.length} 段音视频，正在优先读取字幕，缺少字幕时使用本地语音识别。`);
    for(const record of requests){
      await checkpoint();
      const result=await measureStage(task,'speech',()=>this.media.resolve(record,{context:typeof page.context==='function'?page.context():this.context,referrer:record.referrer,signal,checkpoint,onProgress:message=>this.store.addLog(task,message)}));
      if(typeof result?.text!=='string'||!result.text.trim())throw new Error('音视频未获得有效原文，尚未填写本项目。');
      additions[record.key]=result.text;this.store.addLog(task,`${result.source}已就绪（${result.text.length} 字符），正在核对题目。`);
    }
    await checkpoint();
    const previous=this.mediaTranscripts.get(page);
    this.mediaTranscripts.set(page,{url,texts:{...(previous?.url===url?previous.texts:{}),...additions}});
    const ready=await this.waitQuestions(task,page,settings,signal,{timeout:15000,allowUnsupported:true});
    this.assertEntryPage(page,url,ready);return ready;
  }
  async prepareVideoFrames(task,page,snapshot,settings,signal){
    if(!snapshot.videoRequests?.length||snapshot.issues?.some(issue=>!snapshot.mediaIssues?.includes(issue)&&!snapshot.imageIssues?.includes(issue)))return snapshot;
    this.videoFrames ||= new VideoFrames(this.store.directory||'.runtime');
    const url=snapshot.pageURL||page.url(),requests=[...new Map(snapshot.videoRequests.map(record=>[record.frame.url()+record.selector,record])).values()];
    const count=Math.min(12,Math.floor((12-(snapshot.imageRecords?.length||0))/requests.length));if(count<2)throw new Error('当前页视觉材料过多，无法完整附带视频代表画面。');
    const identity=value=>UStudy.questionSignature(value.questions.map(q=>({...q,images:undefined,imageKeys:undefined}))),expected=identity(snapshot);
    const check=async()=>{await this.gate(task,signal);await this.dismissStudyNotice(task,page,signal);const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,url,fresh);if(!fresh||identity(fresh)!==expected)throw Object.assign(new Error('读取视频画面期间题目或视频已变化，已停止。'),{code:'MEDIA_SNAPSHOT_CHANGED'});};
    this.store.addLog(task,'本题需要观察视频中的眼神、表情或动作，正在本地抽取带时间戳的代表画面。');
    for(const [index,record] of requests.entries()){
      await check();const frames=await this.videoFrames.resolve(record,{context:typeof page.context==='function'?page.context():this.context,referrer:record.referrer,signal,checkpoint:check,count});await check();
      await record.frame.evaluate(mountVideoFramesFromDOM,{key:record.key,selector:record.selector,sources:record.sources,frames:frames.map(frame=>({...frame,label:`Video ${index+1} - ${frame.label}`}))});
    }
    await check();const ready=await this.waitQuestions(task,page,settings,signal,{timeout:15000,allowUnsupported:true});this.assertEntryPage(page,url,ready);
    if(ready.videoRequests?.length)throw new Error('视频画面未能完整关联到当前题目，尚未请求 AI。');
    this.store.addLog(task,`已抽取 ${count*requests.length} 张带时间戳的视频代表画面，接下来与对话转写一起交给识图模型。`);return ready;
  }
  async imageStep(task,page,snapshot,settings,signal,work,{interactive=true}={}){
    for(;;){
      try{return await work();}
      catch(error){
        this.pages.protect(page,'image-review');signal?.throwIfAborted();
        if(error.code!=='IMAGE_READ_UNAVAILABLE'||!interactive)throw error;
        task.status='review';this.store.changed();
        this.store.addLog(task,`${error.message} 已保留当前题页、草稿及本页已生成的答案；恢复后点击「继续核对」，仅重试图片读取和复核，不重复请求 AI。停止任务也会保留题页。`,'warning');
        await this.gate(task,signal);
        const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,snapshot.pageURL||page.url(),fresh);
        if(!fresh||fresh.signature!==snapshot.signature)throw new Error('等待期间题目或图片发生变化，已停止填写或提交，题页已保留。');
        this.store.addLog(task,'正在继续图片读取和复核，复用本页已生成的答案。');
      }
    }
  }
  async prepareImages(task,page,snapshot,settings,signal,{interactive=true}={}){
    if(!snapshot.imageRequests?.length||snapshot.issues?.some(issue=>!snapshot.imageIssues?.includes(issue)))return snapshot;
    const url=snapshot.pageURL||page.url(),additions={},records=[...new Map(snapshot.imageRequests.map(image=>[image.key,image])).values()];let total=0;
    const check=async()=>{await this.gate(task,signal);const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,url,fresh);if(!fresh||fresh.signature!==snapshot.signature)throw Object.assign(new Error('读取图片期间题目或图片发生变化，已停止。'),{code:'MEDIA_SNAPSHOT_CHANGED',snapshots:[snapshot,fresh]});};
    this.store.addLog(task,`检测到 ${records.length} 张题目图片，正在读取照片、图表及标题图。`);
    for(const record of records){await check();const image=await this.imageStep(task,page,snapshot,settings,signal,()=>this.imageReader.capture(record,{context:typeof page.context==='function'?page.context():this.context,signal}),{interactive});total+=image.dataURL.length*3/4;if(total>MAX_PAGE_IMAGE_BYTES)throw new Error('当前题组的图片总量超过 12 MB，请核对图片大小。');additions[record.key]=image;}
    await check();const previous=this.imageMaterials.get(page);this.imageMaterials.set(page,{url,images:{...(previous?.url===url?previous.images:{}),...additions}});
    const ready=await this.waitQuestions(task,page,settings,signal,{timeout:15000,allowUnsupported:true});this.assertEntryPage(page,url,ready);
    const modes=[['original','原图'],['canvas','画布'],['rendered','截图']].map(([mode,label])=>[label,Object.values(additions).filter(image=>image.verification.mode===mode).length]).filter(([,count])=>count).map(([label,count])=>`${label} ${count} 张`).join('、');
    this.store.addLog(task,`已读取 ${records.length} 张完整图片（${modes}），将与题目一起发送给识图模型。`);return ready;
  }
  async verifyImages(task,page,snapshot,signal,{settings,interactive=true}={}){
    if(!snapshot.imageRecords?.length)return;
    const saved=this.imageMaterials.get(page);if(saved?.url!==page.url())throw new Error('图片材料已切换，已停止。');
    for(const [index,record] of snapshot.imageRecords.entries()){
      await this.gate(task,signal);const image=saved.images[record.key];if(!image){this.pages.protect(page,'image-review');throw new Error('题目图片材料不完整，已停止，题页已保留。');}
      try{await this.imageStep(task,page,snapshot,settings,signal,()=>this.imageReader.verify(record,image,{context:typeof page.context==='function'?page.context():this.context,signal}),{interactive});}
      catch(error){
        if(error.code==='IMAGE_CHANGED'){
          error.imageChange={...error.imageChange,index:index+1,mode:image.verification?.mode||'unknown'};
          error.message+=`（第 ${index+1} 张；${{content:'图片内容不一致',display:'图片显示效果不一致',locator:'图片定位不唯一'}[error.imageChange.reason]||'图片复核不一致'}）`;
        }
        throw error;
      }
    }
  }
  async previewMedia({courseId,unitId,entryKey,solve=false,inspect=false},options={}){
    if(this.busy()||this.store.syncing||this.catalogLoading)throw Object.assign(new Error('请先停止当前任务，再检测媒体。'),{status:409});
    const course=this.store.data.courses.find(item=>item.id===courseId);if(!course)throw new Error('课程不存在，请先同步课程。');
    return this.operations.run('media-preview',async signal=>{
      const task={id:randomUUID(),courseId,unitId,entryKey,status:'running',logs:[],answered:0,pages:0};let page;
      try{
        const catalog=await this.courseDirectory(course,{signal});
        const directory=await this.prepareDirectory(catalog.page,unitId,{signal});
        const entry=requiredQueue(directory,unitId).find(item=>item.key===entryKey);
        if(!entry)throw new Error('所选项目不是该单元尚未完成的必修项目，请重新核对目录。');
        page=await this.openRequiredEntry(task,catalog,directory,entry,signal);
        if(!page)throw new Error('该项目已完成，无需重新读取媒体。');
        const settings={...this.store.data.settings};
        if(inspect){
          this.pages.protect(page,'oral-inspection');const handler=await currentOralHandler();let frames,oral;
          for(let attempt=0;attempt<35;attempt++){
            await this.gate(task,signal);if(!isPlatform(page.url()))throw new Error('检测页面已离开 U校园，尚未读取。');
            frames=[];for(const frame of await this.activeFrames(page)){const report=await frame.evaluate(handler.inspectOralLessonFromDOM).catch(error=>{if(/context.*destroyed|detached|navigation/i.test(error.message))return null;throw error;});if(report)frames.push({hostname:new URL(frame.url()).hostname,...report});}
            oral=await this.readOralActivity(page);if(oral||frames.some(frame=>frame.dialogs.some(dialog=>dialog.visible)))break;await sleep(300,undefined,{signal});
          }
          let metadata;if(oral){const {frame,pageURL,frameURL,navigation,key,audio,...rest}=oral;metadata={...rest,audio:(audio||[]).map(({duration,readyState,paused})=>({duration,readyState,paused}))};}
          if(oral?.ready&&!oral.recording&&!oral.saved)this.pages.unprotect(page,'oral-inspection');
          return {ready:true,kind:'lesson-inspection',recordingRequested:false,written:false,submitted:false,frames,oral:metadata};
        }
        let snapshot=await this.waitQuestions(task,page,settings,signal,{allowUnsupported:true,allowSummary:true});
        if(!snapshot)throw new Error('本页没有支持识别的题目。');
        if(snapshot.summaryFeedback){
          const {frame,pageURL,frameURL,navigationKey,...feedback}=snapshot.summaryFeedback;
          const action=frame?await frame.evaluate((await currentCompletionReaders()).action,{kind:'finish',includeDiagnostics:true}):null;
          let sameEntry=false;try{sameEntry=UStudy.normalize(JSON.parse(navigationKey)[2])===UStudy.normalize(entryTitle(task));}catch{}
          return {ready:true,kind:'submission-summary',written:false,submitted:false,continued:false,media:[],questions:[],feedback,completionReady:submittedSummary(feedback),continueReady:!!(submittedSummary(feedback)&&sameEntry&&action?.selector),logs:task.logs.map(log=>log.message)};
        }
        if(snapshot.oralActivity){
          if(solve)throw new Error('口语检测只读取题目和原文；生成录音请启动对应答题任务。');
          const handler=await currentOralHandler(),source=await handler.loadOralStory(this,task,page,snapshot.oralActivity,signal);
          const {frame,pageURL,frameURL,navigation,key,audio,...oral}=snapshot.oralActivity;
          return {ready:true,kind:'oral',written:false,submitted:false,recorded:false,media:[],questions:[],oral:{...oral,recordingKey:handler.oralRecordingIdentity(snapshot.oralActivity),context:source.context,sourceTitle:source.sourceTitle,audio:(audio||[]).map(({duration,readyState,paused})=>({duration,readyState,paused}))},logs:task.logs.map(log=>log.message)};
        }
        if(snapshot.discussion){
          const board=snapshot.discussion;
          return {ready:board.ready,kind:'discussion-board',written:false,submitted:false,published:false,questions:[],discussion:{prompt:board.prompt||'',draftPresent:!!board.value?.trim(),issue:board.issue||'',plannedText:'1'}};
        }
        if(snapshot.roleplay){const play=snapshot.roleplay;return {ready:!play.issue,kind:'roleplay',written:false,submitted:false,recorded:false,questions:[],roleplay:{phase:play.phase,role:play.role,roleName:play.roleName,total:play.total,completed:play.completed,issue:play.issue||''}};}
        if(snapshot.vocabulary){
          const card=snapshot.vocabulary;this.assertVocabularyEntry(task,page,card);if(!card.ready)throw new Error(card.issue||'词卡仍在加载。');
          return {ready:true,kind:'vocabulary',written:false,submitted:false,media:[],questions:[],vocabulary:{title:entryTitle(task),current:card.current,total:card.total,completed:card.completed},logs:task.logs.map(log=>log.message)};
        }
        if(snapshot.videoView){
          const video=snapshot.videoView;this.assertVideoViewEntry(task,page,video);
          if(!video.ready)throw Object.assign(new Error(video.issue||'纯视频页尚未就绪。'),{mediaChange:{videoView:{issue:video.issue,controls:video.controlHints}}});
          return {ready:true,kind:'video-view',written:false,submitted:false,media:[],questions:[],videoView:{duration:video.duration,currentTime:video.currentTime,paused:video.paused,ended:video.ended,controlsReady:video.controlsReady},logs:task.logs.map(log=>log.message)};
        }
        if(snapshot.audioView){
          const audio=snapshot.audioView;this.assertAudioViewEntry(task,page,audio);
          if(!audio.ready)throw Object.assign(new Error(audio.issue||'纯音频页尚未就绪。'),{mediaChange:{audioView:{issue:audio.issue,controls:audio.controlHints}}});
          return {ready:true,kind:'audio-view',written:false,submitted:false,media:[],questions:[],audioView:{duration:audio.duration,currentTime:audio.currentTime,paused:audio.paused,ended:audio.ended,controlsReady:audio.controlsReady,controls:audio.controlHints},logs:task.logs.map(log=>log.message)};
        }
        const media=(snapshot.mediaRequests||[]).map(item=>({kind:item.kind,sourceCount:item.sources.length,subtitleCount:item.tracks.length,duration:item.duration,protocols:[...new Set(item.sources.map(value=>{try{return new URL(value).protocol;}catch{return 'unknown';}}))]}));
        if(snapshot.mediaRequests?.length)snapshot=await this.prepareMedia(task,page,snapshot,settings,signal);
        if(snapshot.videoRequests?.length)snapshot=await this.prepareVideoFrames(task,page,snapshot,settings,signal);
        if(snapshot.imageRequests?.length)snapshot=await this.prepareImages(task,page,snapshot,settings,signal,{interactive:false});
        if(snapshot.issues?.length)throw new Error(snapshot.issues.join(' '));
        const answers=[];
        if(solve){
          if(!settings.aiEnabled||!this.store.apiKey)throw new Error('媒体已读取，生成答案预览还需启用并配置 AI。');
          if(snapshot.questions.length>15)throw new Error('单次答案预览最多 15 道题，请缩小检测范围。');
          const verifySnapshot=async()=>{
            await this.gate(task,signal);const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,snapshot.pageURL,snapshot);
            if(!fresh||fresh.signature!==snapshot.signature)throw Object.assign(new Error('预览期间题目发生变化，已停止。'),{code:'MEDIA_SNAPSHOT_CHANGED',snapshots:[snapshot,fresh]});
          };
          for(const question of snapshot.questions){
            await verifySnapshot();
            answers.push(await this.askModel(question,settings,this.store.apiKey,signal));
            await verifySnapshot();
          }
        }
        await this.verifyImages(task,page,snapshot,signal,{settings,interactive:false});
        return {ready:true,written:false,submitted:false,media,questions:snapshot.questions.map((question,i)=>({question:question.question,type:question.type,options:question.options,context:question.context,...(question.directions?{directions:question.directions}:{}),...(question.type==='text'?{blankCount:question.targets.length,wordBank:question.wordBank||[],blankOptions:question.blankOptions||question.targets.map(target=>target.choices?.map(choice=>choice.text)||[])}:{}),...(question.type==='matching'?{prompts:question.prompts,promptEmphasis:question.promptEmphasis}:{}),...(answers[i]?{answers:answers[i].answers}:{})})),logs:task.logs.map(log=>log.message)};
      }catch(error){
        if(page&&/提示尚未关闭|加载|登录校验/.test(error.message))this.pages.protect(page,'preview-review');
        if(page&&['IMAGE_CHANGED','IMAGE_READ_UNAVAILABLE','MEDIA_SNAPSHOT_CHANGED'].includes(error.code))this.pages.protect(page,'image-review');
        if(error.code==='IMAGE_CHANGED')error.mediaChange={imageVerification:error.imageChange};
        if(error.code==='MEDIA_SNAPSHOT_CHANGED'){
          const [before,after]=error.snapshots;
          const frameIdentity=value=>(value?.frames||[]).map(frame=>[frame.url,frame.count]);
          error.mediaChange={
            beforeCount:before?.questions.length||0,afterCount:after?.questions.length||0,
            navigationChanged:before?.navigation?.key!==after?.navigation?.key,
            framesChanged:JSON.stringify(frameIdentity(before))!==JSON.stringify(frameIdentity(after)),
            issuesChanged:JSON.stringify(before?.issues)!==JSON.stringify(after?.issues),
            imageCountBefore:before?.imageRecords?.length||0,imageCountAfter:after?.imageRecords?.length||0,
            questions:before.questions.map((question,index)=>{
              const next=after?.questions[index];
              const fields=['question','options','type','context','targets','id','wordBank','blankOptions','mediaKeys','imageKeys','images'].filter(key=>JSON.stringify(question[key])!==JSON.stringify(next?.[key]));
              return fields.length?{index:index+1,fields}:null;
            }).filter(Boolean)
          };
        }
        throw error;
      }finally{
        this.taskPages.delete(task.id);if(page)await this.pages.release(page);
      }
    },{timeoutMs:600000,...options});
  }
  async action(frame,kind,selector='',options={}){
    const readers=await currentCompletionReaders();
    return (await currentLessonActions()).performLessonAction(this,frame,kind,selector,{...options,readAction:kind==='notice'?readers.notice:readers.action});
  }
  async readExerciseFeedback(page){
    if(page.isClosed())throw new Error('课程窗口已关闭。');
    const reader=(await currentCompletionReaders()).feedback;
    for(const frame of await this.activeFrames(page)){
      const feedback=await frame.evaluate(reader).catch(()=>null);
      if(feedback?.summary){const navigation=await frame.evaluate(readExerciseNavigationFromDOM).catch(()=>null);return {...feedback,frame,pageURL:page.url(),frameURL:frame.url(),navigationKey:navigation?.key||''};}
    }
    return {summary:false,failed:false};
  }
  async waitSubmissionFeedback(task,page,signal,{timeout=6000,settleMs=1000,pollMs=250}={}){
    const deadline=Date.now()+timeout;let observed=null,stable='',since=0;
    do{
      await this.gate(task,signal);
      const feedback=await this.readExerciseFeedback(page);
      if(feedback.summary){
        observed=feedback;
        const objectiveCount=(feedback.correct||0)+(feedback.incorrect||0)+(feedback.partial||0);
        const ready=feedback.total>0&&Number.isInteger(feedback.objective)&&Number.isInteger(feedback.subjective)&&feedback.objective+feedback.subjective===feedback.total&&(feedback.objective===0||Number.isInteger(feedback.correct)&&Number.isInteger(feedback.incorrect)&&(objectiveCount===feedback.objective||feedback.unanswered>0&&objectiveCount+feedback.unanswered>=feedback.objective));
        const key=submissionGradeKey(feedback),now=Date.now();
        if(!ready){stable='';since=0;}else if(key!==stable){stable=key;since=now;}
        if(ready&&now-since>=settleMs)return {...feedback,gradingStable:true};
      }else{stable='';since=0;}
      const remaining=deadline-Date.now();if(remaining<=0)break;
      await sleep(Math.min(pollMs,remaining),undefined,{signal});
    }while(Date.now()<deadline);
    return observed?{...observed,gradingStable:false}:{summary:false,failed:false};
  }
  async readLearningState(page){
    if(page.isClosed?.())throw new Error('课程窗口已关闭。');
    const state={loading:false,directory:false,networkIssue:false,login:false,studyNotice:false,contentReady:false};
    for(const frame of await this.activeFrames(page)){
      const readers=await currentCompletionReaders(),notice=await frame.evaluate(readers.notice).catch(()=>null);
      const current=await frame.evaluate(readers.state,notice?{notice:notice.present===true}:{}).catch(()=>null);
      if(current)for(const key of Object.keys(state))state[key] ||= current[key]===true;
    }
    return state;
  }
  async studyNoticeReports(page){
    const reports=[];for(const [index,frame] of (await this.activeFrames(page)).entries()){
      const report=await frame.evaluate((await currentCompletionReaders()).notice,{includeDiagnostics:true});reports.push({frame,index,...report});
    }return reports;
  }
  async inspectCurrentLesson({taskId}){
    if(this.busy()||this.store.syncing||this.catalogLoading||this.store.operation)throw Object.assign(new Error('请先停止当前任务和目录读取，再只读检测题页。'),{status:409});
    const task=this.store.data.tasks.find(task=>task.id===taskId);if(!task)throw new Error('未找到对应任务。');
    if(!this.context)return {ready:false,reason:'专用窗口尚未打开',written:false,submitted:false};
    const pages=[...this.pages.records].filter(([page,record])=>(record.taskId===taskId||record.role==='catalog'&&record.courseId===task.courseId)&&!page.isClosed()&&isPlatform(page.url()));
    const result=[];for(const [page,record] of pages){
      const frames=[];for(const {frame,...report} of await this.studyNoticeReports(page))frames.push({hostname:new URL(frame.url()).hostname,...report});
      result.push({kind:record.role==='catalog'?'catalog':'lesson',frames});
    }
    return {ready:result.length>0,...(!result.length?{reason:'该任务的题页已关闭或不再属于当前专用会话'}:{}),written:false,submitted:false,pages:result};
  }
  async dismissStudyNotice(task,page,signal,{timeout=12000,maxClicks=8}={}){
    if(typeof page?.frames!=='function')return false;
    await this.gate(task,signal);const beforeURL=page.url?.();
    if(!(await this.readLearningState(page)).studyNotice)return false;
    const previousProtection=this.pages.records.get(page)?.protected;if(!previousProtection)this.pages.protect(page,'study-notice');
    const deadline=Date.now()+timeout;let clicks=0,quiet=0,lastClick=0;
    do{
      await this.gate(task,signal);if(beforeURL&&page.url()!==beforeURL)throw new Error('确认学习时间提示期间题页已变化，已停止。');
      if(!(await this.readLearningState(page)).studyNotice){
        if(++quiet>=3){if(!previousProtection)this.pages.unprotect(page,'study-notice');this.store.addLog(task,`已自动确认并关闭本单元学习时间提示，继续核对题目。${clicks>1?`（共处理 ${clicks} 次提示）`:''}`);return true;}
      }else{
        quiet=0;
        // A second portal can appear while the first one closes, including in
        // another visible frame. Re-select the top prompt on each iteration.
        if(clicks<maxClicks&&Date.now()-lastClick>=600){
          for(const frame of await this.activeFrames(page))if(await this.action(frame,'notice','',{signal,checkpoint:()=>this.gate(task,signal)})){clicks++;lastClick=Date.now();break;}
        }
      }
      await sleep(100,undefined,{signal});
    }while(Date.now()<deadline);
    const reports=await this.studyNoticeReports(page),active=reports.filter(report=>report.present),count=active.reduce((sum,r)=>sum+r.count,0),front=active.reduce((sum,r)=>sum+r.frontButtons,0);
    const detail=count?`仍有 ${count} 个可见学习提示，${front} 个确认按钮位于前层；已处理 ${clicks} 次`:'提示状态在复查期间持续变化';
    throw Object.assign(new Error(`学习时间提示关闭未稳定：${detail}。已保留题页，请核对后继续。`),{code:'LESSON_ACTION_BLOCKED',noticeDiagnostics:reports.map(({frame,...report})=>report)});
  }
  async withStudyNoticeRecovery(task,page,signal,perform,{noticeOnly=false}={}){
    signal?.throwIfAborted();const url=page.url?.();
    try{return await perform(false);}
    catch(error){
      signal?.throwIfAborted();if(error.code!=='LESSON_ACTION_BLOCKED'||url&&page.url?.()!==url)throw error;
      await this.gate(task,signal);
      const dismissed=await this.dismissStudyNotice(task,page,signal);
      signal?.throwIfAborted();if(url&&page.url?.()!==url)throw error;
      if(noticeOnly)return dismissed;
      this.store.addLog(task,dismissed?'操作受阻后已自动关闭学习提示，正在重试当前操作。':'操作受阻后已重新检查学习提示，正在重试当前操作。');
      return perform(true);
    }
  }
  async prepareLessonEntry(task,page,signal,{settleMs=500,pollMs=100}={}){
    let elapsed=0,dismissed=false;
    do{
      await this.gate(task,signal);const started=Date.now();
      dismissed=await this.withStudyNoticeRecovery(task,page,signal,()=>this.dismissStudyNotice(task,page,signal),{noticeOnly:true})||dismissed;
      if(typeof page?.frames!=='function')return dismissed;
      elapsed+=Date.now()-started;if(elapsed>=settleMs)return dismissed;
      const delay=Math.min(pollMs,settleMs-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;
    }while(elapsed<settleMs);
    return dismissed;
  }
  async withAIStudyNoticeWatch(page,signal,request,check,{pollMs=500}={}){
    if(typeof page?.frames!=='function')return request(signal);
    const requestAbort=new AbortController(),stopWatch=new AbortController();
    const requestSignal=signal?AbortSignal.any([signal,requestAbort.signal]):requestAbort.signal,watchSignal=signal?AbortSignal.any([signal,stopWatch.signal]):stopWatch.signal;
    let fail;const failed=new Promise((_,reject)=>{fail=reject;});
    const watcher=(async()=>{
      try{for(;;){await sleep(pollMs,undefined,{signal:watchSignal});await check(watchSignal,{readContent:false});}}
      catch(error){if(!stopWatch.signal.aborted){const reason=signal?.aborted?signal.reason:error;requestAbort.abort(reason);fail(reason);}}
    })();
    try{return await Promise.race([Promise.resolve().then(()=>request(requestSignal)),failed]);}
    finally{stopWatch.abort();await watcher;}
  }
  async readDiscussionBoard(page){return (await currentDiscussionHandler()).readDiscussionBoard(this,page);}
  async readRoleplay(page){return (await currentRoleplayHandler()).readRoleplay(this,page);}
  async waitQuestions(task,page,settings,signal,{previous='',timeout=30000,allowUnsupported=false,allowSummary=false}={}){
    let elapsed=0,lastState={},lastNotice='',stable='',lastSnapshot=null,lastVocabulary=null,lastDiscussion=null,lastRoleplay=null;
    while(elapsed<timeout){
      await this.gate(task,signal);const iterationStarted=Date.now();page=this.taskPages.get(task.id)||page;
      lastState=await this.readLearningState(page);
      if(lastState.login)throw new Error('U校园或教材内容页的登录校验失败，请在登录窗口重新进入课程后启动任务。');
      if(lastState.studyNotice){
        await this.withStudyNoticeRecovery(task,page,signal,()=>this.dismissStudyNotice(task,page,signal),{noticeOnly:true});lastState=await this.readLearningState(page);
      }
      const blocked=lastState.loading||lastState.studyNotice;
      if(!blocked&&allowSummary&&!previous){const feedback=await this.readExerciseFeedback(page);if(feedback.summary)return {summaryFeedback:feedback};}
      const roleplay=!blocked&&allowUnsupported&&!previous&&isRoleplayEntry(task)?await this.readRoleplay(page):null;
      if(roleplay){
        lastRoleplay={roleplay};if(roleplay.issue)return lastRoleplay;
        const key=JSON.stringify([roleplay.binding,roleplay.phase,roleplay.roleName,roleplay.dialogueKey]);
        if(roleplay.phase!=='loading'&&stable===key)return lastRoleplay;stable=roleplay.phase==='loading'?'':key;
        const delay=Math.min(650,Math.max(0,timeout-elapsed));await sleep(delay,undefined,{signal});elapsed+=Date.now()-iterationStarted;continue;
      }
      const snapshot=blocked?null:await this.readQuestions(page,settings);
      lastSnapshot=snapshot;
      const discussion=!blocked&&allowUnsupported&&!previous?await this.readDiscussionBoard(page):null;
      if(discussion){
        if(snapshot?.questions?.length||snapshot?.hasAnswerControls)return {discussion:{...discussion,ready:false,issue:'讨论板同时包含练习作答控件，尚未发布。'}};
        lastDiscussion={discussion};
        if(!discussion.ready&&!discussion.loading)return lastDiscussion;
        const key='discussion:'+discussion.binding+discussion.key;
        if(discussion.ready&&stable===key)return lastDiscussion;stable=discussion.ready?key:'';
        const delay=Math.min(650,Math.max(0,timeout-elapsed));await sleep(delay,undefined,{signal});elapsed+=Date.now()-iterationStarted;continue;
      }
      const oral=!blocked&&allowUnsupported&&!previous&&!snapshot?.questions?.length&&!snapshot?.hasAnswerControls?await this.readOralActivity(page):null;
      let vocabulary=!blocked&&allowUnsupported&&!previous&&isVocabularyEntry(task)?await this.readVocabulary(page):null;
      if(vocabulary&&(snapshot?.hasAnswerControls||snapshot?.questions?.length))vocabulary={...vocabulary,ready:false,requiresReview:true,issue:'词卡页同时有可作答题目，尚未自动翻动，请先核对。'};
      if(oral){
        const key='oral:'+oral.key;if(stable===key)return {oralActivity:oral,signature:oral.key,navigation:oral.navigation,pageURL:oral.pageURL,frame:oral.frame};stable=key;
      }else if(vocabulary){
        lastVocabulary={vocabulary};const key='vocabulary:'+vocabulary.binding+vocabulary.key;
        if(vocabulary.requiresReview)return lastVocabulary;
        if(vocabulary.ready){if(stable===key)return lastVocabulary;stable=key;}else stable='';
      }else if(snapshot&&snapshot.signature!==previous&&!snapshot.issues?.some(issue=>!snapshot.mediaIssues?.includes(issue)&&!snapshot.imageIssues?.includes(issue))){
        if(stable===snapshot.signature)return snapshot;
        stable=snapshot.signature;
      }else stable='';
      const notice=lastState.loading?(lastState.networkIssue?'U校园提示网络异常，课程仍在加载，请检查登录窗口。':'U校园课程正在加载，等待必修练习就绪。'):lastState.studyNotice?'正在确认单元学习时间提示，等待练习就绪。':'';
      if(notice&&notice!==lastNotice){this.store.addLog(task,notice);lastNotice=notice;}
      // A directory is never an invitation to click a generic learning shortcut.
      if(!blocked&&lastState.directory)throw new Error('当前仍是课程目录，所选必修项目未打开。请重新读取目录后重试。');
      if(!blocked&&lastState.networkIssue)throw new Error('U校园提示网络异常，必修练习未载入。');
      elapsed+=Date.now()-iterationStarted;if(elapsed<timeout){const delay=Math.min(650,timeout-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;}
    }
    if(lastState.loading)throw new Error(lastState.networkIssue?'U校园提示网络异常，课程目录 / 练习一直未载入。请检查网络，刷新并确认目录出现后再启动任务。':'U校园页面一直停在「加载中」，尚未进入可答题状态。请刷新并确认目录或练习载入后重试。');
    if(lastState.studyNotice)throw new Error('单元学习时间提示尚未关闭，请在 U校园窗口点击「我知道了」后重试。');
    if(!previous&&lastState.directory)throw new Error('当前仍是课程目录，所选必修项目未打开。');
    if(lastVocabulary)return lastVocabulary;
    if(lastDiscussion)return lastDiscussion;
    if(lastRoleplay)return lastRoleplay;
    if(allowUnsupported&&!previous&&(!lastSnapshot||lastSnapshot.manualOnly)){
      if(isVideoViewEntry(task)){const videoView=await this.readVideoView(page,task,settings);if(videoView?.navigation?.known)return {videoView};}
      if(isAudioViewEntry(task)){const audioView=await this.readAudioView(page,task,settings);if(audioView?.navigation?.known)return {audioView};}
    }
    if(lastSnapshot?.issues?.length)return lastSnapshot;
    // Directions/material can render before editable questions. Give those
    // questions the whole load window before declaring a leaf unsupported.
    if(allowUnsupported&&!previous&&lastState.contentReady&&!lastState.networkIssue)return null;
    throw new Error(previous?'题目没有切换，已停止重复填答。请先在 U校园提交并进入下一页。':'未识别到可填答题目。请打开练习，或在页面适配设置中填写题目容器选择器。');
  }
  async askModel(...args){return askModel(...args);}
  async fillQuestion(...args){return fillQuestion(...args);}
  async verifyQuestion(...args){return verifyQuestion(...args);}
  async beginExerciseLearning(task,page,settings){
    await this.disposeExerciseLearning(task.id);
    if(typeof this.store.learnVerifiedExercise==='function'&&typeof page.exposeBinding==='function')this.learningSessions.set(task.id,new ExerciseLearningSession({page,task,settings}));
  }
  async disposeExerciseLearning(taskId){const session=this.learningSessions.get(taskId);this.learningSessions.delete(taskId);await session?.dispose();}
  async openRequiredEntry(task,catalog,directory,entry,signal){
    await this.gate(task,signal);
    await this.dismissStudyNotice(task,catalog.page,signal);
    const fresh=await this.prepareDirectory(catalog.page,task.unitId,{signal});
    const target=requiredQueue(fresh,task.unitId).find(item=>item.key===entry.key);
    if(!target){
      if(fresh.entries.some(item=>item.key===entry.key&&item.required&&item.completed))return null;
      throw new Error('所选必修项目的目录状态已变化，请重新读取目录。');
    }
    const source=catalog.page,beforeURL=source.url();let popup=null;
    const onPopup=page=>{popup=page;this.pages.track(page,'lesson',{taskId:task.id});};source.on('popup',onPopup);
    let page;
    // Navigation has its own bounded wait below. The pointer action's shorter
    // timeout must not turn an already delivered click into a failed task.
    try{await this.gate(task,signal);await fresh.frame.locator(target.selector).click({noWaitAfter:true});page=await this.waitCourseNavigation(source,()=>popup,beforeURL,{signal});}
    catch(error){
      const pending=popup||(source.url()!==beforeURL?source:null);
      if(pending){this.pages.track(pending,'lesson',{taskId:task.id});this.taskPages.set(task.id,pending);}
      throw error;
    }
    finally{source.off('popup',onPopup);}
    this.taskPages.set(task.id,page);this.pages.track(page,'lesson',{taskId:task.id});
    const unitToken=task.unitId.replace(/^id-/,'').replace(/-tab$/,'');
    const routeUnit=page.url().match(/\/courseware\/([^/?#]+)/)?.[1];
    if(routeUnit&&routeUnit!==unitToken)throw new Error('必修入口跳转到了其他单元，已停止。');
    // Keep the learning page and its draft intact while checking the directory.
    if(page===catalog.page){
      const context=await this.ensureBrowser();catalog.page=await this.backgroundPage(context);await this.pages.replaceCatalog(catalog.page,{courseId:task.courseId});await this.navigate(catalog.page,catalog.url,{signal});
      if(task.courseId)this.openedCourses.set(task.courseId,{page:catalog.page,url:catalog.url});
    }
    this.pruneCourseRecords();
    return page;
  }
  assertEntryPage(page,url,snapshot){
    if(page.url()!==url||snapshot?.pageURL&&snapshot.pageURL!==url||snapshot?.frameURL&&snapshot.frame.url()!==snapshot.frameURL||snapshot?.frames?.some(item=>item.frame.isDetached?.()||item.frame.url()!==item.url))throw new Error('目录项目已切换，已停止填答，请重新启动任务。');
  }
  async answerEntry(task,page,settings,signal){
    const submittedAnswers=new Set(),visited=new Set(),history=[];let initialSnapshot,correction,entryURL,attempt=0,pages=0,oralDone=false;
    for(;;){
      const result=await this.answerEntryAttempt(task,page,settings,signal,{initialSnapshot,correction,submittedAnswers});
      oralDone ||= result.oralDone===true;if(oralDone)result.oralDone=true;
      const graded=captureCorrectionAttempt(result.snapshot,result.submitted,result.feedback);
      if(graded){history.push(graded);if(history.length>3)history.shift();}
      this.learningSessions.get(task.id)?.observeFeedback(result.feedback);
      if(result.nextPage){
        visited.add(result.signature);pages++;
        if(pages>=MAX_EXERCISE_PAGES)return {...result,review:true,message:`本项目已达到 ${MAX_EXERCISE_PAGES} 页处理上限，后续页面尚未确认填答，请核对。`};
        if(!canContinueExercise(result.snapshot,result.snapshot,task))return {...result,message:'已保存上一页并翻页，当前显示的后续题目尚未填写；无法确认其属于同一目录项目，请从目录核对原项目。'};
        let next;
        try{next=await this.waitNextExercisePage(task,page,settings,result.snapshot,signal);}
        catch(error){signal.throwIfAborted();return {...result,review:true,message:error.message};}
        if(next.boundary)return {...result,message:'已保存上一页；后续页面不属于已确认的同一目录项目，尚未填写。请从目录核对原项目完成状态。'};
        if(next.feedback){Object.assign(result,{nextPage:false,feedback:next.feedback});this.learningSessions.get(task.id)?.observeFeedback(next.feedback);}
        else{
          if(visited.has(next.snapshot.signature))return {...result,review:true,message:'下一题重复返回已经处理的页面，已停止重复填写；本项目仍需核对。'};
          initialSnapshot=next.snapshot;
          this.store.addLog(task,`已确认仍在同一目录项目，继续填写第 ${pages+1} 页。`);
          continue;
        }
      }
      if(result.manual&&pages>0)return {...result,rememberable:false};
      if(!result.feedback?.failed)return result;
      if(result.feedback.gradingStable===false)return {...result,review:true,message:'答题小结的评分统计仍在更新，尚未返回修改或推断单空对错；已保留结果页，请稍后继续核对。'};
      entryURL ||= result.entryURL;
      const failure=describeExerciseFailure(result.feedback);
      this.store.addLog(task,failure);
      const review=message=>({...result,review:true,message});
      if(attempt===MAX_CORRECTION_RETRIES)return review(`${failure}已达到本项目 ${MAX_CORRECTION_RETRIES} 次自动修改上限，请检查客观题并提交后点击「继续核对」。`);
      await this.gate(task,signal);
      const feedback=await this.readExerciseFeedback(page);
      if(!feedback.failed||feedback.pageURL!==result.feedback.pageURL||feedback.frameURL!==result.feedback.frameURL||result.feedback.navigationKey&&feedback.navigationKey!==result.feedback.navigationKey)return review('答题小结已变化，请核对当前页面后点击「继续核对」。');
      if(result.feedback.gradingStable&&submissionGradeKey(feedback)!==submissionGradeKey(result.feedback))return review('答题小结的评分统计再次变化，尚未返回修改，请待评分稳定后核对。');
      this.assertEntryPage(page,feedback.pageURL,feedback);
      await this.learningSessions.get(task.id)?.reset();
      if(!await this.action(feedback.frame,'revise','',{signal,checkpoint:()=>this.gate(task,signal)}))return review(`${failure}未找到「返回修改」，请在 U校园修改客观题并提交后点击「继续核对」。`);
      this.store.addLog(task,`已返回修改，正在核实题目（自动重试 ${attempt+1}/${MAX_CORRECTION_RETRIES}）。`);
      initialSnapshot=await this.waitQuestions(task,page,settings,signal,{allowUnsupported:true});
      if(!initialSnapshot?.questions?.length)return review(`${failure}返回修改后没有识别到支持填写的题目，请手动检查客观题。`);
      if(page.url()!==entryURL||initialSnapshot.pageURL&&initialSnapshot.pageURL!==entryURL)return review(`${failure}返回修改后进入了另一题页，需要从目录重新确认该必修项目；已保留修改页。`);
      if(feedback.navigationKey&&(!initialSnapshot.navigation?.known||initialSnapshot.navigation.key!==feedback.navigationKey))return review(`${failure}返回修改后的活动题目与小结不一致，已保留页面，请从目录重新确认该必修项目。`);
      const objectiveCount=initialSnapshot.questions.filter(question=>question.options?.length).length;
      const coverage=correctionCoverage(initialSnapshot.questions,result.feedback);
      if(result.feedback.objective>0&&result.feedback.correct!==result.feedback.objective&&objectiveCount===0){
        if(!coverage.complete)return review(`${failure}返回修改后识别到 ${coverage.groups} 组题、${coverage.parts} 个作答项，尚不能对应小结中的全部题目。请检查本板块其他练习或题型，修改并提交后点击「继续核对」。`);
        this.store.addLog(task,`已核对本页 ${coverage.groups} 组题、${coverage.parts} 个作答项，与小结 ${coverage.total} 道题对应，正在重新核实答案。`);
      }
      const evidence=analyzeCorrectionHistory(initialSnapshot,history);
      if(evidence.contradictory)return review(`${failure}同一答案的评分记录存在冲突，尚未继续修改，请待平台评分稳定后核对。`);
      if(evidence.verifiedParts)this.store.addLog(task,`已结合 ${evidence.history.length} 轮实际提交和评分，保留 ${evidence.verifiedParts} 个已确认正确的作答项，继续核实其余答案。`);
      correction={feedback:failure,previous:result.answers,signature:result.signature,history};
      attempt++;visited.clear();
    }
  }
  async answerEntryAttempt(task,page,settings,signal,{initialSnapshot,correction,submittedAnswers=new Set()}={}){
    await this.prepareLessonEntry(task,page,signal);
    let snapshot=initialSnapshot;
    try{if(!snapshot)snapshot=await this.waitQuestions(task,page,settings,signal,{allowUnsupported:true,allowSummary:true});}
    catch(error){
      signal.throwIfAborted();
      if(!/网络异常|页面一直停在「加载中」/.test(error.message)||!isPlatform(page.url()))throw error;
      this.store.addLog(task,'本项目尚未填答，遇到加载异常；正在刷新同一必修页重试一次。');
      await page.reload({waitUntil:'domcontentloaded'});
      snapshot=await this.waitQuestions(task,page,settings,signal,{allowUnsupported:true,allowSummary:true});
    }
    if(snapshot?.summaryFeedback){
      const feedback=snapshot.summaryFeedback.failed?await this.waitSubmissionFeedback(task,page,signal):snapshot.summaryFeedback;let title;try{title=JSON.parse(feedback.navigationKey)[2];}catch{}
      this.assertEntryPage(page,feedback.pageURL,feedback);
      if(!title||!entryTitle(task)||UStudy.normalize(title)!==UStudy.normalize(entryTitle(task)))return {review:true,message:'已打开的答题小结与当前目录项目无法对应，尚未重复填答或提交，请核对题页。'};
      this.store.addLog(task,'当前项目已显示答题小结，正在复核已提交结果，不重复生成、填写或提交答案。');
      return {feedback,entryURL:feedback.pageURL};
    }
    if(snapshot?.oralActivity)return this.completeOralActivity(task,page,snapshot.oralActivity,settings,signal);
    if(snapshot?.roleplay){this.oralSpeech ||= new OralSpeech(this.store.directory||'.runtime');return (await currentRoleplayHandler()).completeRoleplay(this,task,page,snapshot.roleplay,settings,signal);}
    if(snapshot?.discussion)return (await currentDiscussionHandler()).completeDiscussionBoard(this,task,page,snapshot.discussion,settings,signal);
    if(snapshot?.vocabulary)return this.completeVocabulary(task,page,snapshot.vocabulary,signal);
    if(snapshot?.videoView)return this.completeVideoView(task,page,snapshot.videoView,settings,signal);
    if(snapshot?.audioView)return this.completeAudioView(task,page,snapshot.audioView,settings,signal);
    if(!snapshot||snapshot.manualOnly){
      const manualURL=snapshot?.pageURL||page.url(),routeUnit=manualURL.match(/\/courseware\/([^/?#]+)/)?.[1];
      if(task.unitId&&routeUnit&&routeUnit!==task.unitId.replace(/^id-/,'').replace(/-tab$/,''))throw new Error('内容载入后进入了其他单元，已停止标记。');
      this.assertEntryPage(page,manualURL,snapshot);
      if(snapshot?.navigation?.known&&entryTitle(task)&&UStudy.normalize(snapshot.navigation.title)!==UStudy.normalize(entryTitle(task)))return {review:true,message:'当前内容标签与目录项目不一致，尚未标记，请从目录重新打开所选项目。'};
      const progress=snapshot?.navigation?.progress;
      return {manual:true,reason:snapshot?'oral-only':'no-fillable-questions',...(Number.isFinite(progress)&&progress>0&&progress<100?{rememberable:false}:{})};
    }
    if(snapshot.mediaRequests?.length){
      try{snapshot=await this.prepareMedia(task,page,snapshot,settings,signal);}
      catch(error){signal.throwIfAborted();return {review:true,message:`音视频原文准备未完成：${error.message} 本项目尚未自动填写或提交；处理后请停止并重新启动本单元任务，或手动提交后继续核对。`};}
    }
    if(snapshot.videoRequests?.length){
      try{snapshot=await this.prepareVideoFrames(task,page,snapshot,settings,signal);}
      catch(error){this.pages.protect(page,'video-frame-review');signal.throwIfAborted();return {review:true,message:`视频画面准备未完成：${error.message} 本轮尚未填写或提交，已保留题页。`};}
    }
    if(snapshot.imageRequests?.length){
      try{snapshot=await this.prepareImages(task,page,snapshot,settings,signal);}
      catch(error){this.pages.protect(page,'image-review');signal.throwIfAborted();return {review:true,message:`图片材料准备未完成：${error.message} 本轮尚未填写或提交当前页，题页已保留，请核对图片显示或识图模型配置。`};}
    }
    if(snapshot.issues?.length)return {review:true,message:`题目识别不完整：${snapshot.issues.join(' ')} 本项目尚未自动填写或提交，请在 U校园核对后手动处理。`};
    // Pin the loaded exercise, not the transient URL returned by the initial
    // directory navigation. SPA routing can settle after the study notice.
    const entryURL=snapshot.pageURL||page.url();
    const routeUnit=entryURL.match(/\/courseware\/([^/?#]+)/)?.[1];
    if(task.unitId&&routeUnit&&routeUnit!==task.unitId.replace(/^id-/,'').replace(/-tab$/,''))throw new Error('题目载入后进入了其他单元，已停止填答。');
    this.assertEntryPage(page,entryURL,snapshot);
    if(snapshot.navigation?.known&&entryTitle(task)&&UStudy.normalize(snapshot.navigation.title)!==UStudy.normalize(entryTitle(task)))return {review:true,message:'当前活动题目标签与目录项目不一致，尚未填写，请从目录重新打开所选项目。'};
    const index=this.store.getBankIndex?this.store.getBankIndex():UStudy.buildBankIndex(this.store.data.bank),apiKey=this.store.apiKey;
    await this.gate(task,signal);task.status='running';this.store.changed();
    const matching=snapshot.questions.filter(q=>q.type==='matching');
    this.store.addLog(task,`已识别 ${snapshot.questions.length} 道题（单选 ${snapshot.questions.filter(q=>q.type==='single').length}、多选 ${snapshot.questions.filter(q=>q.type==='multiple').length}、文本 ${snapshot.questions.filter(q=>q.type==='text').length}${matching.length?'、句子配对 '+matching.length+' 组 / '+matching.reduce((n,q)=>n+q.prompts.length,0)+' 对':''}），共 ${snapshot.questions.filter(q=>q.type==='text').reduce((n,q)=>n+q.targets.length,0)} 个文本 / 下拉作答框。`);
    const prepared=[],wholePageAnswers=UStudy.matchExercisePage(snapshot.questions,{courseId:task.courseId,unitId:task.unitId,entryKey:task.entryKey},index);
    const evidence=correction?analyzeCorrectionHistory(snapshot,correction.history):null;
    if(evidence?.contradictory)return {review:true,message:'平台评分记录存在冲突，尚未填写或提交，请待评分稳定后核对。'};
    let aiPageChecks=Promise.resolve();
    const checkAIPage=(checkSignal=signal,{readContent=true}={})=>{
      // The entry/retry checks and the pending-request watcher share one queue;
      // a late portal must not be acknowledged by two checks at once.
      const pending=aiPageChecks.catch(()=>{}).then(async()=>{
        await this.gate(task,checkSignal);this.assertEntryPage(page,entryURL,snapshot);
        if(typeof snapshot.frame?.evaluate==='function'){
          let dismissed=false;
          for(;;)try{dismissed=await this.withStudyNoticeRecovery(task,page,checkSignal,()=>this.dismissStudyNotice(task,page,checkSignal),{noticeOnly:true});break;}
          catch(error){
            checkSignal?.throwIfAborted();if(error.code!=='LESSON_ACTION_BLOCKED')throw error;
            this.pages.protect(page,'study-notice-review');task.status='review';this.store.changed();
            this.store.addLog(task,`${error.message} 当前题页及本轮已生成的答案已保留；处理后点击「继续核对」，继续本轮请求与复核。`,'warning');await this.gate(task,checkSignal);
          }
          checkSignal?.throwIfAborted();this.assertEntryPage(page,entryURL,snapshot);
          if(!readContent&&!dismissed)return;
          const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,entryURL,fresh);
          if(!fresh||fresh.signature!==snapshot.signature)throw new Error('AI 请求期间题目或阅读材料发生变化，已停止，请重新启动任务。');
        }
      });aiPageChecks=pending;return pending;
    };
    // Resolve the whole leaf before writing any answer.
    for(const [i,question] of snapshot.questions.entries()){
      await this.gate(task,signal);let answer=wholePageAnswers?.[i]||UStudy.matchAnswer({...question,scope:{courseId:task.courseId,unitId:task.unitId,entryKey:task.entryKey}},index),textPrepared=false;
      const prepare=value=>{const result=prepareTextAnswer(question,value);if(result.changed)this.store.addLog(task,`第 ${i+1} 题已将 ${result.changed} 处排版标点转换为普通标点，便于 U校园接收输入。`);textPrepared=true;return result.answer;};
      if(settings.aiEnabled&&(!answer||correction)){
        const previousAnswers=evidence?.history.at(-1)?.answers[i]||(correction?.signature===snapshot.signature?correction.previous?.[i]?.answers:undefined);
        const correctionData=correction?{feedback:correction.feedback,...(previousAnswers?{previousAnswers}:{}),...correctionPromptFor(evidence,i)}:undefined;
        let evidenceRetries=0;
        for(;;){
          try{
            await checkAIPage();
            const requirements=UStudy.textAnswerRequirements(question);
            if(question.directions?.trim())this.store.addLog(task,`第 ${i+1} 题：已读取 ${question.directions.trim().length} 字符题目要求${requirements?`，须填写词库对应的大写字母${requirements.allowReuse?'':'，每个选项最多使用一次'}`:''}。`);
            this.store.addLog(task,correction?`正在根据答题小结重新核实第 ${i+1} 题。`:`第 ${i+1} 题未命中题库，正在请求配置的 AI 服务${question.context?.trim()?`（已附带 ${question.context.trim().length} 字符上下文）`:''}。`);
            answer=await measureStage(task,'ai',()=>this.withAIStudyNoticeWatch(page,signal,requestSignal=>this.askModel(question,settings,apiKey,requestSignal,{
              correction:correctionData,
              beforeAttempt:()=>checkAIPage(requestSignal),
              onProgress:event=>{
                if(event.stage==='waiting')this.store.addLog(task,`第 ${i+1} 题：AI 已等待 ${Math.round(event.elapsedMs/1000)} 秒，${event.phase==='waiting-response'?'正在等待服务响应':'接口已连接，正在等待完整答案'}（第 ${event.attempt}/${event.maxAttempts} 次请求）。`);
                if(event.stage==='complete')this.store.addLog(task,`第 ${i+1} 题：AI 答案已返回，本次请求耗时 ${(event.elapsedMs/1000).toFixed(1)} 秒。`);
              },
              onRetry:({nextAttempt,maxAttempts,delayMs,reason})=>this.store.addLog(task,`第 ${i+1} 题：${reason} ${Math.ceil(delayMs/1000)} 秒后自动重试（${nextAttempt}/${maxAttempts}）。`,'warning')
            }),checkAIPage));
            await checkAIPage();
            answer=prepare(answer);
            if(evidence){
              const protectedAnswer=protectCorrectionAnswer(question,answer,evidence.rules[i]);
              const duplicate=snapshot.questions.length===1&&submittedAnswers.has(submittedAnswerKey(snapshot,[protectedAnswer.answer||answer]));
              if(protectedAnswer.issue||duplicate){
                if(evidence.history.length>1&&evidenceRetries++===0){
                  correctionData.validationFeedback=protectedAnswer.issue||'整组答案与此前未达标的提交相同。';
                  this.store.addLog(task,`第 ${i+1} 题：纠错答案仍与已有评分冲突，正在携带全部评分记录重新核实一次；尚未填写或提交。`,'warning');
                  continue;
                }
                return {review:true,message:duplicate?'重新核实后答案与此前未达标的提交相同，已停止重复提交。请检查错题、题型和阅读 / 听力材料，修改并提交后点击「继续核对」。':`${protectedAnswer.issue} 重新核实仍未得到符合评分记录的答案，本轮尚未填写或提交，请核对原文和平台解析。`};
              }
              answer=protectedAnswer.answer;
              if(protectedAnswer.protectedParts)this.store.addLog(task,`第 ${i+1} 题保留了 ${protectedAnswer.protectedParts} 个经平台评分确认正确的答案，避免纠错时改坏。`);
            }
            task.source='题库 + AI';break;
          }catch(error){
            signal.throwIfAborted();
            if(typeof snapshot.frame?.evaluate==='function'&&page.url()===entryURL)await this.dismissStudyNotice(task,page,signal);
            if(error instanceof AIRequestError&&error.code==='AI_MISSING_MATERIAL')return {review:true,message:`第 ${i+1} 题：${error.message} ${question.context?.trim()?`当前题已附带 ${question.context.trim().length} 字符上下文。`:'当前题未读取到可用上下文。'} 本轮尚未自动填写或提交当前页。请核对题目实际需要的信息，手动完成并提交后点击「继续核对」；该项目不会标记为无题或自动跳过。`};
            if(error instanceof AIRequestError&&['AI_IMAGE_MISSING','AI_VISION_REQUEST_ERROR'].includes(error.code))return {review:true,message:`第 ${i+1} 题：${error.message} 本轮尚未自动填写或提交当前页。请核对图片或识图模型配置，手动完成并提交后点击「继续核对」；该项目不会标记为无题或自动跳过。`};
            if(!(error instanceof AIRequestError)||!error.retryable)throw error;
            task.status='review';this.store.changed();
            this.store.addLog(task,`${error.message} 已保留本页前 ${prepared.length} 道已准备的答案，本轮尚未自动填写或提交当前页。网络或服务恢复后点击「继续核对」，将从第 ${i+1} 题重试；停止任务会结束本次等待。`,'warning');
            await this.gate(task,signal);await checkAIPage();
            this.store.addLog(task,`正在继续第 ${i+1} 题的 AI 请求，复用本页前 ${prepared.length} 道已准备的答案。`);
          }
        }
      }
      if(!answer)throw new Error(`题库未匹配到答案：${question.question.slice(0,100)}。请补充题库或启用 AI。`);
      if(!textPrepared)answer=prepare(answer);
      if(question.type==='text'&&answer.answers.length!==question.targets.length)throw new Error('题库答案数量与填空数量不一致，已停止。');
      prepared.push(answer);
    }
    const answerKey=submittedAnswerKey(snapshot,prepared);
    if(submittedAnswers.has(answerKey))return {review:true,message:'重新核实后答案与此前未达标的提交相同，已停止重复提交。请检查错题、题型和阅读 / 听力材料，修改并提交后点击「继续核对」。'};
    const current=await this.waitQuestions(task,page,settings,signal,{timeout:15000});
    this.assertEntryPage(page,entryURL,current);
    if(!current||current.signature!==snapshot.signature)throw new Error('解析期间题目发生变化，请重新启动任务。');
    await this.verifyImages(task,page,current,signal,{settings});
    let learning=this.learningSessions.get(task.id);
    if(learning){
      try{const saved=this.mediaTranscripts.get(page);await learning.register(current,await this.activeFrames(page),saved?.url===page.url()?saved.texts:{});}
      catch{await this.disposeExerciseLearning(task.id);learning=null;this.store.addLog(task,'整题记录未能初始化，本项目会继续填答，但本次不自动入库。','warning');}
    }
    const checkpoint=async()=>{
      await this.gate(task,signal);this.assertEntryPage(page,entryURL,current);
      if(typeof current.frame?.evaluate==='function'){
        for(;;)try{await this.withStudyNoticeRecovery(task,page,signal,()=>this.dismissStudyNotice(task,page,signal),{noticeOnly:true});break;}
        catch(error){await reviewAnswerAction(error);}
        const fresh=await this.readQuestions(page,settings);this.assertEntryPage(page,entryURL,fresh);
        if(!fresh||fresh.signature!==snapshot.signature)throw new Error('填写前题目或阅读材料发生变化，已停止。');
      }
    };
    const reviewAnswerAction=async error=>{
      signal.throwIfAborted();if(error.code!=='LESSON_ACTION_BLOCKED')throw error;
      this.pages.protect(page,'draft');task.status='review';this.store.changed();
      this.store.addLog(task,`${error.message} 已保留本页全部已生成答案和已填内容；恢复后只重试当前作答操作并复核，不重复请求 AI。`,'warning');
      await this.gate(task,signal);
    };
    const interact=async(frame,selector,perform)=>{
      for(;;)try{return await this.withStudyNoticeRecovery(task,page,signal,async()=>(await currentLessonActions()).performAnswerAction(this,frame,selector,perform,{signal,checkpoint}));}
      catch(error){await reviewAnswerAction(error);}
    };
    for(const [i,answer] of prepared.entries()){
      await this.gate(task,signal);this.assertEntryPage(page,entryURL,current);
      if(task.answered>=500)throw new Error('单次任务已达到 500 道题上限，请确认后新建任务。');
      const question=current.questions[i],frame=current.questionFrames?.[i]||current.frame;this.pages.protect(page,'draft');
      try{await measureStage(task,'fill',()=>this.fillQuestion(frame,question,answer,{signal,checkpoint,interact,textPrepared:true,onMatchingRecovery:({moves,maxMoves})=>this.store.addLog(task,`检测到配对顺序异步回退，正在按当前整组顺序重新定位（已拖动 ${moves}/${maxMoves} 次），复用已有答案，尚未提交。`,'warning')}));}
      catch(error){signal.throwIfAborted();if(error instanceof TextInputError)return {review:true,message:`第 ${i+1} 题：${error.message} 已保留当前页，请核对输入限制后手动完成并提交，再点击「继续核对」。`};throw error;}
      await this.gate(task,signal);task.answered++;
      this.store.addLog(task,`${answer.source}${answer.matchBasis?'（'+answer.matchBasis+'）':''} · 已填答：${question.question.slice(0,70)} → ${question.type==='multiple'&&!answer.answers.length?'不选任何选项':answer.answers.join(' / ').slice(0,120)}`);
    }
    for(const [i,answer] of prepared.entries()){
      try{await this.verifyQuestion(current.questionFrames?.[i]||current.frame,current.questions[i],answer,{signal,checkpoint,textPrepared:true});}
      catch(error){signal.throwIfAborted();if(error instanceof TextInputError)return {review:true,message:`第 ${i+1} 题：${error.message} 已保留当前页，请核对后手动完成并提交，再点击「继续核对」。`};throw error;}
    }
    await this.verifyImages(task,page,current,signal,{settings});
    task.pages++;this.store.changed();
    const internalPaging=canContinueExercise(current,current,task);
    const nextFirst=internalPaging&&Number.isFinite(current.navigation.progress)&&current.navigation.progress>0&&current.navigation.progress<100;
    if(!settings.autoSubmit&&!nextFirst)return {review:true,message:'当前页已填答，请检查本项目是否还有后续小题，完成并提交后再点击「继续核对」。'};
    await this.gate(task,signal);this.assertEntryPage(page,entryURL,current);
    const actionFrames=typeof page.frames==='function'?await this.activeFrames(page):[current.frame];
    let submitted=false,actionKind='';
    const beforeClick=async()=>{
      await checkpoint();
      for(const [i,answer] of prepared.entries())try{await this.verifyQuestion(current.questionFrames?.[i]||current.frame,current.questions[i],answer,{signal,checkpoint,textPrepared:true});}catch(error){signal.throwIfAborted();throw Object.assign(new Error('提交前复核发现答案或题目已变化，已保留当前内容；请核对后手动提交，再点击「继续核对」。'),{code:'LESSON_ACTION_BLOCKED',cause:error});}
      await learning?.prepareSubmission();
    };
    const actions=nextFirst?[['next',settings.nextSelector],['submit',settings.submitSelector]]:[['submit',settings.submitSelector],['next',settings.nextSelector]];
    for(const [kind,selector] of actions){
      const candidates=[];
      for(const frame of actionFrames){
        if(typeof frame.evaluate!=='function'){candidates.push(frame);continue;}
        try{
          const report=await frame.evaluate(findActionInDOM,{kind,selector,includeDiagnostics:true});
          if(report?.count>1)return {review:true,message:'当前页已填答，检测到多个提交入口，需要在 U校园逐项核对并提交，再点击「继续核对」。'};
          if(report?.selector||typeof report==='string')candidates.push(frame);
        }catch{throw new Error('提交按钮选择器无效或题目框架已变化，请手动核对。');}
      }
      if(candidates.length>1)return {review:true,message:'当前页已填答，检测到多个提交入口，需要在 U校园逐项核对并提交，再点击「继续核对」。'};
      if(kind==='submit'&&candidates.length&&!settings.autoSubmit)return {review:true,message:'当前页已填答并复核，请在 U校园检查后提交，再点击「继续核对」。'};
      let clicked=false,observedSubmission=false;
      if(candidates.length===1)await learning?.prepareSubmission();
      if(candidates.length===1)for(;;){
        try{
          clicked=await this.withStudyNoticeRecovery(task,page,signal,async retry=>{
            if(retry){const feedback=await this.readExerciseFeedback(page);if(feedback.summary&&feedback.pageURL===entryURL&&feedback.navigationKey===current.navigation?.key){observedSubmission=true;return true;}}
            return this.action(candidates[0],kind,selector,{signal,checkpoint,beforeClick});
          });break;
        }
        catch(error){
          signal.throwIfAborted();if(error.code!=='LESSON_ACTION_BLOCKED')throw error;
          this.pages.protect(page,'draft');task.status='review';this.store.changed();this.store.addLog(task,`${error.message} 恢复后只重试当前操作并核对已填答案，不重复请求 AI。`,'warning');
          await this.gate(task,signal);
          const feedback=await this.readExerciseFeedback(page);
          if(feedback.summary&&feedback.pageURL===entryURL&&feedback.navigationKey===current.navigation?.key){clicked=true;observedSubmission=true;break;}
        }
      }
      if(clicked){
        this.store.addLog(task,observedSubmission?'已确认本项目已提交的小结，正在核对目录状态。':kind==='submit'?'已点击本项目提交按钮，正在核对目录状态。':'已保存当前页并点击「下一题」，正在检查后续页面是否仍属于本项目。');submitted=true;actionKind=observedSubmission?'submit':kind;break;
      }
    }
    if(!submitted)return {review:true,message:'当前页已填答，未识别到唯一的提交按钮，请核对是否还有后续小题，完成并提交后点击「继续核对」。'};
    submittedAnswers.add(answerKey);
    if(actionKind==='next')return {nextPage:true,snapshot:current,entryURL,signature:snapshot.signature,answers:prepared,submitted:learning?.capturedAnswers?.(current,actionKind)};
    // A footer click can open a failed result, rather than finish the required
    // leaf. Observe its outcome before asking the directory for completion.
    const feedback=await measureStage(task,'submission',()=>this.waitSubmissionFeedback(task,page,signal));
    const captured=learning?.capturedAnswers?.(current,actionKind);
    if(captured){submittedAnswers.delete(answerKey);submittedAnswers.add(submittedAnswerKey(snapshot,captured.map(answers=>({answers}))));}
    return {feedback,snapshot:current,entryURL,signature:snapshot.signature,answers:prepared,submitted:captured};
  }
  async refreshTaskDirectory(task,catalog,signal){
    return measureStage(task,'directory',async()=>{
      await this.gate(task,signal);await this.navigate(catalog.page,catalog.url,{signal});
      const directory=await this.prepareDirectory(catalog.page,task.unitId,{signal});
      const summary=summarizeDirectory(directory);task.requiredTotal=summary.required;task.requiredCompleted=summary.completed;this.store.changed();return directory;
    });
  }
  async finishExerciseSummary(task,page,feedback,signal){
    if(!submittedSummary(feedback)||!feedback.navigationKey||!entryTitle(task))return false;
    let title;try{title=JSON.parse(feedback.navigationKey)[2];}catch{return false;}
    if(UStudy.normalize(title)!==UStudy.normalize(entryTitle(task)))return false;
    const checkpoint=async()=>{
      await this.gate(task,signal);this.assertEntryPage(page,feedback.pageURL,feedback);
      const fresh=await this.readExerciseFeedback(page);
      if(!submittedSummary(fresh)||fresh.frame!==feedback.frame||fresh.pageURL!==feedback.pageURL||fresh.frameURL!==feedback.frameURL||fresh.navigationKey!==feedback.navigationKey)throw new Error('答题小结或当前项目已变化，尚未点击继续学习，请检查题页。');
    };
    await checkpoint();
    if(!await this.action(feedback.frame,'finish','',{signal,checkpoint}))return false;
    this.store.addLog(task,'已确认当前题全部作答，已点击答题小结的「继续学习」，正在等待目录保存完成状态。');return true;
  }
  async waitTaskCompletion(task,catalog,page,entry,signal,{attempts=4,delayMs=1000,vocabularyComplete=false,videoComplete=false,audioComplete=false,oralComplete=false,discussionComplete=false}={}){
    await this.gate(task,signal);
    let feedback=await this.readExerciseFeedback(page);this.learningSessions.get(task.id)?.observeFeedback(feedback);
    if(feedback.failed)return {feedback};
    let submitted=submittedSummary(feedback);const limit=feedback.summary||vocabularyComplete||videoComplete||audioComplete||oralComplete||discussionComplete?Math.max(1,Math.min(attempts,6)):1;let directory,matched,finished=false;
    for(let attempt=0;attempt<limit;attempt++){
      await this.gate(task,signal);directory=await this.refreshTaskDirectory(task,catalog,signal);
      matched=directory.entries.find(item=>item.key===entry.key&&item.required);
      if(!matched)throw new Error('提交后目录项目发生变化，已停止自动切换。');
      if(feedback.summary&&!submitted&&!finished){
        // A result heading can render before its counts or grade. Read again
        // after the catalog round-trip, rather than treating that first partial
        // snapshot as permanent. Never adopt a result for another exercise.
        const fresh=await this.readExerciseFeedback(page);
        if(fresh.summary){
          if(feedback.navigationKey&&fresh.navigationKey!==feedback.navigationKey||feedback.pageURL&&fresh.pageURL!==feedback.pageURL)throw new Error('答题小结或当前项目已变化，已停止目录核对。');
          feedback=fresh;submitted=submittedSummary(feedback);this.learningSessions.get(task.id)?.observeFeedback(feedback);
          if(feedback.failed)return {feedback};
        }
      }
      if(matched.completed)return {directory,matched,feedback};
      if(!finished&&submitted)finished=await this.finishExerciseSummary(task,page,feedback,signal);
      if(attempt===0&&submitted)this.store.addLog(task,`U校园已记录本题全部作答${feedback.grading?.score!=null?'，得分 '+feedback.grading.score:''}；目录仍在更新，正在自动回查，期间不会重复生成或提交答案。`);
      if(attempt===0&&vocabularyComplete)this.store.addLog(task,'词卡已显示学习结束，目录仍在更新，正在自动回查，不再重复翻动。');
      if(attempt===0&&videoComplete)this.store.addLog(task,'视频已自然播放结束，目录仍在更新，正在自动回查，不再重复播放。');
      if(attempt===0&&audioComplete)this.store.addLog(task,'音频已自然播放结束，目录仍在更新，正在自动回查，不再重复播放。');
      if(attempt===0&&oralComplete)this.store.addLog(task,'口语录音已保存并核对，目录仍在更新，正在自动回查，不再重复录音。');
      if(attempt+1<limit)await sleep(delayMs,undefined,{signal});
    }
    return {directory,matched,feedback,finished};
  }
  async runTask(task,course,settings,signal){
    try{
    const catalog=await this.courseDirectory(course,{signal});
    let directory=await this.refreshTaskDirectory(task,catalog,signal);
    const allPending=requiredQueue(directory,task.unitId),queue=task.oralReplacement?allPending.filter(entry=>entry.key===task.oralReplacement.entryKey):allPending,summary=summarizeDirectory(directory);
    if(task.oralReplacement&&queue.length!==1)throw new Error('待替换口语题已完成或不在当前必修目录中，尚未录入音频。');
    if(!summary.required)throw new Error('目录没有读取到必修标记，未启动填答。请核对来源账号、课程班级和目录明细后重试。');
    task.requiredTotal=summary.required;task.requiredCompleted=summary.completed;
    this.store.addLog(task,`${task.unitLabel}：${summary.required} 个必修项目，${summary.completed} 个已完成，${queue.length} 个待处理。`);
    if(queue.length>150)throw new Error('该单元超过 150 个待处理必修项目，请分次处理。');
    for(const [i,entry] of queue.entries()){
      if(task.oralReplacement&&entry.key!==task.oralReplacement.entryKey)continue;
      await this.gate(task,signal);task.status='running';task.entryKey=entry.key;task.currentEntry=[...entry.path,entry.title].filter((name,index,all)=>index===0||name!==all[index-1]).join(' / ');
      this.store.addLog(task,`必修 ${i+1}/${queue.length} · ${task.currentEntry}`);
      const remembered=this.store.findManualEntry?.(task,settings);
      const vocabularyEntry=isVocabularyEntry(task),roleplayEntry=isRoleplayEntry(task),oralEntry=isOralRetellEntry(task)||remembered?.reason==='oral-only',retryRemembered=!!task.oralReplacement||(roleplayEntry?remembered?.handler!==ROLEPLAY_HANDLER:vocabularyEntry?remembered?.handler!==VOCABULARY_HANDLER:oralEntry?remembered?.handler!==ORAL_HANDLER:remembered?.reason==='no-fillable-questions'&&remembered.handler!==QUESTION_CONTROLS_HANDLER);
      if(remembered&&!retryRemembered){
        if(!task.manualItems.includes(task.currentEntry))task.manualItems.push(task.currentEntry);
        this.store.addLog(task,`已跳过已标记手动项目：${task.currentEntry}。未打开题页或重复识别，仍需手动完成。`);
        continue;
      }
      if(remembered)this.store.addLog(task,roleplayEntry?'该项目此前被标记为手动处理；新版本已支持 A 角色逐句对话，本次重新识别。':vocabularyEntry?'该词卡项目此前被标记为手动处理；新版本已支持词卡翻页，本次重新识别。':oralEntry?'该项目此前被标记为手动处理；新版本已支持口语复述录音，本次重新识别一次。':'该项目此前被标记为无作答内容；新版本已支持纯音频、讨论板等页面，本次重新识别一次。');
      if(i>0)directory=await this.refreshTaskDirectory(task,catalog,signal);
      const page=await this.openRequiredEntry(task,catalog,directory,entry,signal);if(!page){await this.store.forgetManualEntry?.(task,settings);continue;}
      await this.beginExerciseLearning(task,page,settings);
      let result=await this.answerEntry(task,page,settings,signal);
      if(result.manual){
        const mark=result.rememberable===false?null:await this.store.rememberManualEntry?.(task,settings,result.reason||'no-fillable-questions',roleplayEntry?ROLEPLAY_HANDLER:vocabularyEntry?VOCABULARY_HANDLER:oralEntry||result.reason==='oral-only'?ORAL_HANDLER:QUESTION_CONTROLS_HANDLER);
        if(!task.manualItems.includes(task.currentEntry))task.manualItems.push(task.currentEntry);
        this.store.addLog(task,mark?`已标记待手动处理：${task.currentEntry}。没有可自动填答内容，后续将从目录直接跳过。`:`待手动处理：${task.currentEntry}。页面已载入，但没有支持自动填写的题目。`);
        const released=await this.pages.release(page);
        if(released.status!=='retained'){this.taskPages.delete(task.id);continue;}
        result.review=true;result.message='本页有草稿、播放内容或无法确认的页面状态，已保留题页。请手动完成并提交，再点击「继续核对」；任务不会继续堆积标签页。';
      }
      let review=result.review,message=result.message;
      for(;;){
        if(review){
          task.status='review';this.store.addLog(task,message||'目录尚未显示当前项目已完成，请在 U校园确认提交后点击「继续核对」。');
          const closed=()=>new Error('课程窗口已关闭，请重新打开课程后启动任务；上方已记录停止原因。');
          if(page.isClosed?.())throw closed();
          await this.gate(task,signal);
        }
        if(task.oralRetryRequested){
          delete task.oralRetryRequested;const previousReview=task.oralReview;delete task.oralReview;
          const handler=await currentOralHandler(),oral=await this.readOralActivity(page);
          if(!oral||handler.oralRecordingIdentity(oral)!==task.oralReplacement?.recordingKey)result={review:true,message:'当前题目或已有录音已变化，尚未执行重录，请重新检查题页。'};
          else result=await this.completeOralActivity(task,page,oral,settings,signal);
          review=result.review;message=result.message;
          if(review){const fresh=await this.readOralActivity(page).catch(()=>null);if(previousReview&&handler.oralRecordingIdentity(fresh)===previousReview.recordingKey)task.oralReview=previousReview;continue;}
        }
        const outcome=await this.waitTaskCompletion(task,catalog,page,entry,signal,{vocabularyComplete:result.vocabularyDone===true,videoComplete:result.videoDone===true,audioComplete:result.audioDone===true,oralComplete:result.oralDone===true||result.roleplayDone===true,discussionComplete:result.discussionDone===true}),feedback=outcome.feedback;
        if(feedback.failed){review=true;message=`${describeExerciseFailure(feedback)}请在「返回修改」中检查客观题，修改并提交后点击「继续核对」。`;continue;}
        directory=outcome.directory;const matched=outcome.matched;
        if(matched.completed){
          await this.store.forgetManualEntry?.(task,settings);
          this.store.addLog(task,`已从目录确认完成：${task.currentEntry}`);
          const learning=this.learningSessions.get(task.id);
          if(learning?.pages.length){
            const result=learning.bundle();
            if(result.exercise){const saved=await this.store.learnVerifiedExercise(result.exercise);this.store.addLog(task,`平台确认整题全对，${saved.added?'已整题入库':saved.unchanged?'已复用整题题库记录':'已更新整题题库'}：${task.currentEntry}（${saved.pages} 页，${saved.questions} 个完整小题）。`);}
            else this.store.addLog(task,`本项目未自动入库：${result.reason}。`);
          }
          if(page!==catalog.page)await this.pages.release(page,{completed:true});this.taskPages.delete(task.id);break;
        }
        review=true;message=result.audioDone?'音频已自然播放结束，但多次回查目录仍未确认完成；已保留音频页，请稍后点击「继续核对」刷新，不再重复播放。':result.videoDone?'视频已自然播放结束，但多次回查目录仍未确认完成；已保留视频页，请稍后点击「继续核对」刷新，不再重复播放。':result.vocabularyDone?'词卡已显示学习结束，但多次回查目录仍未确认完成；已保留词卡页，请稍后点击「继续核对」刷新，不再重复翻动。':submittedSummary(feedback)?'U校园已记录本题全部作答，但多次回查目录仍未确认完成；本题不会重复生成或提交。请核对本板块是否还有未完成练习，或稍后点击「继续核对」刷新状态。':result.message||'目录尚未显示当前项目已完成，请在 U校园确认提交后点击「继续核对」。';
      }
    }
    directory=await this.refreshTaskDirectory(task,catalog,signal);
    const remaining=directory.entries.filter(entry=>entry.required&&!entry.completed);
    task.manualItems=remaining.map(entry=>[...entry.path,entry.title].filter((name,index,all)=>index===0||name!==all[index-1]).join(' / '));
    task.status=remaining.length?'partial':'completed';task.currentEntry='';
    this.store.addLog(task,remaining.length?`${task.unitLabel} 已遍历，仍有 ${remaining.length} 个必修项目待手动处理。`:`已从目录确认 ${task.unitLabel} 的全部必修项目完成。`);
    this.store.addActivity(`${task.unitLabel}：已填答 ${task.answered} 题，必修完成 ${task.requiredCompleted}/${task.requiredTotal}。`,'check');
    }finally{await this.disposeExerciseLearning(task.id);}
  }
  async close(){
    this.closing=true;const operationsClosing=this.operations.close();
    const closing=this.context?.close().catch(()=>{});await this.runtime.close();await closing;await operationsClosing;await this.store.flush();
  }
}
