import {readFile,writeFile,mkdir,mkdtemp,copyFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseFiles} from './release-files.mjs';
import {assertRuntime} from './runtime-check.mjs';

// Build only from source allowlists, an official verified runtime and a clean npm install.
const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
if(process.platform!=='win32')throw new Error('Windows 便携包需要在 Windows 上构建。');
assertRuntime();
const pkg=JSON.parse(await readFile('package.json','utf8'));
const version=process.env.USTUDY_NODE_VERSION||'24.22.2';
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('USTUDY_NODE_VERSION 必须为数字版本号。');
assertRuntime(version);
await import('./release.mjs');
const destination=path.join(root,'.cache','releases');
const staging=await mkdtemp(path.join(destination,'windows-stage-'));
const label=`U-Study-${pkg.version}`,bundle=path.join(staging,label);
const application=path.join(bundle,'u-study');
await mkdir(application,{recursive:true});

for(const file of releaseFiles){
  const source=path.join(root,file);
  if(!(await lstat(source)).isFile())throw new Error('非普通发布文件：'+file);
  const target=path.join(application,file);
  await mkdir(path.dirname(target),{recursive:true});
  await copyFile(source,target);
}
for(const file of ['README.md','一键启动.cmd','一键停止.cmd','docs/RELEASING.md']){
  const source=path.join(root,'..',file),target=path.join(bundle,file);
  if(!(await lstat(source)).isFile())throw new Error('缺少发布说明或启动入口：'+file);
  await mkdir(path.dirname(target),{recursive:true});
  await copyFile(source,target);
}

async function download(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok)throw new Error(`下载失败（${response.status}）：${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const runtimeName=`node-v${version}-win-x64`,runtimeZip=runtimeName+'.zip';
const base=`https://nodejs.org/dist/v${version}/`;
console.log(`正在下载并核对官方 Node.js v${version} Windows x64 运行时…`);
const sums=(await download(base+'SHASUMS256.txt')).toString('utf8');
const expected=sums.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts[1]===runtimeZip)?.[0];
if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw new Error('官方校验清单中缺少运行时。');
const archive=await download(base+runtimeZip);
const actual=createHash('sha256').update(archive).digest('hex');
if(actual!==expected)throw new Error('Node.js 运行时 SHA-256 校验失败。');
const downloaded=path.join(staging,runtimeZip),extracted=path.join(staging,'official-node');
await writeFile(downloaded,archive);
function powershell(script,variables={}){
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{
    windowsHide:true,stdio:'inherit',env:{...process.env,...variables}
  });
}
powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:USTUDY_ARCHIVE,$env:USTUDY_EXTRACT)',{
  USTUDY_ARCHIVE:downloaded,USTUDY_EXTRACT:extracted
});
const runtime=path.join(bundle,'runtime');await mkdir(runtime);
for(const file of ['node.exe','LICENSE'])await copyFile(path.join(extracted,runtimeName,file),path.join(runtime,file));
const bundledNode=path.join(runtime,'node.exe');
if(execFileSync(bundledNode,['--version'],{encoding:'utf8',windowsHide:true}).trim()!==`v${version}`)throw new Error('运行时版本核对失败。');
console.log('正在为全新发布目录安装锁定的生产依赖…');
const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
execFileSync(process.execPath,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(root,'.cache','npm')],{
  cwd:application,windowsHide:true,stdio:'inherit'
});
const installed=await readdir(path.join(application,'node_modules'));
if(installed.some(name=>!['playwright-core','.bin','.package-lock.json'].includes(name)))throw new Error('发现允许范围之外的运行依赖。');
execFileSync(bundledNode,['--input-type=module','-e',"await import('playwright-core'); await import('./server.mjs'); console.log('便携运行环境加载通过。');"],{
  cwd:application,windowsHide:true,stdio:'inherit'
});

async function listFiles(directory,prefix=''){
  const result=[];
  for(const name of (await readdir(directory)).sort()){
    const absolute=path.join(directory,name),relative=prefix+name,info=await lstat(absolute);
    if(info.isSymbolicLink())throw new Error('发布目录包含符号链接：'+relative);
    if(info.isDirectory())result.push(...await listFiles(absolute,relative+'/'));
    else if(info.isFile())result.push(relative);
    else throw new Error('发布目录包含非普通文件：'+relative);
  }
  return result;
}
const files=await listFiles(bundle);
for(const file of files){
  if(/(?:^|\/)(?:\.runtime|\.cache|\.openai|\.git|__pycache__|tests)(?:\/|$)|\.log$/i.test(file))throw new Error('发布目录包含本地资料：'+file);
  const permitted=releaseFiles.some(source=>'u-study/'+source===file)||
    ['README.md','一键启动.cmd','一键停止.cmd','docs/RELEASING.md','runtime/node.exe','runtime/LICENSE'].includes(file)||
    file.startsWith('u-study/node_modules/playwright-core/')||file.startsWith('u-study/node_modules/.bin/')||file==='u-study/node_modules/.package-lock.json';
  if(!permitted)throw new Error('发布允许名单之外的文件：'+file);
}
const filename=`${label}-windows-x64.zip`,zip=path.join(destination,filename);
const temporaryZip=path.join(staging,filename),zipListing=path.join(staging,'zip-entries.json');
console.log('正在生成 ZIP 并逐项核对文件、内容摘要和中文路径…');
powershell("Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:USTUDY_BUNDLE,$env:USTUDY_OUTPUT,[System.IO.Compression.CompressionLevel]::Optimal,$true); $zip=[System.IO.Compression.ZipFile]::OpenRead($env:USTUDY_OUTPUT); try { $entries=@($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object { $stream=$_.Open(); $sha=[System.Security.Cryptography.SHA256]::Create(); try { $hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant(); [pscustomobject]@{path=$_.FullName.Replace('\\','/');sha256=$hash} } finally { $sha.Dispose(); $stream.Dispose() } }); [System.IO.File]::WriteAllText($env:USTUDY_LIST,($entries | ConvertTo-Json -Depth 3),(New-Object System.Text.UTF8Encoding($false))) } finally { $zip.Dispose() }",{
  USTUDY_BUNDLE:bundle,USTUDY_OUTPUT:temporaryZip,USTUDY_LIST:zipListing
});
const entries=JSON.parse(await readFile(zipListing,'utf8'));
if(entries.length!==files.length||new Set(entries.map(entry=>entry.path)).size!==files.length)throw new Error('ZIP 文件数量校验失败。');
const checksums=new Map(entries.map(entry=>[entry.path,entry.sha256]));
for(const file of files){
  const digest=createHash('sha256').update(await readFile(path.join(bundle,file))).digest('hex');
  if(checksums.get(label+'/'+file)!==digest)throw new Error('ZIP 内容校验失败：'+file);
}
await copyFile(temporaryZip,zip);
const sha256=createHash('sha256').update(await readFile(zip)).digest('hex');
const previous=await readFile(path.join(destination,'SHA256SUMS.txt'),'utf8');
await writeFile(path.join(destination,'SHA256SUMS.txt'),previous.split(/\r?\n/).filter(line=>line&&!line.endsWith('  '+filename)).join('\n')+`\n${sha256}  ${filename}\n`);
await writeFile(path.join(destination,'windows-manifest.json'),JSON.stringify({
  version:pkg.version,filename,sha256,platform:'win32',arch:'x64',
  runtime:{version,source:base+runtimeZip,sha256:actual},
  files:entries
},null,2)+'\n');
console.log(`Windows 便携包已生成：${zip}\nSHA-256：${sha256}\n暂存目录：${bundle}`);
