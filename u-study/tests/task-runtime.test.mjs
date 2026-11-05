import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {TaskRuntime} from '../task-runtime.mjs';

function fixture(status='review'){
  const task={id:'cancel-reason',status,logs:[]},notices=[],store={data:{tasks:[task]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});},notice(message){notices.push(message);}};
  return {task,notices,runtime:new TaskRuntime(store)};
}
test('closing the browser during review preserves the actual abort reason instead of the timer generic English error',async()=>{
  const {runtime,task,notices}=fixture(),controller=new AbortController();let entered;
  const started=new Promise(resolve=>entered=resolve),pending=runtime.start(task,controller,async()=>{entered();await runtime.gate(task,controller.signal);});
  await started;controller.abort(new Error('登录窗口已关闭。'));await pending;
  assert.equal(task.status,'failed');assert.equal(task.logs.at(-1).message,'登录窗口已关闭。');assert.match(notices[0],/登录窗口已关闭/);assert.equal(runtime.busy(),false);
});
test('a combined operation signal retains its timeout reason when the task controller itself was not aborted',async()=>{
  const {runtime,task}=fixture('running'),controller=new AbortController(),operation=new AbortController();let entered;
  const started=new Promise(resolve=>entered=resolve),pending=runtime.start(task,controller,async()=>{entered();await sleep(10000,undefined,{signal:AbortSignal.any([controller.signal,operation.signal])});});
  await started;operation.abort(new Error('操作超时，已取消，请检查课程窗口后重试。'));await pending;
  assert.equal(controller.signal.aborted,false);assert.match(task.logs.at(-1).message,/操作超时/);assert.doesNotMatch(task.logs.at(-1).message,/operation was aborted/);
});
test('a default unclassified abort has a Chinese recovery message while an explicit stop remains stopped',async()=>{
  for(const explicitStop of [false,true]){
    const {runtime,task,notices}=fixture(),controller=new AbortController();let entered;
    const started=new Promise(resolve=>entered=resolve),pending=runtime.start(task,controller,async()=>{entered();await runtime.gate(task,controller.signal);});await started;
    if(explicitStop)runtime.control(task.id,'stop');else controller.abort();await pending;
    if(explicitStop){assert.equal(task.status,'stopped');assert.equal(notices.length,0);assert.equal(task.logs.some(log=>log.level==='error'),false);}
    else{assert.equal(task.status,'failed');assert.match(task.logs.at(-1).message,/已取消/);assert.doesNotMatch(task.logs.at(-1).message,/aborted/i);}
  }
});
