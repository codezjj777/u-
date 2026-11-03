import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectCoursesFromDOM,collectQuestionsFromDOM,readLearningStateFromDOM,readExerciseFeedbackFromDOM,findActionInDOM,confirmCompletionInDOM} from '../platform-dom.mjs';
function dom(html){const {window,document}=parseHTML(`<html><body>${html}</body></html>`);globalThis.document=document;globalThis.location={href:'https://ucloud.unipus.cn/app/cmgt/course-management',pathname:'/app/cmgt/course-management'};globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}]};return document;}
test('course cards return real title, URL and progress and deduplicate nested tiles',()=>{dom('<div class="course-card"><div class="course-item"><a href="/learn/course?id=1"><h3>大学英语</h3></a><span class="teacher">张老师</span><p>进度 62%</p></div></div><div class="course-card"><a href="https://ucloud.unipus.cn/course/2"><h3>听力课程</h3></a></div>');const r=collectCoursesFromDOM();assert.equal(r.courses.length,2);assert.equal(r.courses[0].title,'大学英语');assert.equal(r.courses[0].progress,62);assert.equal(r.courses[0].subtitle,'张老师');assert.equal(r.courses[1].progress,null);});
test('click-only course cards retain a usable page-and-title entry',()=>{dom('<div class="courseCard" data-course-id="24"><h3>课程 A</h3></div>');const c=collectCoursesFromDOM({pageIndex:2}).courses[0];assert.equal(c.id,'course-24');assert.deepEqual(c.entry,{title:'课程 A',pageIndex:2});});

test('course entries target the visible card title even when text is truncated or repeated elsewhere',()=>{dom('<h2>大学英语（第三版）</h2><div class="course-card"><h3 title="大学英语（第三版）">大学英语…</h3></div><div hidden><div class="course-card"><h3 title="大学英语（第三版）">大学英语…</h3></div></div>');const result=collectCoursesFromDOM();assert.equal(result.courses.length,1);assert.equal(result.entries.length,1);assert.equal(result.entries[0].title,'大学英语（第三版）');const target=document.querySelector(result.entries[0].selector);assert.equal(target.textContent,'大学英语…');assert.equal(target.closest('.course-card').hasAttribute('hidden'),false);assert.equal(document.querySelector('h2').hasAttribute('data-ustudy-course-entry'),false);});

test('visible duplicate course names retain separate entries so the opener can reject ambiguity',()=>{dom('<div class="course-card"><h3>同名课程</h3></div><div class="course-card"><h3>同名课程</h3></div>');const result=collectCoursesFromDOM();assert.equal(result.courses.length,1);assert.equal(result.entries.length,2);assert.notEqual(result.entries[0].selector,result.entries[1].selector);});

test('repeated textbooks in different teaching groups remain distinct with their own progress',()=>{
  const group=(name,period,progress)=>`<section><header><span>课程名称：${name}</span><span>班级名称：测试 B1 班</span><span>记分周期：${period}</span></header><div>在学教程：1</div><div class="course-card"><h3>综合教程2</h3><p>学习进度：${progress}%</p></div></section>`;
  dom(group('大学英语（三）B班','2026/08/03-2027/02/03',5.3)+group('大学英语（二）B班','2026/02/27-2026/08/27',72.4));
  const result=collectCoursesFromDOM();assert.equal(result.courses.length,2);assert.equal(new Set(result.courses.map(c=>c.id)).size,2);
  assert.equal(result.courses[0].group.name,'大学英语（三）B班');assert.equal(result.courses[1].group.period,'2026/02/27-2026/08/27');
  assert.equal(result.courses[0].progress,5.3);assert.equal(result.courses[1].progress,72.4);
  assert.match(document.querySelector(result.entries[1].selector).closest('section').textContent,/大学英语（二）B班/);
});

