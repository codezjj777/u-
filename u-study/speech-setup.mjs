import {mkdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runSpeechProcess} from './speech-process.mjs';

const project=path.dirname(fileURLToPath(import.meta.url));
export async function setupSpeech({root=project,python=process.env.USTUDY_PYTHON,onOutput=chunk=>process.stdout.write(chunk),signal}={}){
  const directory=path.join(root,'.runtime','speech'),venv=path.join(directory,'python');
  const executable=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await mkdir(directory,{recursive:true});
  const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',HF_HUB_DISABLE_XET:'1',HF_HUB_DISABLE_SYMLINKS_WARNING:'1',PIP_CACHE_DIR:path.join(root,'.cache','pip')};
  delete env.USTUDY_API_KEY;delete env.OPENAI_API_KEY;delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
  if(!await stat(executable).catch(()=>null)){
    const candidates=python?[[python,[]]]:process.platform==='win32'?[['py',['-3.13']],['py',['-3.12']],['py',['-3.11']],['python',[]]]:[['python3',[]],['python',[]]];
    let chosen;
    for(const [command,args] of candidates){
      try{const output=await runSpeechProcess(command,[...args,'-c','import sys; assert (3, 10) <= sys.version_info[:2] < (3, 14); print(sys.executable)'],{signal,timeoutMs:15000,env});chosen=output.trim();break;}catch{signal?.throwIfAborted();}
    }
    if(!chosen)throw new Error('请先安装 Python 3.10–3.13，或用 USTUDY_PYTHON 指定兼容的 Python，再运行听力识别准备入口。');
    onOutput('正在创建项目专用的语音识别环境…\n');
    await runSpeechProcess(chosen,['-m','venv',venv],{signal,timeoutMs:120000,env,onOutput});
  }
  onOutput('正在安装本地语音组件（首次需要下载）…\n');
  await runSpeechProcess(executable,['-m','pip','install','--disable-pip-version-check','--only-binary=:all:','-r',path.join(project,'speech-requirements.txt')],{signal,timeoutMs:600000,env,onOutput});
  onOutput('正在准备英文 base.en 模型（约 148 MB），完成后转写可离线运行…\n');
  const output=await runSpeechProcess(executable,['-u',path.join(project,'speech_worker.py'),'setup','--model-dir',path.join(directory,'model')],{signal,timeoutMs:900000,env,onOutput});
  const ready=output.trim().split(/\r?\n/).some(line=>{try{return JSON.parse(line).ok===true;}catch{return false;}});
  if(!ready)throw new Error('本地语音模型尚未就绪，请检查网络后重新运行准备入口。');
  await writeFile(path.join(directory,'ready.json'),JSON.stringify({version:1,model:'base.en',createdAt:new Date().toISOString()},null,2));
  onOutput('本地听力识别已就绪，重新启动 U Study 即可使用。\n');return {executable,directory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
  try{await setupSpeech({signal:controller.signal});}catch(error){console.error(error.message);process.exitCode=1;}
}
