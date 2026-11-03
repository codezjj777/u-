import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {prepareTextAnswer,readInputRestrictionFromDOM,fillQuestion,verifyQuestion,TextInputError} from '../answer-writer.mjs';
import {Automation} from '../automation.mjs';

test('English layout punctuation becomes ordinary punctuation without deleting sentence content',()=>{
  const question={type:'text',targets:[{kind:'text'}]},answer={source:'AI',answers:['HSR connects Shanghai–Beijing; China’s “super‑fast” trains save time…\u00a0Next.']};
  const result=prepareTextAnswer(question,answer);assert.deepEqual(result.answer.answers,['HSR connects Shanghai-Beijing; China\'s "super-fast" trains save time... Next.']);assert.equal(result.changed,7);assert.ok(answer.answers[0].includes('–'));assert.equal(prepareTextAnswer(question,result.answer).changed,0);
});

test('letters, non-Latin writing, mathematical minus and joining characters retain their meaning',()=>{
  const value='café 中文 α β x − y ≥ 0 √2 90° می\u200cروم 👩\u200d🔬\nSecond paragraph.';
  const answer={answers:[value]},result=prepareTextAnswer({type:'text',targets:[{kind:'text'}]},answer);assert.equal(result.answer,answer);assert.equal(result.changed,0);
});

test('exact choices, dropdown labels and platform-verified whole-exercise answers retain their punctuation',()=>{
  const value='Shanghai–Beijing';
  for(const question of [{type:'single'},{type:'matching'},{type:'text',targets:[{kind:'select'}]},{type:'text',targets:[{kind:'unipus-select'}]},{type:'text',targets:[{kind:'text',choices:[{text:value,value}]}]}])assert.equal(prepareTextAnswer(question,{answers:[value]}).changed,0);
  assert.equal(prepareTextAnswer({type:'text',targets:[{kind:'text'}]},{source:'整题题库',answers:[value]}).changed,0);
});

test('direct fill and later verification agree on the same ordinary punctuation',async()=>{
  let value='';const frame={locator:()=>({fill:async text=>{value=text;},inputValue:async()=>value})},question={type:'text',targets:[{kind:'text',selector:'one'}]},answer={source:'AI',answers:['China’s Shanghai–Beijing line.']};
  await fillQuestion(frame,question,answer);assert.equal(value,"China's Shanghai-Beijing line.");await verifyQuestion(frame,question,answer);
  await fillQuestion(frame,question,answer,{textPrepared:true});assert.equal(value,answer.answers[0]);await verifyQuestion(frame,question,answer,{textPrepared:true});
});

test('normalization never silently truncates a response to a native maxlength',async()=>{
  let writes=0;const frame={locator:()=>({getAttribute:async()=> '5',fill:async()=>writes++})};
  await assert.rejects(fillQuestion(frame,{type:'text',targets:[{kind:'text',selector:'one'}]},{answers:['A long answer.']}),error=>error instanceof TextInputError&&error.code==='TEXT_INPUT_TOO_LONG');assert.equal(writes,0);
});

function dom(html){const {window,document}=parseHTML('<html><body>'+html+'</body></html>');globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible',display:'block'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};return document;}

test('only the visible special-character validation dialog can supply an acknowledgement target',()=>{
  const document=dom('<section role="dialog"><p>是否提交？</p><button>我知道了</button></section><div hidden role="dialog"><p>不支持输入特殊字符哦</p><button>我知道了</button></div><div role="dialog"><p>不支持输入特殊字符哦</p><button id="ack">我知道了</button></div>');
  const notice=readInputRestrictionFromDOM();assert.equal(notice.count,1);assert.equal(document.querySelector(notice.selector).id,'ack');assert.equal(document.querySelectorAll('[data-ustudy-input-confirm]').length,1);
  dom('<p>不支持输入特殊字符哦</p><button>我知道了</button>');assert.equal(readInputRestrictionFromDOM(),null);
  dom('<div role="dialog"><p>不支持输入特殊字符哦</p><button>我知道了</button></div><div role="dialog"><p>不支持输入特殊字符哦</p><button>我知道了</button></div>');assert.equal(readInputRestrictionFromDOM().selector,null);
});

test('unsupported characters yield retained manual review instead of a failed or skippable task',async()=>{
  const task={id:'input-review',status:'running',answered:0,pages:0,logs:[]},url='https://ucontent.unipus.cn/offline-recognition/text-input',store={data:{tasks:[task],bank:[]},changed(){},addLog(task,message){task.logs.push({message});}},engine=new Automation(store);
  const snapshot={pageURL:url,signature:'same',frame:{},questions:[{type:'text',question:'Explain.',options:[],targets:[{kind:'text',selector:'one'}]}]};
  engine.waitQuestions=async()=>snapshot;engine.askModel=async()=>({source:'AI',answers:['Meaningful α text.']});engine.fillQuestion=async()=>{throw new TextInputError('U校园仍拒绝第 1 个作答项中的字符。');};engine.action=async()=>assert.fail('input validation must prevent submission');
  const result=await engine.answerEntryAttempt(task,{url:()=>url},{aiEnabled:true,autoSubmit:true},new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/第 1 题.*拒绝.*已保留当前页/);assert.equal(task.answered,0);assert.equal(store.data.bank.length,0);
});
