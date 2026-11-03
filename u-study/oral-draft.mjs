import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {askModel} from './answer-provider.mjs';
import {OralSpeech,inspectOralWave} from './oral-speech.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');

export function validateRetelling(value){
  const text=String(value||'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s+/g,' ').trim();
  const words=text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)||[];
  if(words.length<50||words.length>220||text.length>2400||/[\u0000-\u0008\u4e00-\u9fff`<>]/u.test(text)||/^(?:as an ai|i (?:cannot|can't)|sorry|here is|retelling:)/i.test(text))throw new Error('复述稿不是可直接朗读的完整英文段落，尚未开始录音。');
  return text;
}

export function oralDraftIdentity({scope,oral,source,settings,maxSeconds}){
  return digest(JSON.stringify(['oral-draft-v1',[scope.courseId,scope.unitId,scope.entryKey],oral.prompt,oral.instructions,oral.progress,source.context,settings.endpoint,settings.model,maxSeconds]));
}

/** Working material only: this cache never supplies a bank record or grade. */
export async function prepareOralDraft({directory,scope,oral,source,settings,apiKey,speech=new OralSpeech(directory),ask=askModel,checkpoint=async()=>{},signal,expectedKey}){
  signal?.throwIfAborted();
  if(typeof source?.context!=='string'||source.context.length<200||source.context.length>60000||!oral.prompt)throw new Error('复述需要当前题目的完整故事原文。');
  const maxSeconds=Math.min(180,oral.maxSeconds-8);if(!Number.isFinite(maxSeconds)||maxSeconds<10)throw new Error('本题剩余录音时间不足，尚未开始录音。');
  if(!scope?.courseId||!scope.unitId||!scope.entryKey)throw new Error('复述草稿缺少完整的课程目录范围。');
  const key=oralDraftIdentity({scope,oral,source,settings,maxSeconds});
  const folder=path.resolve(directory,'oral-drafts',key),metadataFile=path.join(folder,'draft.json');let metadata;
  try{metadata=JSON.parse(await readFile(metadataFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('已有复述草稿的校验信息损坏，请检查草稿后重试。');}
  await checkpoint();signal?.throwIfAborted();
  if(metadata){
    const [text,bytes]=await Promise.all([readFile(path.join(folder,'retelling.txt'),'utf8'),readFile(path.join(folder,'speech.wav'))]);
    if(metadata.key!==key||metadata.scriptDigest!==digest(text)||metadata.waveDigest!==digest(bytes)||metadata.sourceDigest!==digest(source.context))throw new Error('复述草稿内容与本题不一致，尚未录入。');
    const reviewKey=digest(JSON.stringify([key,metadata.scriptDigest,metadata.waveDigest]));if(expectedKey&&reviewKey!==expectedKey)throw new Error('复述试听稿或音频已变化，请重新核对后再确认替换。');
    const script=validateRetelling(text),audio={...inspectOralWave(bytes,{maxSeconds}),bytes,voice:metadata.voice};await checkpoint();return {key,reviewKey,folder,script,audio,reused:true};
  }
  if(expectedKey)throw new Error('已确认的复述预览草稿不存在，请重新生成并核对试听文件。');
  const question={type:'text',question:oral.prompt+' Produce one natural spoken English retelling of the supplied story in your own words, in 100-170 words. Preserve the characters, sequence of events and ending. Return only the spoken story as the single answer, without headings or stage directions.',context:source.context,options:[],targets:[{kind:'text'}]};
  const answer=await ask(question,settings,apiKey,signal,{beforeAttempt:checkpoint}),script=validateRetelling(answer.answers?.length===1?answer.answers[0]:'');await checkpoint();
  return saveLocalOralDraft({directory,scope,oral,source,settings,text:script,speech,checkpoint,signal});
}

/** Synthesize an already prepared local text; this path makes no AI request. */
export async function saveLocalOralDraft({directory,scope,oral,source,settings,text,speech=new OralSpeech(directory),checkpoint=async()=>{},signal}){
  signal?.throwIfAborted();
  if(!scope?.courseId||!scope.unitId||!scope.entryKey||typeof source?.context!=='string'||source.context.length<200||source.context.length>60000||!oral.prompt)throw new Error('本地复述草稿缺少完整题目和原文。');
  const maxSeconds=Math.min(180,oral.maxSeconds-8);if(!Number.isFinite(maxSeconds)||maxSeconds<10)throw new Error('本题录音时间限制尚未确认。');
  const key=oralDraftIdentity({scope,oral,source,settings,maxSeconds}),folder=path.resolve(directory,'oral-drafts',key),script=validateRetelling(text);
  await checkpoint();const audio=await speech.synthesize(script,{signal,maxSeconds});inspectOralWave(audio.bytes,{maxSeconds});await checkpoint();signal?.throwIfAborted();
  const metadata={format:'oral-draft-v1',key,prompt:oral.prompt,sourceTitle:source.sourceTitle,sourceDigest:digest(source.context),sourceCharacters:source.context.length,scriptDigest:digest(script),waveDigest:digest(audio.bytes),voice:audio.voice,generatedSeconds:audio.duration,maxSeconds,preparedAt:Date.now()};
  await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'retelling.txt'),script,'utf8');await writeFile(path.join(folder,'speech.wav'),audio.bytes);await writeFile(path.join(folder,'source.txt'),source.context,'utf8');await writeFile(path.join(folder,'draft.json'),JSON.stringify(metadata,null,2));
  return {key,reviewKey:digest(JSON.stringify([key,metadata.scriptDigest,metadata.waveDigest])),folder,script,audio,reused:false};
}
