import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {downloadMedia,validateMediaURL} from './media-materials.mjs';

export const MAX_IMAGE_BYTES=8*1024*1024;
export const MAX_PAGE_IMAGE_BYTES=12*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const unavailable=message=>Object.assign(new Error(message||'题目图片暂时无法读取，请确认题页仍打开、图片已加载且网络正常后点击「继续核对」。'),{code:'IMAGE_READ_UNAVAILABLE'});
const changed=(reason='content')=>Object.assign(new Error('题目图片内容或显示方式发生变化，已停止填写或提交，题页已保留。'),{code:'IMAGE_CHANGED',imageChange:{reason}});
const inlineBytes=value=>{const match=String(value||'').match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);return match?Buffer.from(match[2],'base64'):null;};
function mime(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return '';
}
export function imageAsset(bytes,{width,height}={}){
  const type=mime(bytes);
  if(!type||bytes.length<16||bytes.length>MAX_IMAGE_BYTES)throw new Error('图片格式不可读取或单张图片超过 8 MB。');
  if(type==='image/png'&&bytes.length>=24){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  if(type==='image/gif'){width=bytes.readUInt16LE(6);height=bytes.readUInt16LE(8);}
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000)throw new Error('图片尺寸无法确认或超过可处理范围。');
  return {digest:digest(bytes),mimeType:type,width,height,dataURL:`data:${type};base64,${bytes.toString('base64')}`};
}
export function verifyBankImages(bank){
  for(const row of bank)for(const asset of row.imageAssets||[]){
    const match=asset.dataURL?.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)throw new Error('题库图片内容无效。');
    const bytes=Buffer.from(match[2],'base64'),actual=imageAsset(bytes,asset);
    if(bytes.toString('base64')!==match[2]||actual.digest!==asset.digest||actual.mimeType!==asset.mimeType||actual.width!==asset.width||actual.height!==asset.height)throw new Error('题库图片内容校验失败。');
  }
}

