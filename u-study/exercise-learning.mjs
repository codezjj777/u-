import {randomUUID} from 'node:crypto';
import * as Core from './shared/core.mjs';
import {collectQuestionsFromDOM,readExerciseNavigationFromDOM} from './platform-dom.mjs';

const bridges=new WeakMap();

// This identity describes authored content and answer slots, rather than typed
// values, generated element IDs or browser locators.
export function capturePageIdentity(questions){
  const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  return JSON.stringify(questions.map(q=>[clean(q.question),q.type,(q.options||[]).map(clean),clean(q.context),(q.wordBank||[]).map(clean),(q.targets||[]).map(field=>[field.kind,(field.choices||[]).map(choice=>[clean(choice.text),choice.value]),(field.items||[]).map(item=>[item.key,clean(item.text)])]),q.questionType||'',q.prompts,q.promptEmphasis,q.imageKeys,(q.images||[]).map(image=>[image.key,image.label]),clean(q.directions)]));
}

function installCaptureInDOM(collect,navigation,identity,config){
  window.__ustudyExerciseCapture?.dispose();
  let previous='',revision=0,disposed=false,scheduled=false;
  const selected=el=>{
    if(el.matches('input[type=radio],input[type=checkbox]'))return el.checked;
    if(el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true'||el.classList.contains('selected')||el.classList.contains('is-checked')||el.querySelector('input:checked'))return true;
    const row=el.closest('[class*="strongListView"]');
    return [el,row].filter(Boolean).some(node=>String(node.className||'').split(/\s+/).filter(token=>!/unselected|deselected|notselected|unchecked|inactive/i.test(token)).some(token=>/ant-(?:radio|checkbox)-wrapper-checked|(?:^|[_-])(?:selected|active|checked|sele)(?:$|[_-])|(?:strongItem|option)(?:Selected|Select)(?:$|[_-])/i.test(token)));
  };
  const read=()=>{
    if(location.href!==config.frameURL||config.navigationKey&&navigation().key!==config.navigationKey)return {valid:false,answers:[]};
    if(!config.indices.length)return {valid:true,answers:[]};
    const report=collect({questionSelector:config.questionSelector,includeDiagnostics:true,mediaTranscripts:config.mediaTranscripts,imageDigests:config.imageDigests});
    if(report.issues.length||identity(report.questions)!==config.identity)return {valid:false,answers:[]};
    const answers=[];
    for(const [i,question] of report.questions.entries()){
      const elements=question.targets.map(target=>{const nodes=document.querySelectorAll(target.selector);return nodes.length===1?nodes[0]:null;});
      if(elements.some(el=>!el))return {valid:false,answers:[]};
      const values=question.type==='matching'?[...elements[0].querySelectorAll(question.targets[0].itemSelector)].map(el=>question.targets[0].items.find(item=>item.key===el.getAttribute('data-ustudy-sort-key'))?.text||''):question.type==='text'?elements.map((el,index)=>{
        const target=question.targets[index];
        if(target.kind==='unipus-select'){
          const trigger=el.querySelector('.ant-dropdown-trigger.user-answer'),value=trigger&&!trigger.classList.contains('empty')?(trigger.querySelector('.user-answer-text')?.textContent||'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim():'';
          const choices=(target.choices||[]).filter(choice=>choice.text===value);return choices.length===1?choices[0].text:'';
        }
        if(target.kind==='select'){const choices=(target.choices||[]).filter(choice=>choice.value===el.value);return choices.length===1?choices[0].text:'';}
        return target.kind==='editable'?(el.innerText??el.textContent):el.value;
      }):elements.flatMap((el,index)=>selected(el)?[question.options[index]]:[]);
      if(!values.length&&question.type!=='multiple'||values.some(value=>typeof value!=='string'||!value.trim()||value.length>20000)||question.type==='single'&&values.length!==1)return {valid:false,answers:[]};
      answers.push({index:config.indices[i],answers:values});
    }
    return {valid:true,answers};
  };
  const send=(type,state,extra={})=>{
    if(disposed)return;
    void window[config.binding]({session:config.session,id:config.id,type,...state,...extra}).catch(()=>{});
  };
  const publish=()=>{
    const state=read(),serialized=JSON.stringify(state);
    if(serialized!==previous){previous=serialized;revision++;send('state',{...state,revision});}
    return {...state,revision};
  };
  const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed)publish();});}};
  const click=event=>{
    const target=event.target?.closest?.('button,a,[role=button],input[type=submit],input[type=button]');if(!target)return;
    const label=(target.innerText||target.value||target.textContent||'').replace(/\s+/g,'').trim();let kind='';
    for(const [candidate,pattern] of [['submit',/^(?:提交(?:答案|作业|练习|测试)?|交卷|submit(?:answer|quiz)?)$/i],['next',/^(?:下一题|下一页|下一步|next(?:question|page)?)$/i]]){
      let custom=false;try{custom=!!config[candidate+'Selector']&&target.matches(config[candidate+'Selector']);}catch{}
      if(custom||target.getAttribute('data-ustudy-action')===candidate||pattern.test(label)){kind=candidate;break;}
    }
    if(kind)send('submit',publish(),{kind});
  };
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','aria-checked','aria-selected','disabled','readonly']});
  for(const event of ['input','change','blur'])document.addEventListener(event,schedule,true);
  document.addEventListener('click',click,true);
  const dispose=()=>{disposed=true;observer.disconnect();for(const event of ['input','change','blur'])document.removeEventListener(event,schedule,true);document.removeEventListener('click',click,true);};
  window.__ustudyExerciseCapture={id:config.id,read:publish,dispose};return publish();
}