test('scoped textbook identity remains stable when semesters are reordered',()=>{
  const group=period=>`<section><p>课程名称：大学英语 班级名称：B1 班 记分周期：${period}</p><p>在学教程：1</p><div class="course-card"><h3>综合教程2</h3></div></section>`;
  const periods=['2026/08/03-2027/02/03','2026/02/27-2026/08/27'];dom(periods.map(group).join(''));const first=collectCoursesFromDOM().courses;
  dom(periods.slice().reverse().map(group).join(''));const reordered=collectCoursesFromDOM().courses;
  assert.notEqual(first[0].id,first[1].id);assert.equal(first[0].id,reordered[1].id);assert.equal(first[1].id,reordered[0].id);
});

test('grouped textbooks retain a scoped click entry even if their content href is shared',()=>{
  dom('<section><p>课程名称：大学英语 班级名称：B1 班 记分周期：2026/08/03-2027/02/03</p><p>在学教程：1</p><div class="course-card"><a href="/learn/book/2"><h3>综合教程2</h3></a></div></section>');
  const course=collectCoursesFromDOM().courses[0];assert.equal(course.url,location.href);assert.equal(course.entry.pageIndex,0);assert.equal(course.group.className,'B1 班');
});

test('a shared list wrapper is never assigned as the teaching group for unrelated cards',()=>{
  dom('<main><section><p>课程名称：大学英语 班级名称：B1 班 记分周期：2026/08/03-2027/02/03</p><p>在学教程：1</p><div class="course-card"><h3>综合教程2</h3></div></section><section><p>课程名称：大学英语 班级名称：B2 班 记分周期：2026/08/03-2027/02/03</p><p>在学教程：1</p><div class="course-card"><h3>综合教程2</h3></div></section><div class="course-card"><h3>单独教材</h3></div></main>');
  const result=collectCoursesFromDOM();assert.equal(result.courses.length,3);assert.equal(result.courses[2].group,undefined);assert.notEqual(result.courses[0].id,result.courses[1].id);
});

test('activation controls are reported without treating active textbooks as inactive',()=>{dom('<div class="course-card"><h3>教程 A</h3><button>激活教程</button></div><div class="course-card"><h3>教程 B</h3><button hidden>激活教程</button><p>学习进度：6%</p></div>');const result=collectCoursesFromDOM();assert.equal(result.courses[0].requiresActivation,true);assert.equal(result.courses[1].requiresActivation,false);});

test('collecting course entries refreshes stale markers instead of targeting another card',()=>{dom('<p data-ustudy-course-entry="0">旧课程</p><div class="course-card"><h3>新课程</h3></div>');collectCoursesFromDOM();const again=collectCoursesFromDOM();assert.equal(document.querySelector('p').hasAttribute('data-ustudy-course-entry'),false);assert.equal(document.querySelectorAll(again.entries[0].selector).length,1);assert.equal(document.querySelector(again.entries[0].selector).textContent,'新课程');});

test('unrelated item totals are not mistaken for the course count',()=>{dom('<div>共 3 条通知</div><div>共 6 门课程</div>');assert.equal(collectCoursesFromDOM().countHint,6);dom('<div>共 3 条通知</div><div class="course-card"><h3>课程 A</h3></div>');assert.equal(collectCoursesFromDOM().countHint,0);});
test('pagination detects enabled next and count while ignoring disabled next',()=>{dom('<div>共 6 门</div><div class="pagination"><button>下一页</button></div>');assert.equal(collectCoursesFromDOM().countHint,6);assert.equal(collectCoursesFromDOM().hasNext,true);dom('<div class="pagination"><button disabled>下一页</button></div>');assert.equal(collectCoursesFromDOM().hasNext,false);});
test('login detection does not expose password fields',()=>{dom('<form><input type="password" value="not-a-real-secret"></form>');const r=collectCoursesFromDOM();assert.equal(r.login,true);assert.equal(JSON.stringify(r).includes('not-a-real-secret'),false);assert.deepEqual(collectQuestionsFromDOM(),[]);});

