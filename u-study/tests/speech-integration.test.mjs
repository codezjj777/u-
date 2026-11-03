import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,readFile,readdir,writeFile,stat,rm} from 'node:fs/promises';
import {LocalSpeech} from '../local-speech.mjs';
import {runSpeechProcess} from '../speech-process.mjs';

test('installed local speech recognizes real audio and video without a cloud transcription service',async t=>{
  if(process.platform!=='win32')return t.skip('The fixture generator uses Windows speech synthesis.');
  if(!await stat('.runtime/speech/ready.json').catch(()=>null))return t.skip('Run npm run setup:speech first.');
  const root=path.resolve('.cache'),directory=await mkdtemp(path.join(root,'speech-live-')),wav=path.join(directory,'speech.wav'),mp4=path.join(directory,'speech.mp4');
  try{
    const script="$voice = New-Object -ComObject SAPI.SpVoice; $voices = $voice.GetVoices(); for ($i = 0; $i -lt $voices.Count; $i++) { if ($voices.Item($i).GetAttribute('Language') -match '(^|;)409($|;)') { $voice.Voice = $voices.Item($i); break } }; $stream = New-Object -ComObject SAPI.SpFileStream; $stream.Open($env:USTUDY_SPEECH_TEST_WAV, 3, $false); $voice.AudioOutputStream = $stream; [void]$voice.Speak('Hello Anna. We are going to the library this afternoon. The library closes at six oclock. We will take the bus because it is raining. Please remember to bring your books.'); $stream.Close();";
    await runSpeechProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,USTUDY_SPEECH_TEST_WAV:wav},timeoutMs:30000});
    // A valid RIFF metadata chunk makes each run exercise the actual recognizer,
    // even if an identical synthesized phrase was transcribed earlier.
    const nonce=Buffer.from('speech-integration-'+Date.now()),junk=Buffer.alloc(8+nonce.length+(nonce.length%2));junk.write('JUNK');junk.writeUInt32LE(nonce.length,4);nonce.copy(junk,8);
    const generated=Buffer.concat([await readFile(wav),junk]);generated.writeUInt32LE(generated.length-8,4);await writeFile(wav,generated);
    const speech=new LocalSpeech('.runtime');
    await t.test('a WAV file produces the actual spoken facts and reuses its content cache',async()=>{
      const bytes=await readFile(wav),result=await speech.transcribe(bytes);assert.equal(result.source,'本地语音转写');assert.match(result.text,/library/i);assert.match(result.text,/six/i);assert.match(result.text,/bus/i);
      assert.equal((await speech.transcribe(bytes)).source,'本地转写缓存');
    });
    await t.test('an MP4 container is decoded and transcribed through its audio stream',async subtest=>{
      try{await runSpeechProcess('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=10','-i',wav,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',mp4],{timeoutMs:30000});}
      catch(error){if(error.code==='ENOENT')return subtest.skip('FFmpeg fixture generator is unavailable; runtime decoding uses PyAV.');throw error;}
      const result=await speech.transcribe(await readFile(mp4));assert.match(result.text,/library/i);assert.match(result.text,/six/i);
    });
    await t.test('stopping a running Python recognizer waits for exit and removes its downloaded bytes',async()=>{
      const controller=new AbortController();let started=false;
      const speech=new LocalSpeech('.runtime',{runProcess:(command,args,options)=>runSpeechProcess(command,args,{...options,onMessage:message=>{options.onMessage?.(message);if(message.stage==='transcribing'){started=true;controller.abort();}}})});
      const bytes=Buffer.concat([await readFile(wav),Buffer.from('cancel-'+Date.now())]);
      await assert.rejects(speech.transcribe(bytes,{signal:controller.signal}),{name:'AbortError'});assert.equal(started,true);assert.deepEqual(await readdir('.runtime/speech/tmp'),[]);
    });
    await t.test('a hung helper has a bounded timeout and is terminated',async()=>{
      await assert.rejects(runSpeechProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),/超时/);
    });
  }finally{
    if(!directory.startsWith(root+path.sep))throw new Error('Speech test directory is outside the workspace cache.');
    await rm(directory,{recursive:true,force:true});
  }
});
