import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceRoleplay} from '../roleplay-flow.mjs';
const turn=(phase,index=0,completed=[])=>({binding:'lesson',dialogueKey:'full-dialogue',role:'A',phase,turn:index,total:2,completed});
async function run(states,options={}){
  // Positive sequences must tolerate Windows timer scheduling under load.
  // Timeout-specific cases supply their own shorter deadline below.
  const actions=[];let index=0;const result=await advanceRoleplay({initial:{binding:'lesson'},read:async()=>states[Math.min(index++,states.length-1)],choose:async()=>actions.push('choose A'),start:async()=>actions.push('start'),stop:async current=>actions.push('stop '+current.turn),pollMs:1,stepTimeoutMs:300,totalTimeoutMs:2000,...options});return {result,actions};
}
test('roleplay chooses A once, starts once and stops only each new recording before accepting all saved turns',async()=>{
  const {result,actions}=await run([{binding:'lesson',phase:'choose'},turn('ready'),turn('partner'),turn('recording',0),turn('recording',0),turn('saving',0),turn('partner',1,[0]),turn('recording',1,[0]),turn('completed',1,[0,1])]);
  assert.deepEqual(actions,['choose A','start','stop 0','stop 1']);assert.deepEqual(result,{total:2,stops:2});
});
test('an already completed dialogue is accepted without selecting, starting or recording again',async()=>{
  const {result,actions}=await run([turn('completed',1,[0,1])]);assert.deepEqual(actions,[]);assert.equal(result.total,2);
});

test('choosing A waits through stale chooser frames and loading without choosing or starting twice',async()=>{
  const choose={binding:'lesson',phase:'choose'};
  const {result,actions}=await run([choose,choose,choose,{binding:'lesson',phase:'loading'},choose,turn('ready'),turn('recording',0),turn('recording',1,[0]),turn('completed',1,[0,1])]);
  assert.equal(result.total,2);assert.deepEqual(actions,['choose A','start','stop 0','stop 1']);
});

test('a chooser that never transitions times out without a second click or recording',async()=>{
  let clicks=0;
  await assert.rejects(run([{binding:'lesson',phase:'choose'}],{choiceTimeoutMs:8,choose:async()=>{clicks++;},start:async()=>assert.fail('must not record')}),/角色选择后.*超时/);
  assert.equal(clicks,1);
});

test('a true return to choosing after recording started still stops instead of clearing saved progress',async()=>{
  const actions=[];
  await assert.rejects(run([{binding:'lesson',phase:'choose'},turn('ready'),turn('recording',0),{binding:'lesson',phase:'choose'}],{choose:async()=>actions.push('choose'),start:async()=>actions.push('start'),stop:async()=>actions.push('stop')}),/退回.*角色选择/);
  assert.deepEqual(actions,['choose','start','stop']);
});
test('wrong roles, a changed lesson, changed dialogue and incomplete completion all stop without additional clicks',async()=>{
  for(const states of [[{...turn('ready'),role:'B'}],[{...turn('ready'),binding:'another'}],[turn('ready'),{...turn('partner'),dialogueKey:'changed'}],[turn('completed',1,[0])]])await assert.rejects(run(states),error=>error.code==='ROLEPLAY_REVIEW');
});
test('a stuck recording does not receive repeated stop clicks or a second start',async()=>{
  const actions=[];await assert.rejects(run([turn('recording')],{stop:async current=>actions.push(current.turn),stepTimeoutMs:10}),/超时/);assert.deepEqual(actions,[0]);
});
test('cancellation before choosing a role never clicks any course control',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(run([{binding:'lesson',phase:'choose'}],{signal:controller.signal,choose:async()=>assert.fail('must not click')}),{name:'AbortError'});
});

test('partner playback advancing in the same row resets the idle timeout',async()=>{
  let ticks=0;const reports=[];
  const {result}=await run([],{stepTimeoutMs:8,read:async()=>{
    await new Promise(resolve=>setTimeout(resolve,2));ticks++;
    return ticks>12?turn('completed',1,[0,1]):{...turn('partner'),rowIndex:3,partnerAudio:{time:ticks,paused:false,ended:false}};
  },onProgress:current=>reports.push(current.phase)});
  assert.equal(result.total,2);assert.ok(reports.includes('partner'));
});

test('an unchanged paused partner is resumed once and never starts the entire dialogue again',async()=>{
  let calls=0;const state={...turn('partner',-1,[0]),rowIndex:1,partnerSelector:'audio',partnerAudio:{time:2,paused:true,ended:false}};
  await assert.rejects(run([state],{partnerResumeMs:2,stepTimeoutMs:15,resumePartner:async()=>{calls++;},start:async()=>assert.fail('must not reset the dialogue')}),/超时/);
  assert.equal(calls,1);
});
