import {setTimeout as sleep} from 'node:timers/promises';
import {resolveAnswer} from './shared/core.mjs';

function plan(question,answer){
  const target=question.targets?.[0],resolved=resolveAnswer(question,{answer:answer.answers});
  if(question.targets?.length!==1||target?.kind!=='sortable'||!target.itemSelector||target.items?.length!==question.options.length||!resolved||answer.ordered!==true||JSON.stringify(resolved.indexes)!==JSON.stringify(answer.indexes)||target.items.some((item,i)=>!item.selector||item.text!==question.options[i])||new Set(target.items.map(item=>item.key)).size!==target.items.length)throw new Error('配对答案必须完整、唯一，并与全部左侧项目一一对应。');
  return {target,keys:resolved.indexes.map(i=>target.items[i].key)};
}

const padding='[\\s\\u200b-\\u200d\\ufeff]*';
const escapedText=value=>[...value].map(char=>/\s/.test(char)?padding:char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+padding).join('');
const optionPattern=text=>new RegExp('^'+padding+'(?:[A-Za-z][.、．)）:]?'+padding+')?'+escapedText(text)+'$');
const cardsCSS='.sequence-reply-view-item-text:not(.sortable-helper,.ui-sortable-helper,.sortable-helper *,.ui-sortable-helper *)';

function scope(frame,question,target){
  let root=frame.locator(target.rootSelector||'.sequence-view');
  for(const prompt of question.prompts){
    const row=new RegExp('^'+padding+'(?:\\d+'+padding+'[.、．)）:]?'+padding+')?'+escapedText(prompt)+'$');
    root=root.filter({has:frame.locator('*:visible').filter({hasText:row})});
  }
  let container=root.locator('.sortable-list-wrapper:visible');
  for(const text of question.options)container=container.filter({hasText:new RegExp(escapedText(text))});
  const card=item=>container.locator(cardsCSS+':visible').filter({hasText:optionPattern(item.text)});
  return {container,card};
}

async function order(locators,target,{geometry=false}={}){
  if(await locators.container.count()!==1)throw new Error('配对题的完整句子或拖动容器已变化，已停止。');
  // Read authored text again, not temporary data-* marks: React does not
  // preserve those marks when it renders a new card or container.
  const cards=await locators.container.locator(cardsCSS+':visible').evaluateAll(items=>items.map(item=>{const box=item.getBoundingClientRect();return {text:item.innerText||item.textContent,box:[box.x,box.y,box.width,box.height].map(value=>Math.round(value*10)/10)};}));
  const patterns=target.items.map(item=>optionPattern(item.text));
  const keys=cards.map(({text})=>{const matches=patterns.flatMap((pattern,i)=>pattern.test(text)?[target.items[i].key]:[]);return matches.length===1?matches[0]:null;});
  if(keys.length!==target.items.length||new Set(keys).size!==keys.length||keys.some(key=>!target.items.some(item=>item.key===key)))throw new Error('配对选项未完整载入或发生变化，已停止。');
  return geometry?{keys,fingerprint:JSON.stringify([keys,cards.map(card=>card.box)])}:keys;
}

const checker=({signal,checkpoint=async()=>{}})=>async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};

async function settledOrder(locators,target,check,signal){
  let previous='',stableReads=0;
  // Count observations rather than wall time: pausing at a checkpoint must
  // not exhaust the settle window before the user resumes the task.
  for(let sample=0;sample<24;sample++){
    await check();const current=await order(locators,target,{geometry:true});
    if(current.fingerprint!==previous){previous=current.fingerprint;stableReads=1;}
    else stableReads++;
    if(stableReads>=4)return current.keys;
    await sleep(80,undefined,{signal});
  }
  throw new Error('配对题的顺序或卡片位置持续变化，尚未确认稳定，已停止提交。');
}
const orderMismatch=()=>Object.assign(new Error('配对题最终顺序与答案不一致或被页面回退，已停止提交。'),{code:'MATCHING_ORDER_CHANGED'});

async function boxFor(locator,{signal,scroll=false}={}){
  // A scroll handler can replace the node between Playwright resolving it and
  // measuring it. Retry the content locator briefly before starting a gesture.
  for(let attempt=0;attempt<3;attempt++){
    signal?.throwIfAborted();if(scroll)await locator.scrollIntoViewIfNeeded({timeout:5000});
    const box=await locator.boundingBox();if(box)return box;
    await sleep(60,undefined,{signal});
  }
  throw new Error('配对选项目前不可见。');
}

export async function verifyMatching(frame,question,answer,options={}){
  const {target,keys}=plan(question,answer),check=checker(options),locators=scope(frame,question,target);
  // Read after the sortable library has committed its state, including a
  // re-render. A transient DOM move is not a successfully written answer.
  if(JSON.stringify(await settledOrder(locators,target,check,options.signal))!==JSON.stringify(keys))throw orderMismatch();
  await sleep(250,undefined,{signal:options.signal});await check();
  if(JSON.stringify(await order(locators,target))!==JSON.stringify(keys))throw orderMismatch();
}