// Compose trusted, local function literals in Node. Page content is only ever
// passed as data; the installed reader performs no network requests or clicks.
const installCapture=new Function('config',`return (${installCaptureInDOM.toString()})(${collectQuestionsFromDOM.toString()},${readExerciseNavigationFromDOM.toString()},${capturePageIdentity.toString()},config);`);
const readCapture=({id})=>window.__ustudyExerciseCapture?.id===id?window.__ustudyExerciseCapture.read():null;
const disposeCapture=({id})=>{if(window.__ustudyExerciseCapture?.id===id)window.__ustudyExerciseCapture.dispose();};

function packQuestion(question,answer){
  const fields=question.targets.map(({kind,key,choices,inputMode,items})=>({kind,...(key!==undefined?{key}:{}),...(choices?{choices:choices.map(choice=>({...choice}))}:{}),...(items?{items:items.map(({key,text,originalLabel})=>({key,text,...(originalLabel?{originalLabel}:{})}))}:{}),...(inputMode?{inputMode}:{})}));
  return {question:question.question,type:question.type,options:[...(question.options||[])],context:question.context||'',...(question.directions?{directions:question.directions}:{}),wordBank:[...(question.wordBank||[])],blankOptions:question.type==='text'?fields.map(field=>field.choices?.map(choice=>choice.text)||[]):[],fields,answer:[...answer],...(question.images?.length?{images:question.images.map(image=>({digest:image.digest,label:image.label}))}:{}),...(question.type==='matching'?{prompts:[...question.prompts],promptEmphasis:question.promptEmphasis.map(words=>[...words])}:{}),...(question.id?{id:question.id}:{}),...(question.questionType?{questionType:question.questionType}:{}),...(question.mediaKeys?{mediaKeys:[...question.mediaKeys]}:{})};
}

export function fullCorrectProof(feedback,pages){
  if(!feedback?.summary||feedback.failed||feedback.grading?.pending||feedback.incorrect>0||feedback.partial>0||feedback.unanswered>0||!Number.isInteger(feedback.total)||feedback.total<1)return null;
  if(feedback.grading?.maxScore>0&&feedback.grading.score!==feedback.grading.maxScore)return null;
  const logical=pages.reduce((sum,page)=>sum+page.questions.length,0),blanks=pages.reduce((sum,page)=>sum+page.questions.reduce((count,q)=>count+Core.questionPartCount(q),0),0);
  const unit=feedback.total===logical?'questions':feedback.total===blanks?'blanks':null;if(!unit)return null;
  if(feedback.objective!=null&&feedback.subjective!=null&&feedback.objective+feedback.subjective!==feedback.total)return null;
  const ratios=feedback.grading?.correctRatios||[];
  if(ratios.some(ratio=>!Number.isInteger(ratio.correct)||!Number.isInteger(ratio.total)||ratio.correct<0||ratio.total<0||ratio.correct!==ratio.total))return null;
  const completeRatio=ratios.some(ratio=>ratio.total===feedback.total&&ratio.correct===ratio.total)||ratios.length>1&&ratios.every(ratio=>ratio.total>0&&ratio.correct===ratio.total)&&ratios.reduce((sum,ratio)=>sum+ratio.total,0)===feedback.total;
  const fullScore=feedback.grading?.maxScore>0&&feedback.grading.score===feedback.grading.maxScore;
  const explicit=feedback.grading?.allCorrect===true&&(feedback.subjective===0||completeRatio||fullScore);
  if(!completeRatio&&!fullScore&&!explicit)return null;
  return {method:'platform-all-correct',total:feedback.total,correct:feedback.total,unit,verifiedAt:Date.now()};
}

