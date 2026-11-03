import * as UStudy from './shared/core.mjs';

export const defaultSettings=Object.freeze({aiEnabled:false,endpoint:'',model:'',autoSubmit:false,oralMode:'short',questionSelector:'',nextSelector:'',submitSelector:''});
export function validateSettings(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('设置格式无效。');
  for(const key of ['aiEnabled','autoSubmit'])if(input[key]!==undefined&&typeof input[key]!=='boolean')throw new Error(`${key} 必须是布尔值。`);
  if(input.oralMode!==undefined&&!['short','retell'].includes(input.oralMode))throw new Error('口语录音模式无效。');
  const text=(key,max=500)=>{
    if(input[key]!==undefined&&typeof input[key]!=='string')throw new Error(`${key} 必须是文本。`);
    const value=(input[key]||'').trim();if(value.length>max)throw new Error('设置内容过长。');return value;
  };
  const settings={aiEnabled:input.aiEnabled===true,autoSubmit:input.autoSubmit===true,oralMode:input.oralMode||'short',endpoint:text('endpoint',2048),model:text('model',200),questionSelector:text('questionSelector'),nextSelector:text('nextSelector'),submitSelector:text('submitSelector')};
  if(settings.endpoint){const normalized=UStudy.validateEndpoint(settings.endpoint);if(!normalized)throw new Error('AI 接口必须是没有用户名、密码、查询参数的 HTTPS 地址。');settings.endpoint=normalized;}
  if(settings.aiEnabled&&(!settings.endpoint||!settings.model))throw new Error('启用 AI 时需填写接口地址和模型。');
  return settings;
}
