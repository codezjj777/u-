import test from 'node:test';
import assert from 'node:assert/strict';
import {askModel,AIRequestError} from '../answer-provider.mjs';
import {setTimeout as sleep} from 'node:timers/promises';

const settings={endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture-model'},key='private-provider-key';
const question={question:'Choose the correct answer.',type:'single',options:['yes','no'],context:'The answer is yes.',targets:[{},{}]};
const completion=(content='{"answers":["yes"]}',finish_reason='stop')=>new Response(JSON.stringify({choices:[{message:{content},finish_reason}]}),{headers:{'Content-Type':'application/json'}});
const reset=()=>Object.assign(new TypeError('fetch failed with '+key),{cause:{code:'ECONNRESET'}});

test('pending AI progress separates response waiting from answer generation and ends after completion',async()=>{
  const events=[];
  const answer=await askModel(question,settings,key,undefined,{progressIntervalMs:2,onProgress:event=>events.push(event),fetchImpl:async()=>{await sleep(12);return {ok:true,json:async()=>{await sleep(12);return {choices:[{message:{content:'{"answers":["yes"]}'}}],usage:{prompt_tokens:50,completion_tokens:12,completion_tokens_details:{reasoning_tokens:4}}};}};}});
  assert.deepEqual(answer.answers,['yes']);assert.equal(events[0].stage,'request');assert.ok(events.some(event=>event.stage==='waiting'&&event.phase==='waiting-response'));assert.ok(events.some(event=>event.stage==='waiting'&&event.phase==='receiving-answer'));
  const completed=events.at(-1);assert.equal(completed.stage,'complete');assert.equal(completed.attempt,1);assert.equal(completed.maxAttempts,3);assert.equal(completed.reasoningTokens,4);assert.ok(completed.elapsedMs>=completed.headersMs);assert.ok(completed.bodyMs>=0);assert.doesNotMatch(JSON.stringify(events),new RegExp(key));const count=events.length;await sleep(15);assert.equal(events.length,count);
});

test('AI progress timers stop on timeout and never report a completed answer',async()=>{
  const events=[];
  await assert.rejects(askModel(question,settings,key,undefined,{timeoutMs:12,maxAttempts:1,progressIntervalMs:2,onProgress:event=>events.push(event),fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>{const keepAlive=setTimeout(()=>reject(new Error('timeout not cancelled')),200);signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(signal.reason);},{once:true});})}),error=>error.code==='AI_TIMEOUT');
  assert.equal(events.some(event=>event.stage==='complete'),false);const count=events.length;await sleep(15);assert.equal(events.length,count);
});

test('diagnostic callback failures cannot discard an otherwise valid AI answer',async()=>{
  const answer=await askModel(question,settings,key,undefined,{onProgress:()=>{throw new Error(key);},fetchImpl:async()=>completion()});assert.deepEqual(answer.answers,['yes']);
});

test('answer requests retry connection resets three times with the identical payload and safe progress',async()=>{
  const requests=[],retries=[];let calls=0,before=0;
  const answer=await askModel(question,settings,key,undefined,{retryDelayMs:0,beforeAttempt:()=>before++,onRetry:event=>retries.push(event),fetchImpl:async(url,options)=>{
    requests.push([url,options.body]);assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.redirect,'manual');assert.equal(JSON.parse(options.body).stream,false);if(++calls<3)throw reset();return completion();
  }});
  assert.deepEqual(answer.answers,['yes']);assert.equal(calls,3);assert.equal(before,3);assert.equal(new Set(requests.map(JSON.stringify)).size,1);assert.deepEqual(retries.map(item=>item.nextAttempt),[2,3]);assert.ok(retries.every(item=>item.reason.includes('ECONNRESET')));assert.doesNotMatch(JSON.stringify(retries),new RegExp(key));
});