export class ImageMaterials{
  constructor({download=downloadMedia}={}){this.download=download;}
  async readInfo(locator,signal){
    signal?.throwIfAborted();const count=await locator.count();if(!count)throw unavailable();if(count!==1)throw changed('locator');
    const info=await locator.evaluate(async el=>{
      if(!el.complete||!el.naturalWidth){
        // decode() alone does not start offscreen lazy images. Ask the browser
        // to load native lazy material, or reveal observer-based lazy material;
        // never replace its authored source or wait on screenshot actionability.
        if(el.loading==='lazy')el.loading='eager';else el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        let timer,poll;try{await Promise.race([
          el.decode().catch(()=>new Promise(()=>{})),
          new Promise(resolve=>{timer=setTimeout(resolve,5000);poll=setInterval(()=>{if(el.complete&&el.naturalWidth>0)resolve();},50);})
        ]);}finally{clearTimeout(timer);clearInterval(poll);}
      }
      const nodes=[];for(let node=el;node;node=node.parentElement)nodes.push(node);
      const changingEffects=()=>nodes.flatMap(node=>node.getAnimations?.()||[]).filter(animation=>animation.playState==='running'&&animation.effect?.getKeyframes().some(frame=>['filter','opacity','clipPath','mixBlendMode','objectFit','objectPosition'].some(key=>key in frame)));
      // An image can be fully decoded while a material pane is fading in.
      // Wait only for effects that change its appearance, not moving layouts.
      const animations=changingEffects();
      if(animations.length){let timer;try{await Promise.race([Promise.all(animations.map(animation=>animation.finished.catch(()=>{}))),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}}
      const style=[];
      // Neutral wrappers and fitting the complete original into another box do
      // not change the material sent to AI. Keep non-neutral effects in order,
      // including ancestor effects, so actual colour/crop/visibility edits stop.
      for(const node of nodes){
        const css=getComputedStyle(node),effects={};
        for(const [key,normal] of [['filter','none'],['opacity','1'],['clipPath','none'],['mixBlendMode','normal']])if(css[key]&&css[key]!==normal)effects[key]=css[key];
        if(node===el&&['cover','none'].includes(css.objectFit)){effects.objectFit=css.objectFit;effects.objectPosition=css.objectPosition;}
        if(Object.keys(effects).length)style.push(effects);
      }
      return {loaded:el.complete&&el.naturalWidth>0,width:el.naturalWidth,height:el.naturalHeight,url:el.currentSrc||el.src,style:JSON.stringify(style),changing:changingEffects().length>0};
    },undefined,{timeout:8000,signal});
    signal?.throwIfAborted();if(!info.loaded)throw unavailable('题目图片尚未加载成功，请等待图片显示后点击「继续核对」。');if(info.changing)throw unavailable('题目图片仍在淡入或变换显示效果，请等待图片稳定后点击「继续核对」。');return info;
  }
  async original(info,record,{context,signal}){
    let bytes=inlineBytes(info.url);
    if(!bytes&&validateMediaURL(info.url))try{bytes=await this.download(info.url,{context,referrer:record.referrer,signal,maxBytes:MAX_IMAGE_BYTES});}catch{signal?.throwIfAborted();}
    signal?.throwIfAborted();return bytes&&mime(bytes)?bytes:null;
  }
  async pixels(locator,signal){
    const data=await locator.evaluate(el=>{try{if(el.naturalWidth*el.naturalHeight>40000000)return '';const canvas=document.createElement('canvas');canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;canvas.getContext('2d').drawImage(el,0,0);return canvas.toDataURL('image/png');}catch{return '';}},undefined,{timeout:6000,signal});
    signal?.throwIfAborted();return inlineBytes(data);
  }
  async rendered(locator,signal,record){
    const marker=randomUUID(),selector=`[data-ustudy-image-capture="${marker}"]`;
    try{
      const info=await locator.evaluate(async(el,marker)=>{
        if(!el.complete||!el.naturalWidth)return {loaded:false};
        // A screenshot of the live lesson image includes its stretched/cropped
        // layout and scroll clipping. Render the complete source in an isolated
        // fixed-size shadow tree instead; do not change the authored element.
        const scale=Math.min(1,1600/el.naturalWidth,1600/el.naturalHeight),width=Math.max(1,Math.round(el.naturalWidth*scale)),height=Math.max(1,Math.round(el.naturalHeight*scale));
        const host=document.createElement('div');host.setAttribute('data-ustudy-image-capture',marker);host.setAttribute('aria-hidden','true');
        host.style.cssText=`all:initial!important;position:fixed!important;left:0!important;top:0!important;width:${width}px!important;height:${height}px!important;display:block!important;z-index:2147483647!important;pointer-events:none!important;opacity:1!important;visibility:visible!important;overflow:hidden!important;background:#fff!important;contain:strict!important;`;
        const shadow=host.attachShadow({mode:'open'}),image=document.createElement('img');
        image.style.cssText=`all:initial;display:block;width:${width}px;height:${height}px;object-fit:fill;`;image.loading='eager';image.referrerPolicy=el.referrerPolicy;
        if(el.hasAttribute('crossorigin'))image.crossOrigin=el.crossOrigin;
        image.src=el.currentSrc||el.src;shadow.append(image);document.documentElement.append(host);
        let timer;try{await Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}
        return {loaded:image.complete&&image.naturalWidth>0};
      },marker,{timeout:6000,signal});
      signal?.throwIfAborted();if(!info.loaded)throw unavailable();
      const bytes=await record.frame.locator(`${selector} img`).screenshot({type:'png',animations:'disabled',caret:'hide',scale:'css',timeout:5000,signal});signal?.throwIfAborted();return bytes;
    }finally{
      await record.frame.locator(selector).evaluate(el=>el.remove(),undefined,{timeout:1000}).catch(()=>{});
    }
  }
  async capture(record,{context,signal}={}){
    try{
      const locator=record.frame.locator(record.selector),info=await this.readInfo(locator,signal);
      let bytes=await this.original(info,record,{context,signal}),mode='original';
      if(!bytes){bytes=await this.pixels(locator,signal);mode='canvas';}
      // Only opaque/CORS-restricted material needs a stable element screenshot.
      if(!bytes){bytes=await this.rendered(locator,signal,record);mode='rendered';}
      const asset=imageAsset(bytes,info);
      return {...asset,label:record.label,verification:{mode,style:info.style}};
    }catch(error){signal?.throwIfAborted();if(error.code==='IMAGE_CHANGED'||error.code==='IMAGE_READ_UNAVAILABLE')throw error;throw unavailable();}
  }
  async verify(record,expected,{context,signal}={}){
    try{
      const locator=record.frame.locator(record.selector),{mode,style}=expected.verification||{};let info=await this.readInfo(locator,signal);
      // A short deferred layout effect may not have started at the first read.
      // Require the original appearance before proceeding, within a fixed bound.
      for(let retry=0;info.style!==style&&retry<3;retry++){await sleep(100,undefined,{signal});info=await this.readInfo(locator,signal);}
      if(info.style!==style)throw changed('display');
      const bytes=mode==='original'?await this.original(info,record,{context,signal}):mode==='canvas'?await this.pixels(locator,signal):mode==='rendered'?await this.rendered(locator,signal,record):null;
      if(!bytes)throw unavailable();if(digest(bytes)!==expected.digest)throw changed('content');
    }catch(error){signal?.throwIfAborted();if(error.code==='IMAGE_CHANGED'||error.code==='IMAGE_READ_UNAVAILABLE')throw error;throw unavailable();}
  }
}
