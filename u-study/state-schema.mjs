import * as UStudy from './shared/core.mjs';
import {defaultSettings,validateSettings} from './settings.mjs';

export const SCHEMA_VERSION=2;
export const emptyState=()=>({schemaVersion:SCHEMA_VERSION,courses:[],bank:[],tasks:[],activity:[],manualEntryMarks:[],settings:{...defaultSettings},lastSynced:null});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const statuses=new Set(['waiting','running','paused','review','stopping','stopped','partial','completed','failed']);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const timestamp=value=>Number.isFinite(value)&&value>=0;

export function validateManualEntryMarks(entries=[]){
  if(!Array.isArray(entries)||entries.length>10000)throw new Error('手动项目标记格式异常。');
  return entries.map(entry=>{
    if(!object(entry)||!text(entry.courseId,2000)||!entry.courseId||!text(entry.unitId,200)||!entry.unitId||!text(entry.entryKey,5000)||!entry.entryKey||!text(entry.label,5000)||!text(entry.questionSelector,500)||!['no-fillable-questions','oral-only'].includes(entry.reason)||!timestamp(entry.markedAt))throw new Error('手动项目标记格式异常。');
    if(entry.handler!==undefined&&!['vocabulary-cards-v1','video-view-v1','question-controls-v2','question-controls-v3','question-controls-v4','question-controls-v5','oral-retell-v1','oral-recording-v2','roleplay-v1'].includes(entry.handler))throw new Error('手动项目处理器版本异常。');
    const {courseId,unitId,entryKey,label,questionSelector,reason,markedAt}=entry;return {courseId,unitId,entryKey,label,questionSelector,reason,markedAt,...(entry.handler?{handler:entry.handler}:{})};
  });
}

/** Validate a candidate without ever assigning it to the running Store. */
export function validateState(saved,bank=saved?.bank){
  if(!object(saved)||![undefined,1,SCHEMA_VERSION].includes(saved.schemaVersion))throw new Error('不支持的数据版本。');
  if(saved.settings!==undefined&&!object(saved.settings))throw new Error('设置数据格式异常。');
  if(!Array.isArray(saved.courses)||saved.courses.length>5000||!Array.isArray(saved.tasks)||saved.tasks.length>50||!Array.isArray(saved.activity)||saved.activity.length>40)throw new Error('数据列表格式异常。');
  if(saved.courses.some(c=>!object(c)||!text(c.id,2000)||!text(c.title,200)||!UStudy.safeCourseUrl(c.url)))throw new Error('课程数据格式异常。');
  const tasks=saved.tasks.map(task=>{
    if(!object(task)||!text(task.id,200)||!statuses.has(task.status)||!Array.isArray(task.logs)||task.logs.length>150)throw new Error('任务数据格式异常。');
    if(task.logs.some(log=>!object(log)||!text(log.message,5000)||(log.timestamp!==undefined&&!timestamp(log.timestamp))||!['info','error','warning',undefined].includes(log.level)))throw new Error('任务日志格式异常。');
    for(const key of ['answered','pages','requiredTotal','requiredCompleted'])if(task[key]!==undefined&&(!Number.isInteger(task[key])||task[key]<0||task[key]>100000))throw new Error('任务进度格式异常。');
    if(task.manualItems!==undefined&&(!Array.isArray(task.manualItems)||task.manualItems.length>1000||task.manualItems.some(item=>!text(item,5000))))throw new Error('手动项目格式异常。');
    if(task.oralReplacement!==undefined&&(!object(task.oralReplacement)||!text(task.oralReplacement.entryKey,5000)||!/^[a-f0-9]{64}$/.test(task.oralReplacement.recordingKey||'')||!/^[a-f0-9]{64}$/.test(task.oralReplacement.draftKey||'')))throw new Error('口语替换范围格式异常。');
    if(task.oralReview!==undefined&&(!object(task.oralReview)||task.oralReview.ready!==true||!text(task.oralReview.entryKey,5000)||!/^[a-f0-9]{64}$/.test(task.oralReview.recordingKey||'')||!/^[a-f0-9]{64}$/.test(task.oralReview.draftKey||'')||!Number.isFinite(task.oralReview.previousSeconds)||task.oralReview.previousSeconds<=0||task.oralReview.previousSeconds>3600||!Number.isFinite(task.oralReview.seconds)||task.oralReview.seconds<=0||task.oralReview.seconds>180))throw new Error('口语重录预览格式异常。');
    if(task.oralRetryRequested!==undefined&&typeof task.oralRetryRequested!=='boolean')throw new Error('口语重录任务状态异常。');
    for(const key of ['courseId','courseTitle','unitId','unitLabel','currentEntry','source'])if(task[key]!==undefined&&!text(task[key],5000))throw new Error('任务字段格式异常。');
    if(task.metrics!==undefined&&(!object(task.metrics)||Object.values(task.metrics).some(metric=>!object(metric)||!timestamp(metric.count)||!timestamp(metric.totalMs))))throw new Error('任务耗时格式异常。');
    return {...task,status:['waiting','running','paused','review','stopping'].includes(task.status)?'stopped':task.status,logs:task.logs.map(log=>({...log,timestamp:log.timestamp??0}))};
  });
  if(saved.activity.some(item=>!object(item)||!text(item.message,5000)||!timestamp(item.timestamp)))throw new Error('活动数据格式异常。');
  if(saved.lastSynced!=null&&!timestamp(saved.lastSynced))throw new Error('同步时间格式异常。');
  if(saved.credentialVersion!==undefined&&!text(saved.credentialVersion,100))throw new Error('密钥配置版本异常。');
  if(saved.syncCoverage!==undefined&&(!object(saved.syncCoverage)||typeof saved.syncCoverage.complete!=='boolean'||!timestamp(saved.syncCoverage.read)||!timestamp(saved.syncCoverage.expected)||!text(saved.syncCoverage.reason,2000)))throw new Error('同步范围格式异常。');
  return {...emptyState(),courses:UStudy.mergeCourses([],saved.courses),bank:UStudy.validateBank(bank??[]),tasks,activity:saved.activity.map(item=>({...item})),manualEntryMarks:validateManualEntryMarks(saved.manualEntryMarks),settings:validateSettings({...defaultSettings,...saved.settings}),lastSynced:saved.lastSynced??null,...(saved.syncCoverage?{syncCoverage:saved.syncCoverage}:{}),...(saved.credentialVersion?{credentialVersion:saved.credentialVersion}:{})};
}