test('temporary rate limits and service failures recover while authentication, quota and configuration failures stop immediately',async()=>{
  for(const status of [408,429,500,502,503,504]){let calls=0;const answer=await askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>++calls===1?new Response(key,{status}):completion()});assert.deepEqual(answer.answers,['yes']);assert.equal(calls,2);}
  for(const [status,pattern] of [[400,/请求参数/],[401,/认证失败/],[402,/余额不足/],[403,/访问被拒绝/],[404,/接口或模型不存在/],[413,/材料超过/],[422,/参数不被支持/]]){
    let calls=0,cancelled=0;
    await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;return {ok:false,status,body:{cancel:async()=>cancelled++},json:async()=>assert.fail('never reflect upstream bodies')};}}),error=>{assert.ok(error instanceof AIRequestError);assert.match(error.message,pattern);assert.equal(error.retryable,false);assert.equal(error.httpStatus,status);assert.equal(error.message.includes(key),false);return true;});assert.equal(calls,1);assert.equal(cancelled,1);
  }
});

test('persistent transient failures are bounded and preserve only allowlisted diagnostic codes',async()=>{
  let calls=0;await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;throw reset();}}),error=>{assert.equal(error.attempts,3);assert.equal(error.retryable,true);assert.equal(error.networkCode,'ECONNRESET');assert.match(error.message,/已尝试 3 次/);assert.equal(error.message.includes(key),false);return true;});assert.equal(calls,3);
  await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,maxAttempts:1,fetchImpl:async()=>{throw Object.assign(new TypeError(key),{cause:{code:key}});}}),error=>!JSON.stringify(error).includes(key)&&!error.message.includes(key));
});

test('DNS, nested socket and aggregate network errors retain safe reasons',async()=>{
  for(const [code,pattern] of [['ENOTFOUND',/域名解析/],['UND_ERR_BODY_TIMEOUT',/网络连接超时/],['UND_ERR_SOCKET',/网络连接中断/]]){
    await assert.rejects(askModel(question,settings,key,undefined,{maxAttempts:1,fetchImpl:async()=>{throw new TypeError(key,{cause:new AggregateError([Object.assign(new Error(key),{code})])});}}),error=>{assert.match(error.message,pattern);assert.equal(error.networkCode,code);assert.equal(error.retryable,true);assert.equal(error.message.includes(key),false);return true;});
  }
});

test('certificate errors and redirects never trigger repeated requests or disclose upstream details',async()=>{
  for(const code of ['CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID']){let calls=0;await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;throw Object.assign(new TypeError(key),{cause:{code}});}}),error=>{assert.match(error.message,/证书/);assert.equal(error.retryable,false);assert.equal(error.message.includes(key),false);return true;});assert.equal(calls,1);}
  let calls=0;await assert.rejects(askModel(question,settings,key,undefined,{fetchImpl:async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://other.example.test/'+key}});}}),/重定向/);assert.equal(calls,1);
});

test('Retry-After is respected and long server cooldowns do not get clamped into premature retries',async()=>{
  let calls=0;const started=performance.now();await askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>++calls===1?new Response(null,{status:429,headers:{'Retry-After':'0.025'}}):completion()});assert.equal(calls,2);assert.ok(performance.now()-started>=20);
  calls=0;await assert.rejects(askModel(question,settings,key,undefined,{fetchImpl:async()=>{calls++;return new Response(null,{status:503,headers:{'Retry-After':new Date(Date.now()+3600000).toUTCString()}});}}),error=>{assert.equal(error.attempts,1);assert.equal(error.retryable,true);assert.match(error.message,/至少等待/);assert.ok(error.retryAfterMs>3500000);return true;});assert.equal(calls,1);
});

test('keep-alive whitespace is harmless and interrupted bodies or empty completions can recover',async()=>{
  const answer=await askModel(question,settings,key,undefined,{fetchImpl:async()=>new Response('\n\n  '+JSON.stringify({choices:[{message:{content:'{"answers":["yes"]}'}}]}))});assert.deepEqual(answer.answers,['yes']);
  for(const broken of [()=>new Response('{"choices":['),()=>({ok:true,json:async()=>{throw Object.assign(new TypeError(key),{cause:{code:'UND_ERR_SOCKET'}});}}),()=>completion('')]){let calls=0;await askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>++calls===1?broken():completion()});assert.equal(calls,2);}
});

