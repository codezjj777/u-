import * as UStudy from './shared/core.mjs';

function connectionError(message){return Object.assign(new Error(message),{status:400});}

function httpError(status){
  if(status>=300&&status<400)return '接口返回重定向，请填写最终的 HTTPS Chat Completions 地址。';
  const messages={
    400:'请求格式或模型参数不被支持，请检查接口地址和模型名称。',
    401:'认证失败，请检查 API Key 是否有效。',
    402:'服务商余额不足，请检查账号额度。',
    403:'访问被拒绝，请检查账号权限、模型权限或 IP 限制。',
    404:'接口或模型不存在，请检查完整的接口路径和模型名称。',
    422:'模型参数不被支持，请确认接口兼容 Chat Completions。',
    429:'请求受限，请检查服务商额度，或稍后重试。'
  };
  return `${messages[status]||(status>=500?'AI 服务暂时不可用，请稍后重试。':'AI 接口拒绝了测试请求，请检查服务商配置。')}（HTTP ${status}）`;
}

export async function testAIConnection({endpoint,model,apiKey},{fetchImpl=fetch,timeoutMs=20000,signal}={}){
  if(typeof endpoint!=='string'||endpoint.length>2048||!UStudy.validateEndpoint(endpoint))throw connectionError('请填写有效的 HTTPS 接口地址。');
  if(typeof model!=='string'||!model.trim()||model.length>200)throw connectionError('请填写有效的模型名称。');
  if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192)throw connectionError('请填写本次测试使用的 API Key。');
  const timeout=AbortSignal.timeout(timeoutMs),requestSignal=signal?AbortSignal.any([timeout,signal]):timeout;
  const started=performance.now();let response;
  try{
    response=await fetchImpl(endpoint.trim(),{
      method:'POST',redirect:'manual',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey.trim()}`},
      body:JSON.stringify({model:model.trim(),stream:false,messages:[{role:'user',content:'Connection test. Reply with exactly OK.'}]}),
      signal:requestSignal
    });
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw connectionError(httpError(response.status));}
    let data;try{data=await response.json();}catch(error){if(requestSignal.aborted)throw error;throw connectionError('接口返回了非 JSON 内容，请检查是否填写了完整的 Chat Completions 地址。');}
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim())throw connectionError('接口已有响应，但没有返回可用的 Chat Completions 文本，请检查模型与接口兼容性。');
    return {ok:true,model:model.trim(),latencyMs:Math.max(1,Math.round(performance.now()-started))};
  }catch(error){
    if(timeout.aborted)throw connectionError('连接测试超时（20 秒），请检查网络、接口地址或稍后重试。');
    if(signal?.aborted)throw connectionError('连接测试已取消。');
    if(error.status)throw error;
    const code=String(error.cause?.code||error.code||'');
    if(/CERT|TLS|SSL/i.test(code))throw connectionError('AI 接口证书校验失败，请检查系统时间和服务商证书。');
    throw connectionError('无法连接 AI 接口，请检查网络和 HTTPS 地址。');
  }
}
