import {setTimeout as sleep} from 'node:timers/promises';

export const VOCABULARY_HANDLER='vocabulary-cards-v1';
export function isVocabularyEntry(scope){
  try{
    const [unit,path,title]=JSON.parse(scope.entryKey),clean=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
    return (!scope.unitId||scope.unitId===unit)&&Array.isArray(path)&&path.some(part=>clean(part)==='vocabulary')&&['new words','phrases','proper nouns'].includes(clean(title));
  }catch{return false;}
}

/** Runs in a lesson frame. Only the active public Swiper slide is current. */
export function readVocabularyFromDOM(){
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden="true"],[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const clean=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  for(const el of document.querySelectorAll('[data-ustudy-vocabulary-next]'))el.removeAttribute('data-ustudy-vocabulary-next');
  const roots=[...document.querySelectorAll('.question-vocabulary .vocabulary-wrapper')].filter(visible);
  if(!roots.length)return null;
  const blocked=(issue,requiresReview=false)=>({recognized:true,ready:false,issue,requiresReview});
  if(roots.length!==1)return blocked('检测到多组活动词卡，无法确认「下一个」的归属。',true);
  const root=roots[0],scope=root.closest('.layout-container,main')||root;
  const fields=[...scope.querySelectorAll('textarea,select,input:not([type=hidden]):not([type=button]):not([type=range]),[contenteditable=true],[contenteditable="plaintext-only"],[role=radio],[role=checkbox]')].filter(el=>visible(el)&&!el.disabled&&!el.readOnly);
  if(fields.length)return blocked('词卡区域同时有作答控件，尚未自动翻动。',true);
  const containers=[...root.querySelectorAll('.swiper-container.swiper-vocabulary')].filter(visible);
  if(containers.length!==1)return blocked('词卡内容尚未完整载入。');
  const container=containers[0],wrapper=container.querySelector('.swiper-wrapper');
  const slides=wrapper?[...wrapper.children].filter(el=>el.matches('.swiper-vocabulary-slide')):[];
  const active=slides.filter(el=>el.classList.contains('swiper-slide-active')&&visible(el));
  if(active.length!==1)return blocked('当前活动词卡尚未稳定。');
  const slide=active[0],index=slides.indexOf(slide),completion=clean(slide.querySelector('.visual-card')).match(/^已学完全部\s*(\d+)\s*个(?:生词|单词|词汇|短语|专有名词)[啦了！!。]*$/);
  const moving=(wrapper.getAnimations?.()||[]).some(animation=>animation.playState==='running');
  if(completion){
    const total=Number(completion[1]);
    if(!total||total>1000||slides.length!==total+1||index!==total||moving)return blocked('词卡结束提示与当前进度尚未一致。');
    return {recognized:true,ready:true,current:total,total,completed:true,key:JSON.stringify([total,'complete'])};
  }
  const ratios=[...root.querySelectorAll('.progressBar .ratio')].filter(visible),ratio=ratios.length===1?clean(ratios[0]).match(/^(\d+)\s*\/\s*(\d+)$/):null;
  const current=Number(ratio?.[1]),total=Number(ratio?.[2]);
  if(!current||!total||current>total||total>1000||slides.length!==total+1||index!==current-1||moving)return blocked('词卡计数与活动卡片尚未一致。');
  const word=clean(slide.querySelector('.question-vocabulary-base .vocWord')),definition=clean(slide.querySelector('.question-vocabulary-intro .exp'));
  if(!word||word.length>1000||!definition||definition.length>20000)return blocked('当前词条或释义尚未载入完整。');
  const buttons=[...root.querySelectorAll('.vocActions .action.next')].filter(el=>visible(el)&&clean(el)==='下一个'&&!el.matches(':disabled,[aria-disabled="true"],.disabled'));
  if(buttons.length!==1)return blocked('当前词卡的「下一个」尚不可用或不唯一。');
  buttons[0].setAttribute('data-ustudy-vocabulary-next','true');
  return {recognized:true,ready:true,current,total,word,completed:false,selector:'[data-ustudy-vocabulary-next="true"]',key:JSON.stringify([current,total,word,definition])};
}

const review=message=>Object.assign(new Error(message),{code:'VOCABULARY_REVIEW'});
/** Advance through normal clicks; each click must produce exactly one new card. */
export async function advanceVocabularyCards({initial,read,click,checkpoint=async()=>{},onProgress=()=>{},signal,stepTimeoutMs=8000,pollMs=100}){
  const check=async()=>{signal?.throwIfAborted();await checkpoint();signal?.throwIfAborted();};
  const identity=initial?.binding,total=initial?.total;
  if(!identity||!initial.ready||!Number.isInteger(total)||total<1||total>1000)throw review(initial?.issue||'词卡页面尚未稳定，尚未自动翻动。');
  const bound=fresh=>{
    if(!fresh||fresh.binding!==identity)throw review('词卡所属项目或页面已变化，已停止翻动。');
    if(fresh.ready&&fresh.total!==total)throw review('词卡总数发生变化，已停止翻动。');
  };
  let current=initial,moves=0;onProgress(current);
  while(!current.completed&&moves<total){
    await check();const before=await read();bound(before);
    if(!before.ready||before.key!==current.key)throw review('点击前词卡进度或内容发生变化，尚未继续翻动。');
    await check();await click(before);moves++;
    let elapsed=0,stable='',next;
    while(elapsed<stepTimeoutMs){
      await check();const started=Date.now(),fresh=await read();bound(fresh);
      if(fresh.ready){
        if(fresh.current<current.current||fresh.current>current.current+1)throw review('词卡进度发生回退或跳跃，已停止连续点击。');
        const advanced=current.current===total?fresh.completed:fresh.current===current.current+1&&!fresh.completed;
        if(advanced){if(stable===fresh.key){next=fresh;break;}stable=fresh.key;}else stable='';
      }else stable='';
      elapsed+=Date.now()-started;
      if(elapsed<stepTimeoutMs){const delay=Math.min(pollMs,stepTimeoutMs-elapsed);await sleep(delay,undefined,{signal});elapsed+=delay;}
    }
    if(!next)throw review('点击「下一个」后未确认词卡推进，已停止重复点击，请检查当前页面。');
    current=next;onProgress(current);
  }
  if(!current.completed)throw review('词卡未出现对应的学习结束页，尚未确认完成。');
  return {total,moves};
}