test('a hidden login form does not mark a visible course list as logged out',()=>{dom('<form hidden><input type="password"></form><div class="course-card"><h3>课程 A</h3></div>');const r=collectCoursesFromDOM();assert.equal(r.login,false);assert.equal(r.courses.length,1);});
test('native choice questions retain exact labels and selectable targets',()=>{dom('<fieldset><legend>Which word is correct?</legend><label><input type="radio" name="q1">A. right</label><label><input type="radio" name="q1">B. wrong</label></fieldset>');const q=collectQuestionsFromDOM()[0];assert.equal(q.question,'Which word is correct?');assert.deepEqual(q.options,['A. right','B. wrong']);assert.equal(q.type,'single');assert.equal(q.targets.length,2);assert.equal(document.querySelector(q.targets[1].selector).type,'radio');});
test('multi choice and multi blank questions are distinguished',()=>{dom('<fieldset><legend>Choose both answers.</legend><label><input type="checkbox">one</label><label><input type="checkbox">two</label></fieldset><div class="question-item"><h3>Fill in both blank spaces.</h3><input type="text"><textarea></textarea></div>');const qs=collectQuestionsFromDOM();assert.equal(qs[0].type,'multiple');assert.equal(qs[1].type,'text');assert.equal(qs[1].targets.length,2);});
test('custom controls and passage context are identified',()=>{dom('<div class="passage">The passage contains relevant details.</div><div class="question"><h3>Choose the correct answer.</h3><div role="radio" aria-checked="false">Yes</div><div role="radio" aria-checked="false">No</div></div>');const q=collectQuestionsFromDOM()[0];assert.equal(q.targets[0].kind,'custom');assert.match(q.context,/relevant details/);});
test('invalid custom selector fails and unrelated settings controls are not questions',()=>{dom('<div>Answer settings <input type="text"></div>');assert.deepEqual(collectQuestionsFromDOM(),[]);assert.throws(()=>collectQuestionsFromDOM({questionSelector:'[['}));});
test('next and submit identify exact actions, never delete or unrelated controls',()=>{dom('<button>删除</button><button>提交答案</button><button>下一题</button><button>查看提交记录</button>');assert.equal(findActionInDOM({kind:'submit'}),'[data-ustudy-action="submit"]');assert.equal(document.querySelector('[data-ustudy-action=submit]').textContent,'提交答案');assert.ok(findActionInDOM({kind:'next'}));});
test('default lesson actions exclude dialog buttons while explicit selectors retain their configured target',()=>{
  dom('<div class="ant-modal" role="dialog"><button id="dialog-submit">提交</button><button>下一题</button></div><footer><button id="lesson-submit">提交</button><button id="lesson-next">下一题</button></footer>');
  assert.equal(document.querySelector(findActionInDOM({kind:'submit'})).id,'lesson-submit');assert.equal(document.querySelector(findActionInDOM({kind:'next'})).id,'lesson-next');
  assert.equal(document.querySelector(findActionInDOM({kind:'submit',selector:'#dialog-submit'})).id,'dialog-submit');
});
test('actions inside invisible or inactive ancestors never compete with the visible footer',()=>{
  dom('<div style="opacity:0"><button>提交</button></div><div aria-hidden="true"><button>提交</button></div><div inert><button>提交</button></div><footer><button id="visible-submit">提交</button></footer>');
  globalThis.getComputedStyle=el=>({display:el.style.display,visibility:el.style.visibility||'visible',opacity:el.style.opacity||'1'});
  assert.equal(document.querySelector(findActionInDOM({kind:'submit'})).id,'visible-submit');
});
test('a click alone does not prove completion; explicit success is required',()=>{dom('<button>提交答案</button><p>提交失败，请检查答案</p>');assert.equal(confirmCompletionInDOM(),false);dom('<div role="alert">提交成功！</div>');assert.equal(confirmCompletionInDOM(),true);});

