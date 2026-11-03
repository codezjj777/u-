import test from 'node:test';
import assert from 'node:assert/strict';
import {Automation} from '../automation.mjs';

function setup({kind='text',count=4,total=4,objective=4,subjective=0,unchanged=false}={}){
  const url='https://ucontent.unipus.cn/offline-recognition/outline-correction';
  const navigation={known:true,key:JSON.stringify([['Test Book','Test Unit','Getting the idea'],'Getting the idea','Exercise 1']),title:'Exercise 1'};
  const task={id:'outline-correction',entryKey:JSON.stringify(['unit',['Getting the idea'],'Exercise 1']),status:'running',logs:[],answered:0,pages:0};
  const store={directory:'.cache',apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}};
  const engine=new Automation(store),page={url:()=>url},frame={url:()=>url};
  const choices=Array.from({length:count},(_,i)=>({text:'option '+i,value:'option '+i}));
  const question=kind==='matching'?{question:'Match all pairs.',type:'matching',options:choices.map(choice=>choice.text),prompts:choices.map((_,i)=>'Prompt '+i),targets:[{kind:'sortable'}]}:{question:'Complete all numbered blanks.',type:'text',options:[],context:'Synthetic reading material.',targets:choices.map((_,i)=>({selector:'#blank-'+i,kind,...(['select','unipus-select'].includes(kind)?{choices}:{})}))};
  const snapshot={frame,pageURL:url,frameURL:url,signature:'complete-outline',navigation,questions:[question]};
  const failed={summary:true,failed:true,total,objective,subjective,correct:Math.max(0,objective-2),incorrect:Math.min(2,objective),pageURL:url,frameURL:url,frame,navigationKey:navigation.key};
  const actions=[],corrections=[],filled=[];let submissions=0;
  engine.waitQuestions=async()=>snapshot;
  engine.askModel=async(_question,_settings,_key,_signal,options)=>{corrections.push(options?.correction);return {source:'AI',answers:Array.from({length:count},(_,i)=>(unchanged||corrections.length===1?'old ':'rechecked ')+i)};};
  engine.fillQuestion=async(_frame,_question,answer)=>filled.push(answer.answers);
  engine.verifyQuestion=async()=>{};
  engine.action=async(_frame,kind)=>{actions.push(kind);return true;};
  engine.readExerciseFeedback=async()=>failed;
  engine.waitSubmissionFeedback=async()=>++submissions===1?failed:{...failed,failed:false,correct:objective,incorrect:0};
  return {engine,task,store,page,snapshot,failed,actions,corrections,filled,run:()=>engine.answerEntry(task,page,{aiEnabled:true,autoSubmit:true},new AbortController().signal)};
}

for(const kind of ['text','select','unipus-select','editable','matching'])test(`a full ${kind} group can correct four objectively graded answer parts`,async()=>{
  const f=setup({kind}),result=await f.run();
  assert.equal(result.feedback.failed,false);assert.equal(result.review,undefined);assert.deepEqual(f.actions,['submit','revise','submit']);
  assert.equal(f.filled.length,2);assert.equal(f.corrections.length,2);assert.deepEqual(f.corrections[1].previousAnswers,f.filled[0]);assert.match(f.corrections[1].feedback,/客观题 4 道，正确 2 道，错误 2 道/);
  assert.deepEqual(f.filled[1],['rechecked 0','rechecked 1','rechecked 2','rechecked 3']);assert.equal(f.store.data.bank.length,0);
});

test('the platform may grade a multi-blank group as one question',async()=>{
  const f=setup({total:1,objective:1}),result=await f.run();assert.equal(result.feedback.failed,false);assert.deepEqual(f.actions,['submit','revise','submit']);
});

test('objective plus subjective counts can establish coverage when the total label is missing',async()=>{
  const f=setup({total:null}),result=await f.run();assert.equal(result.feedback.failed,false);assert.deepEqual(f.actions,['submit','revise','submit']);
});

for(const feedback of [{total:8,objective:4,subjective:4},{total:4,objective:4,subjective:1},{total:null,objective:4,subjective:null}])test(`incomplete or inconsistent grading coverage still blocks correction: ${JSON.stringify(feedback)}`,async()=>{
  const f=setup(feedback),result=await f.run();assert.equal(result.review,true);assert.match(result.message,/尚不能对应小结中的全部题目/);assert.deepEqual(f.actions,['submit','revise']);assert.equal(f.corrections.length,1);assert.equal(f.filled.length,1);
});

test('one writing field cannot stand in for the four missing objective questions',async()=>{
  const f=setup({count:1}),result=await f.run();assert.equal(result.review,true);assert.match(result.message,/1 组题、1 个作答项/);assert.deepEqual(f.actions,['submit','revise']);assert.equal(f.filled.length,1);
});

test('unchanged rechecked blanks are never written or submitted again',async()=>{
  const f=setup({unchanged:true}),result=await f.run();assert.equal(result.review,true);assert.match(result.message,/停止重复提交/);assert.deepEqual(f.actions,['submit','revise']);assert.equal(f.corrections.length,2);assert.equal(f.filled.length,1);
});

test('a supported correction that only changes capitalization is not mistaken for the same submitted answer',async()=>{
  const f=setup({count:1,total:1,objective:1});let calls=0;
  f.engine.askModel=async()=>({source:'AI',answers:[++calls===1?'china':'China']});
  const result=await f.run();assert.equal(result.feedback.failed,false);assert.equal(calls,2);assert.deepEqual(f.filled,[['china'],['China']]);assert.deepEqual(f.actions,['submit','revise','submit']);
});

test('changing the active result tab blocks revise even when the URL is identical',async()=>{
  const f=setup();f.engine.readExerciseFeedback=async()=>({...f.failed,navigationKey:'different-result'});const result=await f.run();assert.equal(result.review,true);assert.match(result.message,/小结已变化/);assert.deepEqual(f.actions,['submit']);
});

test('returning to another activity or to a non-question view does not start correction',async()=>{
  for(const next of [{...setup().snapshot,navigation:{known:true,key:'different-exercise'}},{videoView:{ready:true}},{summaryFeedback:{summary:true}}]){
    const f=setup();let revised=false;f.engine.action=async(_frame,kind)=>{f.actions.push(kind);revised||=kind==='revise';return true;};f.engine.waitQuestions=async()=>revised?next:f.snapshot;
    const result=await f.run();assert.equal(result.review,true);assert.deepEqual(f.actions,['submit','revise']);assert.equal(f.filled.length,1);
  }
});
