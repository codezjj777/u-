import {setTimeout as sleep} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {fillMatching,verifyMatching} from './matching-writer.mjs';

const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const inputPunctuation=new Map([
  ...[...'‐‑‒–—―﹘﹣－'].map(value=>[value,'-']),
  ...[...'‘’‚‛'].map(value=>[value,"'"]),
  ...[...'“”„‟'].map(value=>[value,'"']),
  ['…','...'],['\u00a0',' '],['\u202f',' '],['\u2007',' ']
]);
export function prepareTextAnswer(question,answer){
  if(question.type!=='text'||answer.source==='整题题库'||!Array.isArray(answer.answers))return {answer,changed:0};
  let changed=0;
  const answers=answer.answers.map((value,i)=>{
    const target=question.targets?.[i];
    if(typeof value!=='string'||['select','unipus-select'].includes(target?.kind)||target?.choices?.length)return value;
    return value.replace(/[\u2010-\u2015\ufe58\ufe63\uff0d\u2018-\u201f\u2026\u00a0\u202f\u2007]/g,character=>{const replacement=inputPunctuation.get(character);if(replacement===undefined)return character;changed++;return replacement;});
  });
  return {answer:changed?{...answer,answers}:answer,changed};
}

export class TextInputError extends Error{
  constructor(message,{fieldIndex,code='TEXT_INPUT_REJECTED'}={}){super(message);this.name='TextInputError';this.code=code;this.fieldIndex=fieldIndex;}
}