test('a failed U校园 summary reports the objective errors even after all text answers were filled',()=>{
  dom('<main><h2>答题小结</h2><p>完成本板块内全部必修练习且客观题正确率≥60</p><div>你没有达到闯关条件，请修改后再提交。</div><p>共8道题，客观题2道，主观题6道</p><span>正确 (0/2)</span><span>部分正确 (0/2)</span><span>错误 (2/2)</span><span>已作答8</span><span>未作答0</span><a>返回修改</a></main>');
  assert.deepEqual(readExerciseFeedbackFromDOM(),{summary:true,failed:true,message:'你没有达到闯关条件，请修改后再提交。',total:8,objective:2,subjective:6,correct:0,incorrect:2,partial:0,unanswered:0,requirement:'客观题正确率≥60',grading:{correctRatios:[{correct:0,total:2}],allCorrect:false,pending:false,score:null,maxScore:null}});
  assert.ok(findActionInDOM({kind:'revise'}));assert.equal(confirmCompletionInDOM(),false);
});

test('feedback ignores hidden summaries and study passages containing failure wording',()=>{
  dom('<div hidden><h2>答题小结</h2><p>你没有达到闯关条件，请修改后再提交。</p></div><div class="question-common-abs-material"><h2>答题小结</h2><p>你没有达到闯关条件，请修改后再提交。</p></div><div class="question-inputbox"><h2>Explain this question.</h2><textarea></textarea></div>');
  assert.deepEqual(readExerciseFeedbackFromDOM(),{summary:false,failed:false});
  dom('<main><h2>答题小结</h2><p hidden>你没有达到闯关条件，请修改后再提交。</p><span>部分正确 (1/2)</span></main>');
  const result=readExerciseFeedbackFromDOM();assert.equal(result.summary,true);assert.equal(result.failed,false);assert.equal(result.correct,null);assert.equal(result.partial,1);assert.equal(result.objective,null);
});

test('summary counts are scoped to the visible exercise and revise uses its exact label',()=>{
  dom('<aside>正确 (9/9)</aside><main><h2>答题小结</h2><p>你没有达到闯关条件，请修改后再提交。</p><span>错误（2/2）</span><a hidden>返回修改</a><a>查看修改记录</a><button>重新开始全部练习</button><a>返 回 修 改</a></main>');
  const result=readExerciseFeedbackFromDOM();assert.equal(result.correct,null);assert.equal(result.incorrect,2);
  const action=findActionInDOM({kind:'revise'});assert.ok(action);assert.equal(document.querySelector(action).textContent,'返 回 修 改');
});

test('all-correct grading retains denominators and full scores while authored answer text never becomes feedback',()=>{
  dom('<main><h2>答题小结</h2><p>共 2 道题，客观题 1 道，主观题 1 道</p><span>正确 (2/2)</span><span>总得分</span><span>100 / 100</span></main>');
  let feedback=readExerciseFeedbackFromDOM();assert.deepEqual(feedback.grading.correctRatios,[{correct:2,total:2}]);assert.equal(feedback.grading.score,100);assert.equal(feedback.grading.maxScore,100);assert.equal(feedback.grading.pending,false);
  dom('<main><h2>答题小结</h2><p>共 2 道题，客观题 1 道，主观题 1 道</p><span>正确 (1/1)</span><p>主观题待批改</p></main>');
  assert.equal(readExerciseFeedbackFromDOM().grading.pending,true);
  dom('<div class="question-item"><h2>答题小结</h2><div contenteditable="true"><p>正确 (2/2)</p><p>共2道题</p></div></div>');assert.deepEqual(readExerciseFeedbackFromDOM(),{summary:false,failed:false});
  dom('<aside><h2>答题小结</h2><p>共9道题</p><p>正确(9/9)</p></aside><main><h2>答题小结</h2><p>共2道题</p><p>正确(2/2)</p></main>');assert.equal(readExerciseFeedbackFromDOM().total,2);
});

test('resume shortcuts cannot be clicked, including explicit selector overrides',()=>{
  dom('<button id="resume">继续学习</button><button>开始学习</button>');
  for(const kind of ['exercise','submit','next'])assert.equal(findActionInDOM({kind,selector:'#resume'}),null);
});
test('action markers move to the current visible submit control',()=>{
  dom('<button>提交</button><button hidden>提交答案</button>');const selector=findActionInDOM({kind:'submit'});
  const buttons=document.querySelectorAll('button');buttons[0].setAttribute('hidden','');buttons[1].removeAttribute('hidden');
  assert.equal(findActionInDOM({kind:'submit'}),selector);assert.equal(document.querySelectorAll(selector).length,1);assert.equal(document.querySelector(selector).textContent,'提交答案');
});

