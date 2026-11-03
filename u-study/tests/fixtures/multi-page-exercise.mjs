// A minimal reproduction of a multiple-choice page followed by a Directions-only textarea.
export function multiPageExerciseHTML({boundary=false,delay=0,cycle=false,earlySubmit=false}={}){
  return `<!doctype html><html><body>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">English Book</span><span class="pc-break-crumb-text">Horns of a dilemma</span><span class="pc-break-crumb-text">Before you read</span></nav><div class="pc-header-tab-activity">Before you read</div><div class="pc-task pc-header-task-activity">Before you read 1</div></header>
  <div class="layout-progress-container"><div class="comp-question-progress" style="width:50%"></div></div><main class="pc-main-container" id="exercise"></main><footer id="footer" class="question-common-course-page"></footer>
  <script>
    window.savedChoices=[];window.submitted=false;window.nextClicks=0;
    const exercise=document.getElementById('exercise'),footer=document.getElementById('footer');
    function first(){
      exercise.innerHTML='<div class="layout-container"><div class="abs-direction">Choose all the works by O. Henry.</div><div class="question-common-abs-choice"><div class="ques-title">Which short stories are O. Henry\\'s?</div><div class="option-wrap"><div class="option isNotReview"><div class="content">The Gift of the Magi</div></div><div class="option isNotReview"><div class="content">The Last Leaf</div></div><div class="option isNotReview"><div class="content">Hamlet</div></div></div></div></div>';
      exercise.querySelectorAll('.option').forEach(el=>el.onclick=()=>el.classList.toggle('selected'));
      footer.innerHTML='<a class="btn">下一题</a>';
      ${earlySubmit?"footer.insertAdjacentHTML('beforeend','<a class=\"btn\" onclick=\"window.prematureSubmit=true\">提交</a>');":''}
      footer.firstElementChild.onclick=()=>{window.nextClicks++;window.savedChoices=[...exercise.querySelectorAll('.option.selected .content')].map(el=>el.textContent);exercise.innerHTML='<div class="abs-direction">Write down other works by O. Henry if you know any.</div>';footer.innerHTML='';setTimeout(second,${JSON.stringify(delay)});};
    }
    function second(){
      ${boundary?"document.querySelector('.pc-header-task-activity').textContent='Before you read 2';":''}
      document.querySelector('.comp-question-progress').style.width='100%';
      exercise.innerHTML='<div class="layout-container"><div class="layout-direction-container"><div class="abs-direction">Directions: Write down other works by O. Henry if you know any.</div></div><div class="layoutBody-container has-reply"><div class="layout-reply-container"><div class="question-common-abs-reply"><textarea id="second-answer" placeholder="请输入答案..."></textarea><span>0/1000</span></div></div></div></div>';
      footer.innerHTML=${JSON.stringify(cycle?'<a class="btn">下一题</a>':'<a class="btn">上一题</a><a class="btn">提 交</a>')};
      ${cycle?"footer.firstElementChild.onclick=()=>{window.nextClicks++;first();};":"footer.lastElementChild.onclick=()=>{window.submitted=true;window.savedText=document.getElementById('second-answer').value;exercise.innerHTML='<h2>答题小结</h2><p>共 2 道题 主观题 1 道 客观题 1 道</p>';footer.innerHTML='';};"}
    }
    first();
  </script></body></html>`;
}
