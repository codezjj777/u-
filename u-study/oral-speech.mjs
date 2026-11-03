import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {runSpeechProcess} from './speech-process.mjs';

export function inspectOralWave(bytes,{maxSeconds=180}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>30*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('本地合成音频格式无效。');
  let format,data;
  for(let offset=12;offset+8<=bytes.length;){
    const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
    if(end>bytes.length)throw new Error('本地合成音频不完整。');
    if(name==='fmt '){if(size<16)throw new Error('本地音频格式信息不完整。');format={codec:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),blockAlign:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};}
    if(name==='data')data=bytes.subarray(start,end);offset=end+(size%2);
  }
  if(!format||!data?.length||format.codec!==1||format.channels!==1||format.bits!==16||format.blockAlign!==2||format.byteRate!==format.sampleRate*2||format.sampleRate<8000||format.sampleRate>48000||data.length%2)throw new Error('本地录音需要有效的单声道 PCM 语音。');
  const duration=data.length/format.byteRate;let energy=0,peak=0;
  for(let offset=0;offset<data.length;offset+=2){const sample=data.readInt16LE(offset)/32768;energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
  const rms=Math.sqrt(energy/(data.length/2));
  if(duration<0.25||duration>maxSeconds||rms<0.001||peak<0.01)throw new Error(duration>maxSeconds?'复述语音超过本题录音时间限制，请缩短复述稿。':'合成音频为空、过短或没有有效语音，尚未录入课程。');
  return {duration,sampleRate:format.sampleRate,channels:1,rms,peak,byteLength:bytes.length};
}

const sapiScript=String.raw`
$ErrorActionPreference = 'Stop'
$text = [System.IO.File]::ReadAllText($env:USTUDY_ORAL_TEXT, [System.Text.Encoding]::UTF8)
$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
$english = $null
for ($i = 0; $i -lt $voices.Count; $i++) {
  $candidate = $voices.Item($i)
  foreach ($language in $candidate.GetAttribute('Language').Split(';')) {
    if (([Convert]::ToInt32($language,16) -band 1023) -eq 9) { $english = $candidate; break }
  }
  if ($null -ne $english) { break }
}
if ($null -eq $english) { throw 'An installed English speech voice is required.' }
$voice.Voice = $english
$voice.Rate = 0
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Format.Type = 22
try {
  $stream.Open($env:USTUDY_ORAL_WAV,3,$false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($text,16)
} finally { $stream.Close() }
@{voice=$english.GetDescription()} | ConvertTo-Json -Compress
`;

export class OralSpeech{
  constructor(directory,{runProcess=runSpeechProcess}={}){this.root=path.resolve(directory,'oral-tmp');this.runProcess=runProcess;}
  async synthesize(text,{signal,maxSeconds=180}={}){
    signal?.throwIfAborted();
    if(process.platform!=='win32')throw new Error('当前自动口语合成需要 Windows 已安装的英文语音。');
    if(typeof text!=='string'||!text.trim()||text.length>8000||text.includes('\0'))throw new Error('复述稿为空或超过本地语音处理范围。');
    await mkdir(this.root,{recursive:true});const directory=await mkdtemp(path.join(this.root,'utterance-'));
    try{
      const input=path.join(directory,'script.txt'),output=path.join(directory,'speech.wav');await writeFile(input,text,'utf8');
      const result=await this.runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',sapiScript],{signal,timeoutMs:60000,env:{...process.env,USTUDY_ORAL_TEXT:input,USTUDY_ORAL_WAV:output}});
      signal?.throwIfAborted();const bytes=await readFile(output),metadata=inspectOralWave(bytes,{maxSeconds});let voice='Windows 英文语音';try{voice=JSON.parse(result.trim()).voice||voice;}catch{}
      return {...metadata,bytes,voice};
    }finally{
      if(!directory.startsWith(this.root+path.sep))throw new Error('语音临时目录范围异常，尚未清理。');
      await rm(directory,{recursive:true,force:true});
    }
  }
}
