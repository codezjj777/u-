const normalize = value => String(value ?? '').normalize('NFKC').replace(/<[^>]*>/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const stem = value => normalize(value).replace(/^\s*(?:第\s*)?\d+\s*[.、．)）:]\s*/, '');
const optionText = value => normalize(value).replace(/^[a-z]\s*[.、．)）:]\s*/i, '');
const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(36); };
function safeCourseUrl(value, base = 'https://ucloud.unipus.cn') {
  try { const u = new URL(value, base); return u.protocol === 'https:' && (u.hostname === 'unipus.cn' || u.hostname.endsWith('.unipus.cn')) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function validateEndpoint(value) {
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null; return u.href.replace(/\/$/, ''); } catch { return null; }
}
function validateBank(input) {
  const rows = Array.isArray(input) ? input : input?.questions;
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('题库需要是 JSON 数组，最多 20,000 道题。');
  return rows.map((row, i) => {
    if(row?.kind==='exercise')return validateExercise(row);
    if(row?.images?.length)throw new Error('图片题需要作为包含图片材料的完整大题导入。');
    if (!row || typeof row.question !== 'string' || !stem(row.question) || row.question.length > 20000) throw new Error(`第 ${i + 1} 题缺少有效的 question。`);
    const answers = Array.isArray(row.answer) ? row.answer : [row.answer];
    if (!answers.length || !answers.every(x => typeof x === 'string' && x.trim() && x.length <= 10000)) throw new Error(`第 ${i + 1} 题的 answer 必须是非空文本或文本数组。`);
    if (row.options !== undefined && (!Array.isArray(row.options) || !row.options.every(x => typeof x === 'string'))) throw new Error(`第 ${i + 1} 题的 options 必须是文本数组。`);
    if(row.type!==undefined&&!['single','multiple','text','matching'].includes(row.type))throw new Error(`第 ${i+1} 题的 type 无效。`);
    if(row.type==='matching'&&(!matchingKeys(row)||!resolveAnswer(row,row)))throw new Error(`第 ${i+1} 题的配对句子或答案不完整。`);
    if(row.context!==undefined&&(typeof row.context!=='string'||row.context.length>100000))throw new Error(`第 ${i+1} 题的 context 无效。`);
    if(row.scope!==undefined&&(!row.scope||typeof row.scope!=='object'||Array.isArray(row.scope)||Object.entries(row.scope).some(([key,value])=>!['courseId','unitId','entryKey'].includes(key)||typeof value!=='string'||value.length>2000)))throw new Error(`第 ${i+1} 题的 scope 无效。`);
    if(row.options&&(row.options.length>100||row.options.some(x=>!x.trim()||x.length>20000)))throw new Error(`第 ${i+1} 题的选项数量或长度无效。`);
    return { question: row.question.trim(), answer: answers.map(x => x.trim()), options: row.options?.map(x => x.trim()), explanation: String(row.explanation || '').slice(0, 20000),...(row.type?{type:row.type}:{}),...(row.type==='matching'?{prompts:[...row.prompts],promptEmphasis:row.promptEmphasis.map(words=>[...words])}:{}),...(row.context!==undefined?{context:row.context.trim()}:{}),...(row.scope?{scope:{...row.scope}}:{}) };
  });
}
function buildBankIndex(bank) {
  const map = new Map();map.exercisePages=new Map();
  for (const row of bank) {
    if(row.kind==='exercise'){
      for(const page of row.pages){const key=exercisePageKey(page.questions);if(!map.exercisePages.has(key))map.exercisePages.set(key,[]);map.exercisePages.get(key).push({exercise:row,page});}
    }else{const key = stem(row.question); if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
  }return map;
}
function validateExercise(row){
  const fail=()=>{throw new Error('整题题库记录不完整或格式无效。');};
  const text=(value,max=20000)=>typeof value==='string'&&value.trim()&&value.length<=max;
  const list=(value,max=500)=>Array.isArray(value)&&value.length<=max&&value.every(item=>text(item));
  if(row.version!==1||!text(row.title,5000)||!row.scope||!text(row.scope.courseId,2000)||!text(row.scope.unitId,200)||!text(row.scope.entryKey,5000)||!Array.isArray(row.pages)||!row.pages.length||row.pages.length>30)fail();
  if(row.imageAssets!==undefined&&(!Array.isArray(row.imageAssets)||row.imageAssets.length>100))fail();
  let imageBytes=0;const imageAssets=(row.imageAssets||[]).map(asset=>{
    if(!asset||!/^([a-f0-9]{64})$/.test(asset.digest)||!['image/png','image/jpeg','image/gif','image/webp'].includes(asset.mimeType)||!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1||asset.width*asset.height>40000000||typeof asset.dataURL!=='string'||asset.dataURL.length>12*1024*1024||!asset.dataURL.startsWith('data:'+asset.mimeType+';base64,')||!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.dataURL))fail();
    imageBytes+=asset.dataURL.length;if(imageBytes>64*1024*1024)fail();return {digest:asset.digest,mimeType:asset.mimeType,width:asset.width,height:asset.height,dataURL:asset.dataURL};
  });
  if(new Set(imageAssets.map(asset=>asset.digest)).size!==imageAssets.length)fail();const usedImages=new Set();
  let parts=0;
  const pages=row.pages.map((page,index)=>{
    if(page.number!==index+1||!Array.isArray(page.questions)||!page.questions.length||page.questions.length>500)fail();
    const questions=page.questions.map(question=>{
      parts++;if(!question||!text(question.question)||!['single','multiple','text','matching'].includes(question.type)||!list(question.options,100)||typeof question.context!=='string'||question.context.length>100000||!list(question.wordBank)||!Array.isArray(question.fields)||!question.fields.length||question.fields.length>500||!list(question.answer)||!question.answer.length&&question.type!=='multiple')fail();
      if(question.id!==undefined&&!text(question.id,2000)||question.questionType!==undefined&&!text(question.questionType,200))fail();
      if(question.explanation!==undefined&&(typeof question.explanation!=='string'||question.explanation.length>100000))fail();
      const fields=question.fields.map(field=>{
        if(!field||!['text','editable','select','unipus-select','native','custom','unipus-choice','ipublish-choice','sortable'].includes(field.kind)||field.key!==undefined&&(!text(field.key,2000))||field.inputMode!==undefined&&field.inputMode!=='keyboard')fail();
        if(field.choices!==undefined&&(!Array.isArray(field.choices)||field.choices.length>500))fail();
        const choices=field.choices?.map(choice=>{if(!choice||!text(choice.text)||typeof choice.value!=='string'||choice.value.length>20000)fail();return {text:choice.text,value:choice.value};});
        if(field.items!==undefined&&(!Array.isArray(field.items)||field.items.length<2||field.items.length>100))fail();
        const items=field.items?.map(item=>{if(!item||!text(item.key,2000)||!text(item.text)||item.originalLabel!==undefined&&!/^[A-Z]$/.test(item.originalLabel))fail();return {key:item.key,text:item.text,...(item.originalLabel?{originalLabel:item.originalLabel}:{})};});
        return {kind:field.kind,...(field.key!==undefined?{key:field.key}:{}),...(choices?{choices}:{}),...(items?{items}:{}),...(field.inputMode?{inputMode:field.inputMode}:{})};
      });
      if(question.type==='text'&&(question.options.length||fields.some(field=>!['text','editable','select','unipus-select'].includes(field.kind)||['select','unipus-select'].includes(field.kind)&&!field.choices?.length))||['single','multiple'].includes(question.type)&&fields.some(field=>!['native','custom','unipus-choice','ipublish-choice'].includes(field.kind)))fail();
      if(question.type==='matching'&&(!matchingKeys(question)||fields.length!==1||fields[0].kind!=='sortable'||fields[0].items?.length!==question.options.length||new Set(fields[0].items.map(item=>item.key)).size!==question.options.length||fields[0].items.some((item,i)=>normalize(item.text)!==normalize(question.options[i]))))fail();
      if(question.type!=='matching'&&fields.some(field=>field.items!==undefined))fail();
      if(!Array.isArray(question.blankOptions)||question.blankOptions.some(options=>!list(options))||question.type==='text'&&question.blankOptions.length!==fields.length||question.type!=='text'&&question.blankOptions.length)fail();
      if(question.type==='text'&&question.answer.length!==fields.length||['single','multiple'].includes(question.type)&&(question.options.length<2||fields.length!==question.options.length))fail();
      const result=resolveAnswer({...question,targets:fields},{answer:question.answer});if(!result||result.answers.length!==question.answer.length)fail();
      if(question.type==='text'&&fields.some((field,i)=>JSON.stringify(field.choices?.map(choice=>choice.text)||[])!==JSON.stringify(question.blankOptions[i])))fail();
      if(question.mediaKeys!==undefined&&!list(question.mediaKeys,100))fail();
      if(question.images!==undefined&&(!Array.isArray(question.images)||!question.images.length||question.images.length>12))fail();
      const images=question.images?.map(ref=>{if(!ref||!text(ref.label,200)||!imageAssets.some(asset=>asset.digest===ref.digest))fail();usedImages.add(ref.digest);return {digest:ref.digest,label:ref.label};});
      if(images&&new Set(images.map(ref=>JSON.stringify(ref))).size!==images.length)fail();
      return {question:question.question,type:question.type,options:[...question.options],context:question.context,wordBank:[...question.wordBank],blankOptions:question.blankOptions.map(options=>[...options]),fields,answer:result.answers,explanation:question.explanation||'',...(images?{images}:{}),...(question.type==='matching'?{prompts:[...question.prompts],promptEmphasis:question.promptEmphasis.map(words=>[...words])}:{}),...(question.id?{id:question.id}:{}),...(question.questionType?{questionType:question.questionType}:{}),...(question.mediaKeys?{mediaKeys:[...question.mediaKeys]}:{})};
    });return {number:page.number,questions};
  });
  const verification=row.verification;
  if(parts>500||!verification||verification.method!=='platform-all-correct'||!Number.isInteger(verification.total)||verification.total<1||verification.total!==verification.correct||!['questions','blanks'].includes(verification.unit)||!Number.isFinite(verification.verifiedAt)||verification.verifiedAt<0||!Number.isFinite(row.learnedAt)||row.learnedAt<0)fail();
  const expected=verification.unit==='questions'?parts:pages.reduce((sum,page)=>sum+page.questions.reduce((count,q)=>count+questionPartCount(q),0),0);if(expected!==verification.total)fail();
  for(const label of ['courseTitle','unitLabel'])if(row[label]!==undefined&&(typeof row[label]!=='string'||row[label].length>5000))fail();
  if(usedImages.size!==imageAssets.length)fail();
  return {kind:'exercise',version:1,title:row.title,scope:{courseId:row.scope.courseId,unitId:row.scope.unitId,entryKey:row.scope.entryKey},pages,verification:{method:verification.method,total:verification.total,correct:verification.correct,unit:verification.unit,verifiedAt:verification.verifiedAt},learnedAt:row.learnedAt,...(imageAssets.length?{imageAssets}:{}),...(row.courseTitle!==undefined?{courseTitle:row.courseTitle}:{}),...(row.unitLabel!==undefined?{unitLabel:row.unitLabel}:{})};
}
const exercisePageKey=questions=>JSON.stringify(questions.map(question=>stem(question.question)).sort());
const wordSet=words=>JSON.stringify((words||[]).map(normalize).sort());
function matchingPromptKey(prompt,words=[]){return JSON.stringify([normalize(prompt),words.map(normalize).sort()]);}
function matchingKeys(question){
  const {prompts,promptEmphasis,options}=question;
  if(!Array.isArray(prompts)||prompts.length<2||prompts.length>100||!prompts.every(value=>typeof value==='string'&&value.trim()&&value.length<=20000)||!Array.isArray(promptEmphasis)||promptEmphasis.length!==prompts.length||!promptEmphasis.every(words=>Array.isArray(words)&&words.length<=100&&words.every(value=>typeof value==='string'&&value.trim()&&value.length<=20000))||!Array.isArray(options)||options.length!==prompts.length||!options.every(value=>typeof value==='string'&&value.trim()&&value.length<=20000)||new Set(options.map(normalize)).size!==options.length)return null;
  const keys=prompts.map((prompt,i)=>matchingPromptKey(prompt,promptEmphasis[i]));return new Set(keys).size===keys.length?keys:null;
}
function questionPartCount(question){return question.type==='matching'?question.prompts.length:question.type==='text'?(question.targets||question.fields).length:1;}
function exerciseAnswersIdentity(exercise){return JSON.stringify(exercise.pages.map(page=>page.questions.map(q=>q.type==='matching'?q.prompts.map((prompt,i)=>[matchingPromptKey(prompt,q.promptEmphasis[i]),normalize(q.answer[i])]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0):q.type==='text'?q.answer:q.answer.map(optionText).sort())));}
const blankOptionsFor=question=>question.blankOptions?.length?question.blankOptions:(question.targets||question.fields||[]).map(field=>field.choices?.map(choice=>choice.text)||[]);
function exercisePartIdentity(question){
  const fields=question.targets||question.fields||[];
  return [stem(question.question),question.type,normalize(question.context),question.type==='matching'?wordSet(question.options):optionSet(question.options),wordSet(question.wordBank),fields.length,question.type==='text'?blankOptionsFor(question).map(wordSet):[],question.questionType||'',question.type==='matching'?(matchingKeys(question)||[]).sort():[],(question.images||[]).map(image=>[image.digest,normalize(image.label)])];
}
function exerciseIdentity(exercise){return JSON.stringify([exercise.scope,exercise.pages.map(page=>page.questions.map(exercisePartIdentity))]);}
const exerciseAnswerIdentity=answer=>answer.ordered?['ordered',answer.answers.map(normalize)]:answer.indexes.length?['choices',answer.indexes.slice().sort((a,b)=>a-b)]:['text',answer.answers.map(normalize)];
function matchExercisePage(questions,scope,index){
  const candidates=index.exercisePages?.get(exercisePageKey(questions))||[],results=[];
  for(const {exercise,page} of candidates){
    if(Object.entries(exercise.scope).some(([key,value])=>value!==scope?.[key])||page.questions.length!==questions.length)continue;
    const used=new Set(),answers=[];
    for(const question of questions){
      const identity=exercisePartIdentity(question),matches=[];
      for(const [i,part] of page.questions.entries())if(!used.has(i)){
        const current=[...identity],saved=exercisePartIdentity(part);if(!question.questionType||!part.questionType){current[7]='';saved[7]='';}
        if(JSON.stringify(current)!==JSON.stringify(saved))continue;
        const answer=resolveAnswer(question,question.type==='matching'?part:{answer:part.answer});if(answer)matches.push({i,answer,part});
      }
      if(!matches.length||new Set(matches.map(match=>JSON.stringify(exerciseAnswerIdentity(match.answer)))).size!==1)break;
      used.add(matches[0].i);answers.push({...matches[0].answer,source:'整题题库',explanation:matches[0].part.explanation,matchBasis:'整页全部小题、选项、空位与材料'});
    }
    if(answers.length===questions.length)results.push(answers);
  }
  if(!results.length||new Set(results.map(result=>JSON.stringify(result.map(exerciseAnswerIdentity)))).size!==1)return null;
  return results[0];
}
const optionSet = options => JSON.stringify((options||[]).map(optionText).sort());
function matchesIdentity(question,row) {
  if(question.images?.length)return false;
  if(row.type&&row.type!==question.type)return false;
  if(question.type==='matching'&&(!matchingKeys(question)||!matchingKeys(row)||JSON.stringify(matchingKeys(question).sort())!==JSON.stringify(matchingKeys(row).sort())))return false;
  if(row.options&&optionSet(row.options)!==optionSet(question.options))return false;
  if(Object.entries(row.scope||{}).some(([key,value])=>value!==question.scope?.[key]))return false;
  if(normalize(question.context)||row.context!==undefined){if(normalize(row.context)!==normalize(question.context))return false;}
  return true;
}
function questionSignature(questions) {
  return JSON.stringify(questions.map(q=>[stem(q.question),q.options,q.type,normalize(q.context),q.targets?.map(target=>[target.kind,target.key,target.choices,target.inputMode,target.items?.map(item=>[item.key,item.text])]),q.id,q.wordBank,q.blankOptions,q.mediaKeys,q.scope,q.questionType,q.prompts,q.promptEmphasis,q.imageKeys,(q.images||[]).map(image=>[image.digest,image.label])]));
}
function resolveAnswer(question, row) {
  if(question.type==='matching'){
    const keys=matchingKeys(question);if(!keys||!Array.isArray(row.answer)||row.answer.length!==keys.length)return null;
    let values=row.answer;
    if(row.prompts!==undefined){const saved=matchingKeys(row);if(!saved||saved.length!==keys.length||keys.some(key=>!saved.includes(key)))return null;values=keys.map(key=>row.answer[saved.indexOf(key)]);}
    const options=question.options.map(normalize),indexes=values.map(value=>options.indexOf(normalize(value)));
    if(indexes.some(i=>i<0)||new Set(indexes).size!==keys.length)return null;
    return {answers:indexes.map(i=>question.options[i]),indexes,ordered:true};
  }
  if (question.type==='text'||!question.options?.length) {
    if(question.targets?.length&&row.answer.length!==question.targets.length)return null;
    const answers=[];
    for(const [i,value] of row.answer.entries()){
      const choices=question.targets?.[i]?.choices;
      if(choices?.length){const matches=choices.filter(choice=>normalize(choice.text)===normalize(value));if(matches.length!==1)return null;answers.push(matches[0].text);}
      else answers.push(value);
    }
    return { answers, indexes: [] };
  }
  const options = question.options.map(optionText);
  const indexes = [];
  for (const answer of row.answer) {
    let text = optionText(answer);
    if (/^[a-z]$/i.test(answer.trim())) {
      const n = answer.trim().toUpperCase().charCodeAt(0) - 65;
      // Letters only have meaning relative to the bank's original option order.
      // Without that order, a literal one-letter option is still valid.
      if(row.options?.[n])text=optionText(row.options[n]);
      else if(!options.includes(text))return null;
    }
    const candidates = options.flatMap((o, i) => o === text ? [i] : []);
    if (candidates.length !== 1) return null;
    indexes.push(candidates[0]);
  }
  const unique = [...new Set(indexes)];
  if (question.type === 'single' && unique.length !== 1) return null;
  return { answers: unique.map(i => question.options[i]), indexes: unique };
}
function matchAnswer(question, index) {
  const rows = index.get(stem(question.question)) || [];
  const results = rows.filter(row=>matchesIdentity(question,row)).map(row => ({ row, match: resolveAnswer(question, row) })).filter(x => x.match);
  if (!results.length) return null;
  const signatures = new Set(results.map(x => JSON.stringify(exerciseAnswerIdentity(x.match))));
  if (signatures.size !== 1) return null;
  return { ...results[0].match, source: '题库', explanation: results[0].row.explanation,matchBasis:results[0].row.context?'题干、选项与材料':results[0].row.options?'题干与完整选项':'题干与答案文本（旧格式）' };
}
function parseModelAnswer(content, question) {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data; try { data = JSON.parse(cleaned); } catch { throw new Error('AI 未返回有效 JSON，已停止填答。'); }
  if(data&&typeof data==='object'&&!Array.isArray(data)&&(data.status==='missing_material'||Array.isArray(data.answers)&&data.answers.length===0))throw Object.assign(new Error('AI 未给出可用答案（返回空答案或报告材料不足），请核对题目所需信息与实际材料。'),{code:'AI_MISSING_MATERIAL'});
  if (!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.answers))throw new Error('AI 返回的答案格式无效：answers 必须是文本数组。');
  if(!data.answers.every(x => typeof x === 'string' && x.trim()&&x.length<=20000))throw new Error('AI 返回的答案格式无效：每个答案必须是非空文本且不超过长度限制。');
  if(question.type==='text'&&question.targets?.length&&data.answers.length!==question.targets.length)throw new Error(`AI 答案数量（${data.answers.length}）与页面空格数量（${question.targets.length}）不一致，已停止填答。`);
  if(question.type==='matching'&&data.answers.length!==question.prompts?.length)throw new Error(`AI 配对数量（${data.answers.length}）与左侧句子数量（${question.prompts?.length}）不一致，已停止填答。`);
  // Model must return option text, never assume its letter order.
  const result = resolveAnswer(question, { answer: data.answers });
  if (!result) throw new Error('AI 答案与当前选项不一致，已停止填答。');
  return { ...result, source: 'AI', explanation: String(data.explanation || '') };
}
function cleanCourseGroup(group) {
  if(!group||typeof group.name!=='string'||typeof group.className!=='string'||typeof group.period!=='string')return undefined;
  const value={name:group.name.trim().slice(0,200),className:group.className.trim().slice(0,200),period:group.period.trim().slice(0,100)};
  return value.name&&value.className&&value.period?value:undefined;
}
const courseGroupKey = group => {const value=cleanCourseGroup(group);return value?JSON.stringify([value.name,value.className,value.period].map(normalize)):'';};
const courseLabel = course => [course.title,course.group?.name,course.group?.className,course.group?.period].filter(Boolean).join(' · ');
function mergeCourses(old, incoming) {
  const map = new Map(old.map(x => [x.id, x]));
  for (const item of incoming) {
    const url = safeCourseUrl(item.url);
    if (!url || !item.title?.trim()) continue;
    const id = item.id || hash(url);
    const group=cleanCourseGroup(item.group);
    const progress=Number.isFinite(item.progress)?Math.max(0,Math.min(100,item.progress)):item.status==='completed'?100:null;
    const entry = item.entry && typeof item.entry.title === 'string' && Number.isInteger(item.entry.pageIndex) && item.entry.pageIndex >= 0 && item.entry.pageIndex < 50 ? { title:item.entry.title.slice(0,200), pageIndex:item.entry.pageIndex } : undefined;
    map.set(id, { ...map.get(id), id, url, title: String(item.title).slice(0, 200), subtitle: String(item.subtitle || '').slice(0, 200), progress, status:progress===100?'completed':'active', syncedAt: Date.now(), source: 'platform',group,requiresActivation:item.requiresActivation===true,...(entry?{entry}:{}) });
  }
  return [...map.values()];
}

export { normalize, stem, optionText, hash, safeCourseUrl, validateEndpoint, validateBank, validateExercise, exerciseIdentity, exerciseAnswersIdentity, matchingPromptKey, questionPartCount, matchExercisePage, buildBankIndex, resolveAnswer, matchAnswer, parseModelAnswer, mergeCourses,courseGroupKey,courseLabel,questionSignature };
