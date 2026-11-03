import test from 'node:test';
import assert from 'node:assert/strict';
import {testAIConnection} from '../ai-connection.mjs';

const config={endpoint:'https://ai.example.test/v1/chat/completions',model:'test-model',apiKey:'test-secret-for-probe'};
const completion=content=>new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});

test('AI connection sends a minimal completion request and returns only model and latency',async()=>{
  let calls=0;
  const result=await testAIConnection(config,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,config.endpoint);assert.equal(options.headers.Authorization,`Bearer ${config.apiKey}`);
    const body=JSON.parse(options.body);assert.equal(body.model,config.model);assert.equal(body.stream,false);assert.equal(body.messages.length,1);
    assert.match(body.messages[0].content,/Connection test/);assert.equal(options.redirect,'manual');
    return completion('OK');
  }});
  assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.model,config.model);assert.ok(result.latencyMs>=1);assert.equal(JSON.stringify(result).includes(config.apiKey),false);
});

test('AI connection rejects incomplete or unsafe configuration before sending credentials',async()=>{
  let calls=0;const options={fetchImpl:async()=>{calls++;return completion('OK');}};
  for(const patch of [{endpoint:'http://ai.example.test/v1'},{endpoint:'https://user:secret@ai.example.test/v1'},{endpoint:'https://ai.example.test/v1?key=secret'},{model:''},{apiKey:''}])await assert.rejects(testAIConnection({...config,...patch},options));
  assert.equal(calls,0);
});

test('AI connection provides actionable HTTP errors without reflecting upstream secrets',async()=>{
  const cases=[[400,/请求格式/],[401,/认证失败/],[402,/余额不足/],[403,/访问被拒绝/],[404,/接口或模型不存在/],[422,/模型参数/],[429,/请求受限/],[503,/暂时不可用/]];
  for(const [status,pattern] of cases)await assert.rejects(testAIConnection(config,{fetchImpl:async()=>new Response(JSON.stringify({error:{message:config.apiKey}}),{status})}),error=>{assert.match(error.message,pattern);assert.equal(error.message.includes(config.apiKey),false);return true;});
});

test('AI connection never follows redirects with the API Key',async()=>{
  let calls=0;await assert.rejects(testAIConnection(config,{fetchImpl:async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://other.example.test/'}});}}),/重定向/);assert.equal(calls,1);
});

test('AI connection distinguishes invalid JSON from incompatible completion responses',async()=>{
  await assert.rejects(testAIConnection(config,{fetchImpl:async()=>new Response('<html>provider landing page</html>')}),/非 JSON/);
  for(const content of [null,'',[]])await assert.rejects(testAIConnection(config,{fetchImpl:async()=>completion(content)}),/没有返回可用/);
});

test('AI connection timeout aborts the request instead of leaving a pending probe',async()=>{
  await assert.rejects(testAIConnection(config,{timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{
    const hold=setTimeout(()=>resolve(completion('late')),200);
    signal.addEventListener('abort',()=>{clearTimeout(hold);reject(signal.reason);},{once:true});
  })}),/连接测试超时/);
});

test('AI connection cancellation and network errors do not expose the request key',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(testAIConnection(config,{signal:controller.signal,fetchImpl:async(url,{signal})=>{signal.throwIfAborted();}}),/已取消/);
  await assert.rejects(testAIConnection(config,{fetchImpl:async()=>{throw new Error('failed with '+config.apiKey);}}),error=>{assert.match(error.message,/无法连接/);assert.equal(error.message.includes(config.apiKey),false);return true;});
  await assert.rejects(testAIConnection(config,{fetchImpl:async()=>{throw Object.assign(new Error('network'),{cause:{code:'CERT_HAS_EXPIRED'}});}}),/证书校验失败/);
});
