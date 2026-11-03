import * as UStudy from './shared/core.mjs';

const closed=page=>!page||page.isClosed?.()===true;
const urlOf=page=>typeof page?.url==='function'?page.url():'';

/** Runs inside a frame. Conservatively retain anything the user may have edited. */
export function readPageActivityFromDOM(){
  const visible=el=>!!(el&&el.getClientRects().length&&!el.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(el).visibility!=='hidden');
  const fields=[...document.querySelectorAll('textarea,input:not([type]),input[type=text],input[type=email],input[type=number],input[type=file],[contenteditable=true],[contenteditable=""]')].filter(el=>!el.disabled&&!el.readOnly);
  const textDraft=fields.some(el=>el.type==='file'?el.files?.length>0:String(el.isContentEditable?el.textContent:el.value||'').trim().length>0);
  const choiceDraft=[...document.querySelectorAll('input[type=radio]:checked,input[type=checkbox]:checked,[role=radio][aria-checked=true],[role=checkbox][aria-checked=true],.option.selected,.ant-radio-wrapper-checked,.ant-checkbox-wrapper-checked,.is-checked,.scoop-select-wrapper .user-answer:not(.empty) .user-answer-text')].some(el=>!el.disabled&&!el.closest('[aria-readonly=true]'));
  const playing=[...document.querySelectorAll('video,audio')].some(el=>!el.paused&&!el.ended||el.srcObject?.getTracks?.().some(track=>track.readyState==='live'));
  const loading=[...document.querySelectorAll('.ant-spin-spinning,[aria-busy=true]')].some(visible);
  return {draft:textDraft||choiceDraft,playing,loading,unknown:document.readyState==='loading'||!document.body?.children.length};
}

/** Own only application pages; completed/empty lessons are disposable, drafts are protected. */
export class PageLifecycle {
  constructor(){this.context=null;this.records=new Map();this.home=null;this.catalog=null;}
  attach(context){
    if(this.context===context)return;
    this.context=context;this.records.clear();this.home=null;this.catalog=null;
    const pages=context.pages?.()||[];
    const home=pages.find(page=>urlOf(page).includes('/cmgt/course-management'))||pages.find(page=>urlOf(page)==='about:blank');
    if(home)this.track(home,'home');
    for(const page of pages)if(page!==home){
      const url=urlOf(page);
      if(url==='about:blank')this.track(page,'empty');
      else if(UStudy.safeCourseUrl(url)&&(/\/cmgt\/(?:course-management|resource-detail)/.test(url)||/\/learn(?:[/?#]|$)/.test(url)))this.track(page,'restored');
    }
  }
  track(page,role,details={}){
    if(!page)return page;
    if(!this.records.has(page))page.once?.('close',()=>this.forget(page));
    this.records.set(page,{...this.records.get(page),role,...details});
    if(this.home===page&&role!=='home')this.home=null;
    if(this.catalog===page&&role!=='catalog')this.catalog=null;
    if(role==='home')this.home=page;if(role==='catalog')this.catalog=page;
    return page;
  }
  forget(page){this.records.delete(page);if(this.home===page)this.home=null;if(this.catalog===page)this.catalog=null;}
  homePage(){
    if(closed(this.home)){this.home=null;return null;}
    const url=urlOf(this.home);
    if(url!=='about:blank'&&!url.includes('/cmgt/course-management')){this.track(this.home,'retained');return null;}
    return this.home;
  }
  protect(page,reason='draft'){const record=this.records.get(page);if(record)record.protected=reason;}
  unprotect(page,reason){const record=this.records.get(page);if(record?.protected===reason)delete record.protected;}
  hasDraft(){return [...this.records].some(([page,record])=>!closed(page)&&['lesson','restored'].includes(record.role)&&record.protected);}
  async activity(page){
    if(closed(page))return {closed:true};
    if(urlOf(page)==='about:blank')return {};
    if(typeof page.frames!=='function')return {unknown:true};
    const frames=page.frames();let read=0;const result={};
    for(const frame of frames){
      const url=urlOf(frame);if(!UStudy.safeCourseUrl(url)){if(url!=='about:blank')result.unknown=true;continue;}
      try{const state=await frame.evaluate(readPageActivityFromDOM);read++;for(const key of ['draft','playing','loading','unknown'])result[key]||=state[key]===true;}catch{result.unknown=true;}
    }
    if(!read)result.unknown=true;return result;
  }
  async release(page,{completed=false}={}){
    if(closed(page)){this.forget(page);return {status:'closed'};}
    const record=this.records.get(page);if(!record)return {status:'unmanaged'};
    if(['home','catalog'].includes(record.role))return {status:'in-use'};
    const activity=completed?{}:await this.activity(page);
    const transient=record.role==='restored'&&['loading','unknown'].includes(record.protected);
    const reason=completed?'':(!transient&&record.protected)||(['draft','playing','loading','unknown'].find(key=>activity[key]));
    if(reason){record.protected=reason;return {status:'retained',reason};}
    try{await page.close({runBeforeUnload:false});this.forget(page);return {status:'closed'};}
    catch{record.protected='unknown';return {status:'retained',reason:'unknown'};}
  }
  async replaceCatalog(page,details={}){
    const previous=this.catalog;
    this.track(page,'catalog',details);
    if(previous&&previous!==page&&!closed(previous)){
      const record=this.records.get(previous);
      if(record?.role==='catalog'){this.track(previous,'retired-catalog');await this.release(previous);}
    }
  }
  async releaseTask(taskId){
    for(const [page,record] of [...this.records])if(record.taskId===taskId&&record.role==='lesson')await this.release(page);
  }
  async pruneEmpty(){
    for(const [page,record] of [...this.records]){
      if(record.role==='empty'&&urlOf(page)==='about:blank')await this.release(page);
      else if(['restored','retired-catalog','opening-course'].includes(record.role))await this.release(page);
    }
  }
}