// Acknowledge only the known input-validation dialog, never a generic course
// confirmation, login prompt or submit button that happens to say "I know".
export function readInputRestrictionFromDOM(){
  const visible=el=>{if(!el?.getClientRects().length)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true]')||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  const text=el=>String(el.innerText||el.textContent||el.value||'').replace(/\s+/g,'').trim();
  const scopes=[...document.querySelectorAll('dialog,[role=dialog],[role=alertdialog],.ant-modal,.el-message-box')].filter(visible);
  const matches=scopes.filter(scope=>[scope,...scope.querySelectorAll('div,p,span,[role=alert]')].some(el=>visible(el)&&/^不支持输入特殊字符(?:哦)?[！!。.]*$/.test(text(el))));
  const dialogs=matches.filter(scope=>!matches.some(other=>other!==scope&&scope.contains(other)));
  if(!dialogs.length)return null;
  if(dialogs.length!==1)return {kind:'input-character-restriction',count:dialogs.length,selector:null};
  const buttons=[...dialogs[0].querySelectorAll('button,[role=button],input[type=button]')].filter(el=>visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled=true]')&&text(el)==='我知道了');
  document.querySelectorAll('[data-ustudy-input-confirm]').forEach(el=>el.removeAttribute('data-ustudy-input-confirm'));
  if(buttons.length===1)buttons[0].setAttribute('data-ustudy-input-confirm','true');
  return {kind:'input-character-restriction',count:1,selector:buttons.length===1?'[data-ustudy-input-confirm="true"]':null};
}
async function inputRestriction(frame){
  for(let current=frame,depth=0;current&&depth<8;current=current.parentFrame?.(),depth++){
    if(typeof current.evaluate!=='function')continue;
    const report=await current.evaluate(readInputRestrictionFromDOM,{});if(report?.kind==='input-character-restriction')return {frame:current,...report};
  }
  return null;
}
async function dismissInputRestriction(frame,check){
  const notice=await inputRestriction(frame);if(!notice)return false;
  if(notice.count!==1||!notice.selector)throw new TextInputError('U校园提示不支持特殊字符，但无法唯一定位确认按钮；已保留提示，请手动核对。');
  await check();const current=await inputRestriction(frame);
  if(!current)return true;
  if(current.frame!==notice.frame||current.count!==1||current.selector!==notice.selector)throw new TextInputError('U校园输入校验提示已变化，尚未继续填写。');
  await current.frame.locator(current.selector).click({timeout:3000});await check();
  for(let attempt=0;attempt<6;attempt++){if(!await inputRestriction(frame))return true;await sleep(60);await check();}
  throw new TextInputError('U校园输入校验提示未能关闭，已保留页面，请手动核对。');
}
async function rejectInputRestriction(frame,check,index){
  if(await dismissInputRestriction(frame,check))throw new TextInputError(`U校园仍拒绝第 ${index+1} 个作答项中的字符；已确认提示并保留草稿，尚未提交。`,{fieldIndex:index});
}
const selectedState=el=>{
  if(el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true'||el.classList.contains('selected')||el.classList.contains('is-checked')||!!el.querySelector('input:checked'))return true;
  const row=el.closest('[class*="strongListView"]');
  return [el,row].filter(Boolean).some(node=>String(node.className||'').split(/\s+/).filter(token=>!/unselected|deselected|notselected|unchecked|inactive/i.test(token)).some(token=>/ant-(?:radio|checkbox)-wrapper-checked|(?:^|[_-])(?:selected|active|checked|sele)(?:$|[_-])|(?:strongItem|option)(?:Selected|Select)(?:$|[_-])/i.test(token)));
};

// Public Unipus dropdown text and candidate labels; no React internals or keys.
const dropdownState=el=>{
  const clean=value=>String(value??'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
  if(!el.matches('.scoop-select-wrapper'))return null;
  const measurements=[...el.children].filter(node=>node.tagName==='DIV'&&node.style.visibility==='hidden'&&node.style.position==='absolute');
  const triggers=[...el.querySelectorAll('.ant-dropdown-trigger.user-answer')];
  if(measurements.length!==1||triggers.length!==1)return null;
  const trigger=triggers[0],labels=[...measurements[0].children].filter(node=>node.tagName==='I').map(node=>clean(node.textContent));
  if(trigger.matches('[disabled],[aria-disabled=true],.disabled')||labels.length<2||labels.some(value=>!value)||new Set(labels.map(value=>value.normalize('NFKC'))).size!==labels.length)return null;
  return {choices:labels.map(value=>({text:value,value})),value:trigger.classList.contains('empty')?'':clean(trigger.querySelector('.user-answer-text')?.textContent)};
};
async function readTextAnswer(locator,target){
  if(target.kind==='unipus-select'){
    const state=await locator.evaluate(dropdownState);
    if(!state||JSON.stringify(state.choices)!==JSON.stringify(target.choices))throw new Error('下拉框或候选选项已变化，已停止。');
    return state.value;
  }
  return target.kind==='editable'?locator.innerText():locator.inputValue();
}
async function fillDropdown(frame,locator,target,value,{signal,check,act}){
  const before=await readTextAnswer(locator,target);if(before===value)return;
  // Only the live, exercise-specific menu is eligible; hidden retained portals
  // and labels elsewhere in the document cannot become answer targets.
  const menuState=({choices,value,token,inspectOnly=false})=>{
    const clean=value=>String(value??'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const visible=el=>{if(!el.getClientRects().length)return false;const box=el.getBoundingClientRect();if(box.width<=0||box.height<=0)return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],.ant-dropdown-hidden')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
    const menus=[...document.querySelectorAll('.scoop-select-dropdown')].filter(visible);
    if(inspectOnly)return {open:menus.length>0};
    for(const el of document.querySelectorAll('[data-ustudy-dropdown-option="'+token+'"]'))el.removeAttribute('data-ustudy-dropdown-option');
    if(!menus.length)return {ready:false};
    if(menus.length!==1)return {error:'同时显示多个下拉菜单，无法确认答案归属。'};
    const options=[...menus[0].querySelectorAll('.select-option[role=menuitem]')].filter(visible),labels=options.map(el=>clean(el.querySelector('.ant-dropdown-menu-title-content')?.textContent||el.textContent));
    if(labels.length!==choices.length||new Set(labels).size!==labels.length||labels.some(label=>!choices.includes(label)))return {error:'展开的下拉菜单与当前空位候选项不一致，已停止。'};
    const found=options.filter((el,index)=>labels[index]===value&&!el.matches('[aria-disabled=true],[disabled],.ant-dropdown-menu-item-disabled'));
    if(found.length!==1)return {error:'下拉答案不存在、不唯一或不可选，已停止。'};
    found[0].setAttribute('data-ustudy-dropdown-option',token);return {ready:true};
  };
  const labels=target.choices.map(choice=>choice.text),token=randomUUID(),option=frame.locator('[data-ustudy-dropdown-option="'+token+'"]');
  try{
    if((await frame.evaluate(menuState,{inspectOnly:true})).open)throw new Error('已有展开的下拉菜单，请关闭菜单后重试。');
    await act(target.selector+' .ant-dropdown-trigger.user-answer',()=>locator.locator('.ant-dropdown-trigger.user-answer').click({timeout:5000}));
    let ready=false;
    for(let attempt=0;attempt<15;attempt++){
      await check();if(await readTextAnswer(locator,target)!==before)throw new Error('展开菜单时答案已被修改，已停止。');
      const state=await frame.evaluate(menuState,{choices:labels,value,token});if(state.error)throw new Error(state.error);if(state.ready){ready=true;break;}
      await sleep(100,undefined,{signal});
    }
    if(!ready)throw new Error('下拉菜单未能正常展开，已停止。');
    // Click exactly the option validated with the reader's normalization and
    // visibility rules. Raw hasText/ :visible could disagree during animation
    // or match a retained portal with aria-hidden or zero-width characters.
    await check();const fresh=await frame.evaluate(menuState,{choices:labels,value,token});
    if(fresh.error||!fresh.ready||await option.count()!==1)throw new Error(fresh.error||'下拉菜单中的答案已变化或不唯一，已停止。');
    await act('[data-ustudy-dropdown-option="'+token+'"]',()=>option.click({timeout:5000}));
    let stable=0;
    for(let attempt=0;attempt<15;attempt++){
      await check();stable=await readTextAnswer(locator,target)===value?stable+1:0;if(stable>=4)return;
      await sleep(100,undefined,{signal});
    }
    throw new Error('下拉答案未保存成功或被页面回退，已停止。');
  }finally{await option.evaluateAll(elements=>elements.forEach(el=>el.removeAttribute('data-ustudy-dropdown-option'))).catch(()=>{});}
}

/** Read every committed value again without changing the page. */
export async function verifyQuestion(frame,question,answer,{signal,checkpoint=async()=>{},textPrepared=false}={}){
  const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
  if(!textPrepared)answer=prepareTextAnswer(question,answer).answer;
  if(question.type==='matching')return verifyMatching(frame,question,answer,{signal,checkpoint});
  for(const [i,target] of question.targets.entries()){
    signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();
    const locator=frame.locator(target.selector);
    if(typeof locator.count==='function'&&await locator.count()!==1)throw new Error('作答控件已变化或不唯一，已停止。');
    if(question.type==='text'){
      await rejectInputRestriction(frame,check,i);
      const actual=await readTextAnswer(locator,target);
      const expected=target.kind==='select'?target.choices.find(choice=>choice.text===answer.answers[i])?.value:answer.answers[i];
      if(!(target.kind==='editable'?clean(actual)===clean(expected):actual===expected))throw new Error('复核时发现先前填写的答案已丢失或被修改，已停止提交。');
    }else{
      const actual=target.kind==='native'?(typeof locator.isChecked==='function'?await locator.isChecked():undefined):await locator.evaluate(target.kind==='unipus-choice'?el=>el.classList.contains('selected'):selectedState);
      if(actual!==undefined&&actual!==answer.indexes.includes(i))throw new Error('页面最终选中项与答案不一致，已停止。');
    }
  }
}

/**
 * Write one question, checking task ownership before every browser mutation.
 * @param {import('playwright-core').Frame} frame
 * @param {import('./shared/contracts.mjs').Question} question
 * @param {import('./shared/contracts.mjs').Answer} answer
 */
export async function fillQuestion(frame,question,answer,{signal,checkpoint=async()=>{},interact,onMatchingRecovery,textPrepared=false}={}){
  const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
  const act=async(selector,operation)=>{await check();return interact?interact(frame,selector,operation):operation();};
  if(!textPrepared)answer=prepareTextAnswer(question,answer).answer;
  if(!Array.isArray(question.targets)||!question.targets.length||!Array.isArray(answer.answers)||answer.answers.some(value=>typeof value!=='string'||!value.trim()))throw new Error('题目控件或答案格式无效，已停止。');
  if(question.type==='matching')return fillMatching(frame,question,answer,{signal,checkpoint,onRecovery:onMatchingRecovery});
  if(question.type==='text'){
    if(question.targets.length!==answer.answers.length)throw new Error('答案数量与页面空格数量不一致，已停止。');
    for(const [i,target] of question.targets.entries())if(['select','unipus-select'].includes(target.kind)&&target.choices?.filter(choice=>choice.text===answer.answers[i]).length!==1)throw new Error('下拉答案与当前选项不一致，已停止。');
  }else{
    if(!Array.isArray(answer.indexes)||!answer.indexes.length&&!(question.type==='multiple'&&answer.source==='整题题库')||answer.indexes.some(index=>!Number.isInteger(index)||index<0||index>=question.targets.length)||new Set(answer.indexes).size!==answer.indexes.length)throw new Error('选择题答案索引无效，已停止。');
    if(question.type==='single'&&answer.indexes.length!==1)throw new Error('单选题答案数量无效。');
  }
  for(const target of question.targets){
    await check();const locator=frame.locator(target.selector);
    if(typeof locator.count==='function'&&await locator.count()!==1)throw new Error('作答控件已变化或不唯一，已停止。');
  }
  if(question.type==='text'){
    await dismissInputRestriction(frame,check);
    for(const [i,target] of question.targets.entries()){
      await check();const locator=frame.locator(target.selector),value=answer.answers[i];
      if(target.kind==='unipus-select'){await fillDropdown(frame,locator,target,value,{signal,check,act});continue;}
      if(!['select','editable'].includes(target.kind)&&typeof locator.getAttribute==='function'){
        const limit=await locator.getAttribute('maxlength');
        if(limit!==null&&/^\d+$/.test(limit)&&value.length>Number(limit))throw new TextInputError(`第 ${i+1} 个作答项超过页面允许的 ${limit} 字符，尚未截断或提交，请核对答案长度。`,{fieldIndex:i,code:'TEXT_INPUT_TOO_LONG'});
      }
      await act(target.selector,async()=>{
        if(target.kind==='select'){
          await locator.focus({timeout:5000});await check();await locator.selectOption({value:target.choices.find(choice=>choice.text===value).value},{timeout:5000});
        }
        else if(target.inputMode==='keyboard'){
          await locator.click({timeout:5000});await check();await locator.press('ControlOrMeta+A');await check();await locator.press('Backspace');await check();await locator.pressSequentially(value);await check();await locator.press('Tab');
        }else await locator.fill(value,{timeout:5000});
      });
      await check();if(typeof locator.blur==='function')await locator.blur();
      // React/Vue can revert or replace an input on blur. Check the committed
      // value as well as the immediate write, through a locator that can rebind.
      if(typeof locator.blur==='function')await sleep(100,undefined,{signal});
      let verified=false,stable=0;
      for(let attempt=0;attempt<8;attempt++){
        await check();
        await rejectInputRestriction(frame,check,i);
        const actual=target.kind==='editable'?await locator.innerText():await locator.inputValue();
        const expected=target.kind==='select'?target.choices.find(choice=>choice.text===value).value:value;
        if(target.kind==='editable'?clean(actual)===clean(expected):actual===expected){if(typeof locator.blur!=='function'||++stable>=3){verified=true;break;}}else stable=0;
        await sleep(100,undefined,{signal});
      }
      if(!verified)throw new Error('填空内容未写入成功或被页面回退，已停止。');
    }
  }else{
    for(const [i,target] of question.targets.entries()){
      const selected=answer.indexes.includes(i);if(question.type==='single'&&!selected)continue;
      await check();const locator=frame.locator(target.selector);
      if(target.kind==='native'){await act(target.selector,()=>locator.setChecked(selected,{timeout:5000}));await check();}
      else{
        const state=target.kind==='unipus-choice'?el=>el.classList.contains('selected'):selectedState;
        let verified=false;
        for(let clickAttempt=0;clickAttempt<2&&!verified;clickAttempt++){
          if(await locator.evaluate(state)!==selected)await act(target.selector,async()=>{
            // Re-read on retry: a committed choice must never be toggled off.
            if(await locator.evaluate(state)!==selected)await locator.click({timeout:5000});
          });
          for(let attempt=0;attempt<6;attempt++){await check();if(await locator.evaluate(state)===selected){verified=true;break;}await sleep(100,undefined,{signal});}
          // An ancestor dialog can swallow a delivered click without a browser
          // timeout. Retry the same guarded target once if it never committed.
        }
        if(!verified)throw new Error('页面没有确认选项选中状态，已停止。');
      }
    }
  }
  await verifyQuestion(frame,question,answer,{signal,checkpoint,textPrepared:true});
}
