import {questionPartCount,resolveAnswer} from './shared/core.mjs';

const exact=value=>String(value).normalize('NFKC').replace(/\s+/g,' ').trim();
const responseKey=answers=>JSON.stringify(answers.map(exact));
const count=value=>Number.isInteger(value)&&value>=0;
const gradingKeys=['total','objective','subjective','correct','incorrect','partial','unanswered'];

// Only the click-time capture is eligible. AI drafts and a page's current
// editable values cannot establish what the platform actually graded.
export function captureCorrectionAttempt(snapshot,submitted,feedback){
  if(!snapshot?.signature||!feedback?.summary||feedback.grading?.pending||feedback.gradingStable===false||!Array.isArray(submitted)||submitted.length!==snapshot.questions.length||submitted.length>500)return null;
  if(snapshot.navigation?.key&&feedback.navigationKey&&snapshot.navigation.key!==feedback.navigationKey)return null;
  if(snapshot.pageURL&&feedback.pageURL&&snapshot.pageURL!==feedback.pageURL)return null;
  if(submitted.some((answers,i)=>!Array.isArray(answers)||answers.length>500||answers.some(value=>typeof value!=='string'||value.length>20000)||!resolveAnswer(snapshot.questions[i],{answer:answers})))return null;
  const grading=Object.fromEntries(gradingKeys.map(key=>[key,count(feedback[key])?feedback[key]:null]));
  return {signature:snapshot.signature,answers:submitted.map(answers=>[...answers]),grading};
}

function layoutFor(questions,grading){
  const {total,objective,subjective,correct,incorrect,partial,unanswered}=grading;
  if(!(total>0&&objective===total&&(subjective===0||subjective===null)&&count(correct)&&count(incorrect)&&correct+incorrect===total)||partial>0||unanswered>0)return null;
  const parts=questions.reduce((sum,question)=>sum+questionPartCount(question),0);
  if(parts>500)return null;
  if(total===parts)return questions.flatMap((question,q)=>['text','matching'].includes(question.type)?Array.from({length:questionPartCount(question)},(_,part)=>({q,part})): [{q,part:null}]);
  if(total===questions.length)return questions.map((_,q)=>({q,part:null}));
  return null;
}

export function analyzeCorrectionHistory(snapshot,attempts=[]){
  const history=attempts.filter(attempt=>attempt?.signature===snapshot.signature&&attempt.answers?.length===snapshot.questions.length).slice(-3);
  const rules=snapshot.questions.map(()=>({knownCorrectAnswers:[],knownIncorrectAnswers:[],knownIncorrectResponses:[]}));
  const variables=new Map(),constraints=[];let layout,mode;
  for(const attempt of history){
    const current=layoutFor(snapshot.questions,attempt.grading);if(!current)continue;
    const identity=JSON.stringify(current);
    if(mode&&identity!==mode)continue;
    layout=current;mode=identity;
    const ids=layout.map(({q,part},unit)=>{
      const answers=part===null?attempt.answers[q]:[attempt.answers[q][part]],id=JSON.stringify([unit,responseKey(answers)]);
      if(!variables.has(id))variables.set(id,{q,part,answers});return id;
    });
    constraints.push({terms:new Map(ids.map(id=>[id,1])),total:attempt.grading.correct});
  }
  // Subtract two grading equations. If a score falls by exactly the number of
  // changed parts, every former value in those parts was correct. This also
  // works when a zero-correct submission identifies the remaining wrong parts.
  const originals=[...constraints];
  for(let i=0;i<originals.length;i++)for(let j=i+1;j<originals.length;j++){
    const terms=new Map(originals[i].terms);
    for(const [id,coefficient] of originals[j].terms){const value=(terms.get(id)||0)-coefficient;if(value)terms.set(id,value);else terms.delete(id);}
    constraints.push({terms,total:originals[i].total-originals[j].total});
  }
  const facts=new Map();let contradictory=false,changed=true;
  while(changed&&!contradictory){
    changed=false;
    for(const {terms,total} of constraints){
      let remaining=total,min=0,max=0;const unknown=[];
      for(const [id,coefficient] of terms){
        if(facts.has(id)){remaining-=coefficient*Number(facts.get(id));continue;}
        unknown.push([id,coefficient]);min+=Math.min(0,coefficient);max+=Math.max(0,coefficient);
      }
      if(remaining<min||remaining>max){contradictory=true;break;}
      if(remaining===min||remaining===max)for(const [id,coefficient] of unknown){facts.set(id,remaining===max?coefficient>0:coefficient<0);changed=true;}
    }
  }
  if(!contradictory)for(const [id,value] of facts){
    const {q,part,answers}=variables.get(id),rule=rules[q];
    if(part===null){if(value)rule.knownCorrectResponse||=[...answers];else rule.knownIncorrectResponses.push([...answers]);}
    else if(value){if(!rule.knownCorrectAnswers.some(item=>item.index===part+1))rule.knownCorrectAnswers.push({index:part+1,answer:answers[0]});}
    else{
      let item=rule.knownIncorrectAnswers.find(item=>item.index===part+1);if(!item){item={index:part+1,answers:[]};rule.knownIncorrectAnswers.push(item);}item.answers.push(answers[0]);
    }
  }
  return {history,rules,contradictory,verifiedParts:contradictory?0:rules.reduce((sum,rule)=>sum+rule.knownCorrectAnswers.length+(rule.knownCorrectResponse?1:0),0)};
}

export function correctionPromptFor(analysis,index){
  const history=analysis.history.map((attempt,i)=>({attempt:i+1,answers:attempt.answers[index],grading:attempt.grading,gradingScope:'whole-exercise'}));
  return {...(history.length?{history}:{}),...analysis.rules[index]};
}

export function protectCorrectionAnswer(question,answer,rule){
  if(!rule||!rule.knownCorrectResponse&&!rule.knownCorrectAnswers.length&&!rule.knownIncorrectAnswers.length&&!rule.knownIncorrectResponses.length)return {answer,protectedParts:0};
  let values=[...answer.answers],protectedParts=0;
  if(rule.knownCorrectResponse){if(responseKey(values)!==responseKey(rule.knownCorrectResponse))protectedParts++;values=[...rule.knownCorrectResponse];}
  else for(const item of rule.knownCorrectAnswers){if(exact(values[item.index-1])!==exact(item.answer))protectedParts++;values[item.index-1]=item.answer;}
  const resolved=resolveAnswer(question,{answer:values});
  if(!resolved)return {issue:'纠错答案与已确认正确的配对或选项冲突。'};
  const rejected=rule.knownIncorrectAnswers.filter(item=>item.answers.some(value=>exact(value)===exact(resolved.answers[item.index-1]))).map(item=>item.index);
  if(rejected.length)return {issue:`第 ${rejected.join('、')} 个作答项仍使用已被平台评分排除的答案。`};
  if(rule.knownIncorrectResponses.some(previous=>responseKey(previous)===responseKey(resolved.answers)))return {issue:'本题答案与平台已判错的完整答案相同。'};
  return {answer:{...answer,...resolved},protectedParts};
}