test('HTML endpoints, truncated model output and invalid question answers stop without guessing or retry loops',async()=>{
  for(const [response,pattern] of [[()=>new Response('<html>'+key+'</html>',{headers:{'Content-Type':'text/html'}}),/非 JSON/],[()=>completion('{"answers":["yes"]}','length'),/被截断/],[()=>completion('{"answers":["invented"]}'),/选项不一致/],[()=>completion('not-json'),/有效 JSON/]]){
    let calls=0;await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;return response();}}),error=>{assert.match(error.message,pattern);assert.equal(error.message.includes(key),false);return true;});assert.equal(calls,1);
  }
});

test('an explicit empty answer means missing material, not malformed JSON, and is never guessed or automatically retried',async()=>{
  for(const content of ['{"answers":[],"explanation":"missing material"}','{"answers":[],"explanation":"private-provider-key"}','{"answers":["yes"],"status":"missing_material"}']){
    let calls=0;await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,fetchImpl:async()=>{calls++;return completion(content);}}),error=>{assert.ok(error instanceof AIRequestError);assert.equal(error.code,'AI_MISSING_MATERIAL');assert.equal(error.retryable,false);assert.match(error.message,/材料/);assert.doesNotMatch(error.message,/格式无效|private-provider-key/);return true;});assert.equal(calls,1);
  }
});

test('statement corrections receive the full transcript and explicit Correct-or-corrected-sentence instructions',async()=>{
  const q={question:'A false statement.',type:'text',options:[],targets:[{kind:'text'}],context:'Read the statements again. Correct the false ones. Original video transcript.'};
  const result=await askModel(q,settings,key,undefined,{fetchImpl:async(url,options)=>{const request=JSON.parse(options.body),data=JSON.parse(request.messages[1].content);assert.match(request.messages[0].content,/corrected full sentence/);assert.match(request.messages[0].content,/never True\/False/);assert.equal(data.passage,q.context);assert.equal(data.blankCount,1);return completion('{"answers":["Correct"]}');}});assert.deepEqual(result.answers,['Correct']);
});

test('per-attempt timeout aborts the old request and a later attempt can succeed',async()=>{
  let calls=0,aborted=0;const answer=await askModel(question,settings,key,undefined,{timeoutMs:10,retryDelayMs:0,fetchImpl:async(url,{signal})=>{
    if(++calls>1)return completion();return new Promise((resolve,reject)=>{const hold=setTimeout(()=>resolve(completion()),200);signal.addEventListener('abort',()=>{clearTimeout(hold);aborted++;reject(signal.reason);},{once:true});});
  }});assert.equal(calls,2);assert.equal(aborted,1);assert.deepEqual(answer.answers,['yes']);
});

test('cancellation before a request, during a request and during backoff prevents every further attempt',async()=>{
  const first=new AbortController();first.abort(new Error('fixture-stop'));let calls=0;await assert.rejects(askModel(question,settings,key,first.signal,{fetchImpl:async()=>{calls++;return completion();}}),/fixture-stop/);assert.equal(calls,0);
  const second=new AbortController();await assert.rejects(askModel(question,settings,key,second.signal,{retryDelayMs:0,fetchImpl:async(url,{signal})=>{calls++;queueMicrotask(()=>second.abort(new Error('fixture-stop')));return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}),/fixture-stop/);assert.equal(calls,1);
  const third=new AbortController();calls=0;await assert.rejects(askModel(question,settings,key,third.signal,{onRetry:()=>third.abort(),fetchImpl:async()=>{calls++;throw reset();}}),/aborted/);assert.equal(calls,1);
});

test('task checkpoints run before every automatic retry and can stop stale-question requests',async()=>{
  let calls=0,checks=0;await assert.rejects(askModel(question,settings,key,undefined,{retryDelayMs:0,beforeAttempt:()=>{if(++checks===2)throw new Error('fixture-question-changed');},fetchImpl:async()=>{calls++;throw reset();}}),/fixture-question-changed/);assert.equal(calls,1);assert.equal(checks,2);
});