test('learning state distinguishes a blocked network load, a ready directory and expired login',()=>{
  dom('<div class="ant-spin ant-spin-spinning">加载中</div><div class="courses-unit_unitTabBody__hash">教程目录</div><div>当前网络不给力，学习时长可能会记录不全，请检查网络</div>');
  assert.deepEqual(readLearningStateFromDOM(),{loading:true,directory:true,networkIssue:true,login:false,studyNotice:false,contentReady:false});
  dom('<div class="ant-spin-spinning" hidden>加载中</div><div hidden>网络异常</div><div class="courses-unit_unitTabBody__hash">教程目录</div>');
  assert.deepEqual(readLearningStateFromDOM(),{loading:false,directory:true,networkIssue:false,login:false,studyNotice:false,contentReady:false});
  dom('<input type="password">');assert.equal(readLearningStateFromDOM().login,true);
});

test('U校园 custom choices expose option text, writable targets and their reading material',()=>{
  dom('<div class="question-common-abs-question-container"><div class="abs-direction">Choose one answer.</div><div class="question-common-abs-material">A short practice passage.</div><aside><input type="text" placeholder="搜索笔记"></aside><div class="question-common-abs-choice"><div class="component-htmlview ques-title"><p>1. Which activity is described?</p></div><div class="option-wrap"><div class="option selected isNotReview"><div class="caption">A</div><div class="content"><p>Reading</p></div></div><div class="option isNotReview"><div class="caption">B</div><div class="content"><p>Running</p></div></div></div></div></div>');
  const qs=collectQuestionsFromDOM();assert.equal(qs.length,1);assert.equal(qs[0].question,'1. Which activity is described?');assert.deepEqual(qs[0].options,['Reading','Running']);assert.equal(qs[0].type,'single');assert.equal(qs[0].targets[0].kind,'unipus-choice');assert.equal(document.querySelector(qs[0].targets[1].selector).classList.contains('option'),true);assert.match(qs[0].context,/Choose one answer.*short practice passage/);
});

test('U校园 reading pages and read-only or explicitly multiple-choice templates are not single-choice questions',()=>{
  dom('<div class="question-common-abs-question-container"><div class="question-common-abs-material">A reading-only page.</div><input type="text" placeholder="搜索笔记"></div>');assert.deepEqual(collectQuestionsFromDOM(),[]);
  const choice=editable=>`<div class="question-common-abs-choice"><div class="ques-title">Select the matching answer.</div><div class="option-wrap"><div class="option ${editable?'isNotReview':''}"><div class="content">One</div></div><div class="option ${editable?'isNotReview':''}"><div class="content">Two</div></div></div></div>`;
  dom(choice(false));assert.deepEqual(collectQuestionsFromDOM(),[]);
  dom('<div class="abs-direction">Select all that apply.</div>'+choice(true));assert.equal(collectQuestionsFromDOM()[0].type,'multiple');
});

test('U校园 text-answer questions remain separate from each other and from note search',()=>{
  const question=text=>`<div class="question-common-abs-reply"><div class="question-inputbox"><div class="question-inputbox-header"><div class="component-htmlview"><p>${text}</p></div></div><div class="question-inputbox-body"><textarea placeholder="请输入答案..."></textarea></div></div></div>`;
  dom('<div class="question-common-abs-question-container"><div class="question-common-abs-material">Relevant reading text.</div>'+question('1. Explain the first idea.')+question('2. Explain the second idea.')+'<input type="text" placeholder="搜索笔记"></div>');
  const qs=collectQuestionsFromDOM();assert.equal(qs.length,2);assert.deepEqual(qs.map(q=>q.type),['text','text']);assert.equal(qs[0].question,'1. Explain the first idea.');assert.equal(qs[1].targets.length,1);assert.match(qs[1].context,/Relevant reading/);
});

