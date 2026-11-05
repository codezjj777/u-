import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,mkdir,copyFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {assertRuntime,rotateLogs,APP_VERSION,sourceBuildId} from '../runtime-check.mjs';
import {releaseFiles} from '../release-files.mjs';
import {showBrowserPage,createBackgroundPage} from '../browser-session.mjs';

function backgroundFixture({publish=true,fail=false}={}){
  const requests=[],anchor={isClosed:()=>false,id:'anchor'},other={isClosed:()=>false,id:'other'},created={isClosed:()=>false,id:'new'},pages=[anchor];
  const context={pages:()=>pages,newPage:async()=>assert.fail('must not use foreground creation'),newCDPSession:async page=>({send:async(method,input)=>{
    requests.push({method,input});if(method==='Target.getTargetInfo')return {targetInfo:{targetId:page.id,browserContextId:'own-context'}};
    if(method==='Target.createTarget'){if(fail)throw new Error('unsupported');if(publish)pages.push(other,created);return {targetId:'new'};}
    if(method==='Target.closeTarget')return {success:true};assert.fail(method);
  },detach:async()=>{}})};
  return {context,requests,created};
}
test('automatic page creation requests an unfocused background target in exactly the source browser context',async()=>{
  const f=backgroundFixture();assert.equal(await createBackgroundPage(f.context),f.created);const request=f.requests.find(v=>v.method==='Target.createTarget');
  assert.equal(request.input.background,true);assert.equal(request.input.focus,false);assert.equal(request.input.browserContextId,'own-context');assert.match(request.input.url,/^about:blank#ustudy-background-/);assert.equal(f.requests.some(v=>/activateTarget|bringToFront|setWindowBounds/.test(v.method)),false);
});
test('background creation failures never fall back to foreground creation or close an existing page',async()=>{
  const f=backgroundFixture({fail:true});await assert.rejects(createBackgroundPage(f.context),/unsupported/);assert.equal(f.requests.some(v=>v.method==='Target.closeTarget'),false);
  const timeout=backgroundFixture({publish:false});await assert.rejects(createBackgroundPage(timeout.context,{timeoutMs:0}),/超时/);assert.deepEqual(timeout.requests.filter(v=>v.method==='Target.closeTarget').map(v=>v.input),[{targetId:'new'}]);
});

test('showing our lesson restores a minimized window while preserving normal and maximized layouts',async()=>{
  for(const windowState of ['minimized','normal','maximized']){
    let state=windowState,restored=0,detached=0,focused=0;
    const page={context:()=>({newCDPSession:async()=>({send:async(method,input)=>{if(method==='Browser.getWindowForTarget')return {windowId:42,bounds:{windowState:state}};assert.equal(input.windowId,42);state=input.bounds.windowState;restored++;},detach:async()=>{detached++;}})}),bringToFront:async()=>{focused++;}};
    await showBrowserPage(page);assert.equal(state,windowState==='minimized'?'normal':windowState);assert.equal(restored,windowState==='minimized'?1:0);assert.equal(focused,1);assert.equal(detached,1);
  }
});

test('lesson focusing remains available when window state cannot be inspected',async()=>{
  let focused=0;await showBrowserPage({context:()=>({newCDPSession:async()=>{throw new Error('unavailable');}}),bringToFront:async()=>{focused++;}});assert.equal(focused,1);
});

test('runtime requirements and release allowlist match the declared package',async()=>{
  assert.throws(()=>assertRuntime('20.18.0'),/20.19/);assert.throws(()=>assertRuntime('18.20.0'),/20.19/);assert.doesNotThrow(()=>assertRuntime('20.19.0'));assert.doesNotThrow(()=>assertRuntime('24.0.0'));
  const pkg=JSON.parse(await readFile('package.json','utf8'));assert.deepEqual(pkg.files,releaseFiles);assert.equal(APP_VERSION,pkg.version);
  assert.equal(new Set(releaseFiles).size,releaseFiles.length);
  for(const file of releaseFiles){assert.equal((await stat(file)).isFile(),true);assert.doesNotMatch(file,/(?:^|\/)(?:\.runtime|\.cache|node_modules|tests)(?:\/|$)/);}
});
test('log rotation keeps bounded old logs without touching other local files',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/rotation-test-'));
  try{
    await writeFile(path.join(directory,'unrelated.json'),'keep');
    for(const [name,value] of [['server.log','current log'],['server.log.1','first backup'],['server.log.2','second backup']])await writeFile(path.join(directory,name),value);
    await rotateLogs(directory,{maxBytes:4});
    assert.equal(await readFile(path.join(directory,'server.log.1'),'utf8'),'current log');assert.equal(await readFile(path.join(directory,'server.log.3'),'utf8'),'second backup');assert.equal(await readFile(path.join(directory,'unrelated.json'),'utf8'),'keep');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('build identity detects same-version code and dependency edits while excluding local data and documentation',async()=>{
  const directory=await mkdtemp(path.resolve('.cache/build-id-'));
  try{
    await Promise.all(releaseFiles.map(async file=>{const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(new URL('../'+file,import.meta.url),target);}));
    const initial=await sourceBuildId(directory);assert.equal(initial,await sourceBuildId());assert.match(initial,/^[a-f0-9]{64}$/);
    await mkdir(path.join(directory,'.runtime'));await writeFile(path.join(directory,'.runtime/state.json'),'private local data');await appendFile(path.join(directory,'README.md'),'\nDocumentation edit');assert.equal(await sourceBuildId(directory),initial);
    await appendFile(path.join(directory,'lesson-actions.mjs'),'\n// Same version, updated behavior\n');const changed=await sourceBuildId(directory);assert.notEqual(changed,initial);
    await appendFile(path.join(directory,'package-lock.json'),'\n');assert.notEqual(await sourceBuildId(directory),changed);
    await rm(path.join(directory,'lesson-actions.mjs'));await assert.rejects(sourceBuildId(directory),error=>error.code==='ENOENT');
  }finally{await rm(directory,{recursive:true,force:true});}
});