async function dragBefore(frame,source,destination,{signal,attempt}){
  const mouse=frame.page().mouse;
  const sourceBox=await boxFor(source,{signal,scroll:true});
  const destinationBox=await boxFor(destination,{signal});
  const destinationInView=await destination.evaluate(el=>{
    const box=el.getBoundingClientRect();let top=0,bottom=innerHeight,left=0,right=innerWidth;
    for(let parent=el.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}}
    return box.top>=top&&box.bottom<=bottom&&box.left>=left&&box.right<=right;
  });
  const html5=await source.evaluate(el=>!!el.closest('[draggable="true"]'));
  if(html5){
    if(!destinationInView)await destination.scrollIntoViewIfNeeded({timeout:5000});signal?.throwIfAborted();
    const box=destinationInView?destinationBox:await boxFor(destination,{signal});
    try{await source.dragTo(destination,{timeout:5000,targetPosition:{x:Math.max(1,box.width/2),y:Math.max(1,box.height*(attempt?0.1:0.35))}});}
    finally{await mouse.up().catch(()=>{});}
    return;
  }
  // react-sortable-hoc uses a press delay and a movement sensor. Perform the
  // complete gesture through browser input; never rearrange DOM nodes or call
  // private framework handlers. Finish/release before a pause checkpoint.
  try{
    // Keep the same top-edge grab offset on both cards. Center-to-top drops
    // shift a taller card past the intended slot when sentence heights differ.
    const grabY=Math.max(2,Math.min(attempt?7:12,sourceBox.height/3,destinationBox.height/3));
    await mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+grabY);await mouse.down();
    await sleep(200,undefined,{signal});
    await mouse.move(sourceBox.x+sourceBox.width/2+6,sourceBox.y+grabY,{steps:3});
    // Usually both columns are already visible. Use the pre-press slot so a
    // sortable's animated transforms do not move the drop point underneath us.
    if(!destinationInView)await destination.scrollIntoViewIfNeeded({timeout:5000});signal?.throwIfAborted();
    const box=destinationInView?destinationBox:await boxFor(destination,{signal});
    if(!destinationInView){
      const translation=await destination.evaluate(el=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(el).transform);return matrix.a===1&&matrix.b===0&&matrix.c===0&&matrix.d===1?{x:matrix.e,y:matrix.f}:{x:0,y:0};});
      box.x-=translation.x;box.y-=translation.y;
    }
    await mouse.move(box.x+box.width/2,box.y+Math.min(grabY,box.height/3),{steps:18});
    await sleep(180,undefined,{signal});
  }finally{await mouse.up().catch(()=>{});}
}

export async function fillMatching(frame,question,answer,options={}){
  const {target,keys}=plan(question,answer),check=checker(options),locators=scope(frame,question,target);
  const visits=new Map(),maxMoves=keys.length*3,prefix=current=>{const index=current.findIndex((key,i)=>key!==keys[i]);return index<0?keys.length:index;};
  let lastPrefix=0,moves=0;
  for(let round=0;round<maxMoves+3;round++){
    const current=await settledOrder(locators,target,check,options.signal),position=prefix(current);
    if(position<lastPrefix)await options.onRecovery?.({moves,maxMoves,position});
    lastPrefix=position;
    if(position===keys.length){
      try{await verifyMatching(frame,question,answer,options);return;}
      catch(error){if(error.code!=='MATCHING_ORDER_CHANGED')throw error;await options.onRecovery?.({moves,maxMoves,position:0});continue;}
    }
    const state=JSON.stringify(current),attempt=visits.get(state)||0;
    if(attempt>=2||moves>=maxMoves)throw new Error('配对顺序反复回退或页面未确认拖动结果，已停止，尚未提交。');
    visits.set(state,attempt+1);
    const wanted=target.items.find(item=>item.key===keys[position]),displaced=target.items.find(item=>item.key===current[position]);
    const source=locators.card(wanted),destination=locators.card(displaced);
    if(await source.count()!==1||await destination.count()!==1)throw new Error('配对选项定位已变化，已停止。');
    try{await dragBefore(frame,source,destination,{signal:options.signal,attempt});moves++;}
    catch(error){options.signal?.throwIfAborted();await check();throw new Error('配对选项在拖动时被页面替换或暂时不可见，尚未提交，请保留页面重新核对。',{cause:error});}
    // Reconcile the complete committed order on the next pass. A late React
    // update or a displaced drop can invalidate any earlier prefix.
  }
  throw new Error('配对题多次复核仍未稳定，已达到重试上限，尚未提交。');
}