export class ExerciseLearningSession{
  constructor({page,task,settings}){
    this.page=page;this.scope={courseId:task.courseId,unitId:task.unitId,entryKey:task.entryKey};this.title=task.currentEntry;
    this.courseTitle=task.courseTitle||'';this.unitLabel=task.unitLabel||'';this.settings=settings;
    this.id=randomUUID();this.pages=[];this.current=null;this.sequence=0;this.grade=null;this.invalid=false;this.closed=false;
  }
  async bridge(){
    let bridge=bridges.get(this.page);
    if(!bridge){
      bridge={name:'__ustudyExercise_'+randomUUID().replaceAll('-',''),sessions:new Map()};bridges.set(this.page,bridge);
      try{await this.page.exposeBinding(bridge.name,(source,payload)=>bridge.sessions.get(payload?.session)?.handle(source.frame,payload));}
      catch(error){bridges.delete(this.page);throw error;}
    }
    bridge.sessions.set(this.id,this);return bridge;
  }
  async register(snapshot,frames,mediaTranscripts={}){
    if(this.closed)return;
    if(this.current?.signature===snapshot.signature)return;
    if(this.current&&!this.current.submitted)this.invalid=true;
    this.grade=null;this.pendingAuto=null;
    const record={id:randomUUID(),signature:snapshot.signature,pageURL:snapshot.pageURL||this.page.url(),navigationKey:snapshot.navigation?.key||'',questions:snapshot.questions,frames:new Map(),submitted:null};
    this.pages.push(record);this.current=record;
    if(this.pages.length>30){this.invalid=true;return;}
    const bridge=await this.bridge();
    for(const frame of frames){
      const indices=snapshot.questions.flatMap((_,index)=>(snapshot.questionFrames?.[index]||snapshot.frame)===frame?[index]:[]),local=indices.map(index=>snapshot.questions[index]);
      const navigation=await frame.evaluate(readExerciseNavigationFromDOM),config={binding:bridge.name,session:this.id,id:record.id,indices,identity:capturePageIdentity(local),frameURL:frame.url(),navigationKey:navigation?.key||'',questionSelector:this.settings.questionSelector||'',submitSelector:this.settings.submitSelector||'',nextSelector:this.settings.nextSelector||'',mediaTranscripts};
      record.frames.set(frame,{indices,state:null});
      config.imageDigests=Object.fromEntries(local.flatMap(q=>(q.images||[]).map(image=>[image.key,image.digest])));
      const state=await frame.evaluate(installCapture,config);record.frames.get(frame).state=state;
    }
  }
  stateAnswers(record,states){
    const answers=Array(record.questions.length).fill(null);
    for(const [frame,info] of record.frames){
      const state=states.get(frame);if(!state?.valid||!Array.isArray(state.answers)||state.answers.length!==info.indices.length)return null;
      for(const item of state.answers){
        if(!info.indices.includes(item.index)||answers[item.index]||!Array.isArray(item.answers)||item.answers.some(value=>typeof value!=='string'||value.length>20000))return null;
        const question=record.questions[item.index],resolved=Core.resolveAnswer(question,{answer:item.answers});
        if(!resolved||question.type==='text'&&resolved.answers.length!==question.targets.length)return null;
        answers[item.index]=resolved.answers;
      }
    }
    return answers.every(Boolean)?answers:null;
  }
  async prepareSubmission(){
    const record=this.current;if(!record||this.closed)return;
    const states=new Map();
    for(const frame of record.frames.keys()){const state=await frame.evaluate(readCapture,{id:record.id}).catch(()=>null);states.set(frame,state);if(state)record.frames.get(frame).state=state;}
    this.pendingAuto=this.stateAnswers(record,states)?{record,states}:null;
  }
  handle(frame,payload){
    const record=this.current;if(this.closed||!record||payload.id!==record.id||!record.frames.has(frame))return;
    const info=record.frames.get(frame);if(payload.revision<(info.state?.revision||0))return;info.state=payload;
    if(payload.type==='state'&&payload.valid&&record.submitted&&payload.answers.some(item=>JSON.stringify(item.answers)!==JSON.stringify(record.submitted.questions[item.index]?.answer))){record.submitted=null;this.grade=null;}
    if(payload.type!=='submit'||!['next','submit'].includes(payload.kind)||!payload.valid)return;
    let states;
    if(info.indices.length===record.questions.length){
      states=new Map([...record.frames].map(([owner,entry])=>[owner,entry.indices.length?payload:{valid:true,answers:[]}]));
    }else if(this.pendingAuto?.record===record){
      states=new Map(this.pendingAuto.states);states.set(frame,payload);
      if([...record.frames].some(([owner,entry])=>entry.indices.length&&entry.state?.revision!==states.get(owner)?.revision))states=null;
    }
    this.pendingAuto=null;if(!states)return;
    const answers=this.stateAnswers(record,states);if(!answers)return;
    this.sequence++;this.grade=null;record.submitted={sequence:this.sequence,kind:payload.kind,questions:record.questions.map((question,index)=>packQuestion(question,answers[index]))};
  }
  observeFeedback(feedback){
    if(!feedback?.summary)return;
    if(feedback.failed){this.rejectFeedback();return;}
    const record=this.current;
    if(!record?.submitted||record.navigationKey&&feedback.navigationKey&&record.navigationKey!==feedback.navigationKey)return;
    if(feedback.pageURL&&feedback.pageURL!==record.pageURL&&(!record.navigationKey||record.navigationKey!==feedback.navigationKey))return;
    this.grade={feedback,sequence:this.sequence};
  }
  capturedAnswers(snapshot,kind){
    const record=this.current;
    if(this.closed||this.invalid||record?.signature!==snapshot.signature||record.submitted?.kind!==kind||capturePageIdentity(record.questions)!==capturePageIdentity(snapshot.questions))return null;
    return record.submitted.questions.map(question=>[...question.answer]);
  }
  rejectFeedback(){this.grade=null;for(const record of this.pages)record.submitted=null;if(this.pages.length>1)this.invalid=true;}
  async reset(){
    for(const record of this.pages)for(const frame of record.frames.keys())await frame.evaluate(disposeCapture,{id:record.id}).catch(()=>{});
    this.pages=[];this.current=null;this.grade=null;this.pendingAuto=null;this.invalid=false;
  }
  bundle(){
    if(this.closed||this.invalid||!this.pages.length||this.pages.some(page=>!page.submitted)||this.grade?.sequence!==this.sequence)return {reason:'未完整捕获整题各页的实际提交答案'};
    const pages=this.pages.map((page,index)=>({number:index+1,questions:page.submitted.questions})),verification=fullCorrectProof(this.grade.feedback,pages);
    if(!verification)return {reason:'平台未明确确认整题全部正确，或评分范围与记录不一致'};
    const imageAssets=[...new Map(this.pages.flatMap(page=>page.questions.flatMap(q=>(q.images||[]).map(({digest,mimeType,width,height,dataURL})=>[digest,{digest,mimeType,width,height,dataURL}])))).values()];
    return {exercise:Core.validateExercise({kind:'exercise',version:1,title:this.title,scope:this.scope,courseTitle:this.courseTitle,unitLabel:this.unitLabel,pages,verification,learnedAt:Date.now(),...(imageAssets.length?{imageAssets}:{})})};
  }
  async dispose(){await this.reset();this.closed=true;bridges.get(this.page)?.sessions.delete(this.id);}
}
