import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {askModel} from '../answer-provider.mjs';
import * as Core from '../shared/core.mjs';
import {bankedClozeHTML,bankedClozeDirections,bankedClozeAnswers,bankedClozeWordAnswers} from './fixtures/banked-cloze.mjs';

export async function bankedClozeBrowserCases(t,context,root){
  for(const mode of ['letters','words','repair','table','table-repair'])await t.test(`banked cloze ${mode}: shared Directions reach the provider and all ten uppercase letters are filled and submitted once`,async()=>{
    const page=await context.newPage(),store=await new Store(path.join(root,'banked-cloze-'+mode),{env:{}}).load();
    try{
      await page.goto('https://ucontent.unipus.cn/offline-recognition/banked-cloze');await page.setContent(bankedClozeHTML({captions:mode==='words',tableBank:mode.startsWith('table')}));
      const task={id:'banked-cloze-'+mode,status:'running',courseId:'cloze-book',unitId:'cloze-unit',entryKey:JSON.stringify(['cloze-unit',['Language in focus'],'Banked cloze']),currentEntry:'Language in focus / Banked cloze',logs:[],answered:0,pages:0,manualItems:[]};
      store.data.tasks=[task];store.apiKey='fixture-key';const engine=new Automation(store);engine.pages.attach(context);engine.pages.track(page,'lesson',{taskId:task.id});engine.taskPages.set(task.id,page);
      let calls=0;engine.askModel=(question,_settings,key,signal,options={})=>askModel(question,{endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture'},key,signal,{...options,retryDelayMs:0,fetchImpl:async(_url,request)=>{
        assert.equal(await page.evaluate(()=>window.inputWrites),0,'all generated answers are validated before any field write');
        const body=JSON.parse(request.body),payload=JSON.parse(body.messages[1].content);assert.equal(payload.directions,'Directions: '+bankedClozeDirections);assert.equal(payload.answerRequirements.allowReuse,false);assert.equal(payload.blankCount,10);
        calls++;const answers=mode.endsWith('repair')&&calls===1?Array(10).fill('E'):mode==='words'?bankedClozeWordAnswers:bankedClozeAnswers;
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers})}}]}));
      }});
      const gate=engine.gate.bind(engine);engine.gate=async(task,signal)=>{assert.notEqual(task.status,'review',JSON.stringify(task.logs));return gate(task,signal);};
      const settings={aiEnabled:true,autoSubmit:true};await engine.beginExerciseLearning(task,page,settings);
      const snapshot=await engine.readQuestions(page,{}),result=await engine.answerEntryAttempt(task,page,settings,new AbortController().signal);
      assert.equal(result.feedback?.summary,true,JSON.stringify(task.logs));assert.equal(calls,mode.endsWith('repair')?2:1);assert.equal(task.answered,1);assert.equal(task.pages,1);assert.deepEqual(await page.evaluate(()=>window.submissions),[bankedClozeAnswers]);assert.equal(await page.evaluate(()=>window.inputWrites),10);
      assert.ok(task.logs.some(log=>/已读取.*题目要求.*大写字母/.test(log.message)));
      const learning=engine.learningSessions.get(task.id);learning.observeFeedback(result.feedback);const bundle=learning.bundle();assert.ok(bundle.exercise,bundle.reason);await store.learnVerifiedExercise(bundle.exercise);
      const learned=store.data.bank.find(row=>row.kind==='exercise'&&row.scope?.entryKey===task.entryKey);assert.ok(learned,'only the all-correct exercise is learned');assert.equal(learned.pages[0].questions[0].directions,'Directions: '+bankedClozeDirections);assert.deepEqual(learned.pages[0].questions[0].answer,bankedClozeAnswers);
      assert.deepEqual(Core.matchExercisePage(snapshot.questions,{courseId:task.courseId,unitId:task.unitId,entryKey:task.entryKey},Core.buildBankIndex([learned]))[0].answers,bankedClozeAnswers);
      await engine.disposeExerciseLearning(task.id);
    }finally{await page.close();await store.flush();}
  });
}