test('spaced Chinese submit labels match the real footer without matching unrelated records',()=>{
  dom('<a>查看提交记录</a><div class="question-common-course-page"><a class="btn">提 交</a></div>');const selector=findActionInDOM({kind:'submit'});assert.ok(selector);assert.equal(document.querySelector(selector).textContent,'提 交');
});

test('only the nonbinding unit study-time notice is acknowledged automatically',()=>{
  dom('<div role="dialog"><p>本单元学习时间：2026-09-01至2026-12-18</p><p>是否必修：必修</p><button>我知道了</button></div>');assert.equal(readLearningStateFromDOM().studyNotice,true);assert.ok(findActionInDOM({kind:'notice'}));
  dom('<div role="dialog"><p>请接受协议并授予访问权限</p><button>我知道了</button></div>');assert.equal(readLearningStateFromDOM().studyNotice,false);assert.equal(findActionInDOM({kind:'notice'}),null);
});

test('study-time notices without a dialog role are recognized, while hidden and unrelated modals are ignored',()=>{
  for(const shape of ['class="ant-modal"','role="alertdialog"','class="el-message-box"']){
    dom('<div '+shape+'><p>本单元学习时间：2026-09-01至2026-12-18</p><p>是否必修：必修</p><button>我知道了</button></div>');assert.equal(readLearningStateFromDOM().studyNotice,true);assert.ok(findActionInDOM({kind:'notice'}));
  }
  dom('<div class="ant-modal" hidden><p>本单元学习时间；是否必修</p><button>我知道了</button></div><div class="ant-modal"><p>登录已失效</p><button>我知道了</button></div>');assert.equal(readLearningStateFromDOM().studyNotice,false);assert.equal(findActionInDOM({kind:'notice'}),null);
});

test('study notice acknowledgement uses authored text when rendered button text is temporarily empty',()=>{
  dom('<div class="ant-modal"><p>本单元学习时间；是否必修</p><button>我知道了</button></div>');
  Object.defineProperty(document.querySelector('button'),'innerText',{value:''});
  assert.equal(readLearningStateFromDOM().studyNotice,true);
  assert.ok(findActionInDOM({kind:'notice'}));
});

test('zero-size retained study dialogs do not count as visible notices or actions',()=>{
  dom('<div class="ant-modal"><p>本单元学习时间；是否必修</p><button>我知道了</button></div>');
  document.querySelector('.ant-modal').getClientRects=()=>[{width:0,height:0}];
  assert.equal(readLearningStateFromDOM().studyNotice,false);
  assert.equal(findActionInDOM({kind:'notice'}),null);
});

test('a real Forbidden login-failed response is detected without treating ordinary study text as login',()=>{
  dom('<h1>Forbidden</h1><p>Login failed.</p>');assert.equal(readLearningStateFromDOM().login,true);
  dom('<p>Discuss why the login failed in this story.</p>');assert.equal(readLearningStateFromDOM().login,false);
});

test('U校园 scoop writing tasks expose the assignment and one editable essay field',()=>{
  dom('<div class="abs-direction">Do the following writing task.</div><div class="question-common-abs-question-container"><input type="text" placeholder="搜索笔记"><div class="question-common-abs-reply"><div class="question-common-abs-scoop comp-scoop-reply"><div class="item"><div class="component-htmlview"><p>Write a reflective journal about the moral lesson in After twenty years.</p><span class="fe-scoop"><span class="question-number">1</span><div class="question-textarea"><div data-count="0/1000" class="question-textarea-container"><div class="text-area-hide">Hidden measurement text</div><textarea placeholder="请输入答案..."></textarea></div></div></span></div></div></div></div></div>');
  const questions=collectQuestionsFromDOM();assert.equal(questions.length,1);assert.equal(questions[0].type,'text');assert.equal(questions[0].question,'Write a reflective journal about the moral lesson in After twenty years.');assert.equal(questions[0].targets.length,1);assert.equal(document.querySelector(questions[0].targets[0].selector).tagName,'TEXTAREA');assert.match(questions[0].context,/writing task/);
  document.querySelector('textarea').readOnly=true;assert.deepEqual(collectQuestionsFromDOM(),[]);
});
