import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {padShortOralWave,prepareShortOralAudio,SHORT_ORAL_TEXT} from '../oral-short.mjs';
import {inspectOralWave} from '../oral-speech.mjs';
import {oralTestWave} from './fixtures/oral-retell.mjs';
import {validateSettings} from '../settings.mjs';

test('five-second audio preserves the complete voiced samples and pads silence without cutting speech',()=>{
  const input=oralTestWave(2.5),output=padShortOralWave(input),info=inspectOralWave(output);
  assert.equal(info.duration,5);assert.ok(info.rms>0.01);assert.deepEqual(output.subarray(44,input.length),input.subarray(44));assert.equal(output.subarray(input.length).some(value=>value!==0),false);
  assert.throws(()=>padShortOralWave(oralTestWave(6)),/超过/);assert.throws(()=>padShortOralWave(oralTestWave(2,{silent:true})),/没有有效语音/);
});

test('short recording is the default while complete retelling remains selectable',()=>{
  assert.equal(validateSettings({}).oralMode,'short');assert.equal(validateSettings({oralMode:'retell'}).oralMode,'retell');assert.throws(()=>validateSettings({oralMode:'unknown'}),/模式无效/);
});

test('short speech cache is reused across questions without course text, credentials or an AI request',async()=>{
  const parent=path.resolve('.cache'),directory=await mkdtemp(path.join(parent,'short-cache-'));let calls=0;
  try{
    const speech={synthesize:async text=>{calls++;assert.equal(text,SHORT_ORAL_TEXT);const bytes=oralTestWave(2);return {...inspectOralWave(bytes),bytes,voice:'fixture'};}},scope={id:'one',courseId:'book',unitId:'unit',entryKey:'entry'},options={directory,scope,oral:{key:'page-one'},speech};
    const first=await prepareShortOralAudio(options),second=await prepareShortOralAudio({...options,oral:{key:'page-two'}});
    assert.equal(calls,1);assert.equal(first.audio.duration,5);assert.equal(second.reused,true);assert.deepEqual(first.audio.bytes,second.audio.bytes);assert.notEqual(first.folder,second.folder);
    const metadata=JSON.parse(await readFile(path.join(directory,'oral-short/five-seconds-v1/draft.json'),'utf8'));assert.equal(metadata.seconds,5);assert.equal(metadata.sourceCharacters,undefined);
    await writeFile(path.join(directory,'oral-short/five-seconds-v1/speech.wav'),Buffer.from('incomplete'));
    const repaired=await prepareShortOralAudio(options);assert.equal(calls,2);assert.equal(repaired.reused,false);assert.equal(repaired.audio.duration,5);
  }finally{assert.ok(directory.startsWith(parent+path.sep));await rm(directory,{recursive:true,force:true});}
});

test('slow speech uses a shorter complete utterance and cancellation prevents recording preparation',async()=>{
  const parent=path.resolve('.cache'),directory=await mkdtemp(path.join(parent,'short-slow-'));let calls=0;
  try{
    const options={directory,scope:{id:'one',courseId:'book',unitId:'unit',entryKey:'entry'},oral:{key:'one'},speech:{synthesize:async()=>{const bytes=oralTestWave(++calls===1?6:2);return {...inspectOralWave(bytes),bytes,voice:'slow fixture'};}}};
    const result=await prepareShortOralAudio(options);assert.equal(calls,2);assert.equal(result.script,'This is my recorded answer.');assert.equal(result.audio.duration,5);
    const controller=new AbortController();controller.abort(new Error('cancel short recording'));await assert.rejects(prepareShortOralAudio({...options,signal:controller.signal}),/cancel short recording/);
  }finally{assert.ok(directory.startsWith(parent+path.sep));await rm(directory,{recursive:true,force:true});}
});
