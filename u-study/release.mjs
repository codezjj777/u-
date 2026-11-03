import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {buildCore} from './build-core.mjs';
import {releaseFiles} from './release-files.mjs';

await buildCore();
const pkg=JSON.parse(await readFile('package.json','utf8')),destination=path.resolve('.cache/releases');await mkdir(destination,{recursive:true});
if(JSON.stringify(pkg.files)!==JSON.stringify(releaseFiles))throw new Error('package.json 的文件清单与发布允许名单不一致。');
const chunks=[];
function appendEntry(name,content,mtime,type='0'){
  const header=Buffer.alloc(512),put=(text,offset,length)=>header.write(text,offset,length,'utf8');
  const octal=(value,width)=>value.toString(8).padStart(width-1,'0')+'\0';
  put(name,0,100);put(octal(0o644,8),100,8);put(octal(0,8),108,8);put(octal(0,8),116,8);put(octal(content.length,12),124,12);put(octal(mtime,12),136,12);put('        ',148,8);put(type,156,1);put('ustar\0',257,6);put('00',263,2);
  const checksum=header.reduce((sum,byte)=>sum+byte,0);put(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);
  chunks.push(header,content,Buffer.alloc((512-content.length%512)%512));
}
for(const [index,file] of releaseFiles.entries()){
  const info=await stat(file);if(!info.isFile())throw new Error('非普通发布文件：'+file);
  const content=await readFile(file),name='package/'+file,mtime=Math.floor(info.mtimeMs/1000);
  if(/[^\x20-\x7e]/.test(name)||Buffer.byteLength(name)>100){
    const body='path='+name+'\n';let length=Buffer.byteLength(body)+3;
    while(Buffer.byteLength(String(length)+' '+body)!==length)length=Buffer.byteLength(String(length)+' '+body);
    appendEntry('PaxHeaders/'+index,Buffer.from(String(length)+' '+body),mtime,'x');
    appendEntry('package/entry-'+index,content,mtime);
  }else appendEntry(name,content,mtime);
}
chunks.push(Buffer.alloc(1024));
const packed=gzipSync(Buffer.concat(chunks)),verified=gunzipSync(packed),listed=[];let paxPath;
for(let position=0;position<verified.length-1024;){
  const header=verified.subarray(position,position+512),name=header.subarray(0,100).toString('utf8').replace(/\0.*$/s,'');
  if(!name)break;
  const size=parseInt(header.subarray(124,136).toString('ascii'),8);
  if(header[156]===120){paxPath=verified.subarray(position+512,position+512+size).toString('utf8').match(/^\d+ path=(.*)\n$/u)?.[1];if(!paxPath)throw new Error('UTF-8 归档路径无效。');}
  else{listed.push((paxPath||name).replace(/^package\//,''));paxPath=undefined;}
  position+=512+Math.ceil(size/512)*512;
}
if(JSON.stringify(listed)!==JSON.stringify(releaseFiles))throw new Error('归档允许名单校验失败。');
const filename=`${pkg.name}-${pkg.version}.tgz`,archive=path.join(destination,filename),digest=createHash('sha256').update(packed).digest('hex');
await writeFile(archive,packed);await writeFile(path.join(destination,'SHA256SUMS.txt'),`${digest}  ${filename}\n`);
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({version:pkg.version,filename,sha256:digest,files:listed},null,2));
console.log(`发布包已生成并通过允许名单检查：${archive}\nSHA-256：${digest}`);
