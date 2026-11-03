import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {OralSpeech,inspectOralWave} from './oral-speech.mjs';

export const SHORT_ORAL_SECONDS=5;
export const SHORT_ORAL_TEXT='This is my recorded answer for this speaking activity.';
const scripts=[SHORT_ORAL_TEXT,'This is my recorded answer.'];
const digest=value=>createHash('sha256').update(value).digest('hex');

/** Keep the complete utterance and pad its trailing silence to five seconds. */
export function padShortOralWave(bytes){
  const info=inspectOralWave(bytes,{maxSeconds:SHORT_ORAL_SECONDS});let samples;
  for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4),start=offset+8;if(bytes.toString('ascii',offset,offset+4)==='data')samples=bytes.subarray(start,start+size);offset=start+size+(size%2);}
  const dataLength=info.sampleRate*SHORT_ORAL_SECONDS*2,output=Buffer.alloc(44+dataLength);
  output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVEfmt ',8);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);output.writeUInt32LE(info.sampleRate,24);output.writeUInt32LE(info.sampleRate*2,28);output.writeUInt16LE(2,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(dataLength,40);samples.copy(output,44);
  inspectOralWave(output,{maxSeconds:SHORT_ORAL_SECONDS});return output;
}

/** Shared local speech only. Never reads a course passage or calls an AI. */
export async function prepareShortOralAudio({directory,scope,oral,speech=new OralSpeech(directory),checkpoint=async()=>{},signal}){
  signal?.throwIfAborted();if(!scope?.courseId||!scope.unitId||!scope.entryKey||!oral?.key)throw new Error('短录音缺少当前题目的目录范围。');
  const cache=path.resolve(directory,'oral-short','five-seconds-v1'),file=path.join(cache,'speech.wav'),metaFile=path.join(cache,'draft.json');let audio,script,metadata,reused=false;
  await checkpoint();
  try{
    const bytes=await readFile(file);metadata=JSON.parse(await readFile(metaFile,'utf8'));
    const info=inspectOralWave(bytes,{maxSeconds:SHORT_ORAL_SECONDS});
    if(metadata.format==='oral-short-v1'&&scripts.includes(metadata.script)&&metadata.waveDigest===digest(bytes)&&info.duration===SHORT_ORAL_SECONDS){audio={...info,bytes,voice:metadata.voice};script=metadata.script;reused=true;}
  }catch{/* An incomplete local cache can be regenerated without any network request. */}
  if(!audio){
    for(const candidate of scripts){
      await checkpoint();const result=await speech.synthesize(candidate,{signal,maxSeconds:30});signal?.throwIfAborted();
      if(inspectOralWave(result.bytes,{maxSeconds:30}).duration>SHORT_ORAL_SECONDS)continue;
      const bytes=padShortOralWave(result.bytes);audio={...inspectOralWave(bytes,{maxSeconds:SHORT_ORAL_SECONDS}),bytes,voice:result.voice};script=candidate;break;
    }
    if(!audio)throw new Error('本地语音未能合成为 5 秒以内的完整短句，尚未开始录音。');
    await checkpoint();await mkdir(cache,{recursive:true});await writeFile(file,audio.bytes);await writeFile(metaFile,JSON.stringify({format:'oral-short-v1',script,seconds:audio.duration,voice:audio.voice,waveDigest:digest(audio.bytes),preparedAt:Date.now()},null,2));
  }
  await checkpoint();signal?.throwIfAborted();
  const folder=path.resolve(directory,'oral-short','attempts',digest(JSON.stringify([scope.id,scope.courseId,scope.unitId,scope.entryKey,oral.key])));await mkdir(folder,{recursive:true});
  return {audio,script,folder,reused};
}
