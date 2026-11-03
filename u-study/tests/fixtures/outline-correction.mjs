// Synthetic grading and passage. These values are not a textbook answer key.
export const outlineInitialAnswers=['couch potatoes','habits','risks','mouse potatoes'];
export const outlineCorrectedAnswers=['couch potatoes','origins','effects','mouse potatoes'];

export function outlineCorrectionHTML({kind='text',revision='same',outcome='correct',provisional=false}={}){
  const blank=index=>kind==='select'?`<select id="blank-${index}"><option value="">请选择</option>${[...new Set([outlineInitialAnswers[index],outlineCorrectedAnswers[index]])].map(value=>`<option>${value}</option>`).join('')}</select>`:`<span class="comp-abs-input"><input id="blank-${index}" type="text"><span class="input-value-measure"></span></span>`;
  const content=`<div class="layout-container"><div class="abs-direction">Directions: Complete the following diagram about leisure inactivities.</div><div class="layoutBody-container"><div class="layout-material-container"><h3>Leisure inactivities</h3><p>Synthetic reading passage for regression tests, not the textbook answer key.</p><p>People who spend much of their free time watching television are called couch potatoes. The diagram discusses the origins of this term and the effects of this lifestyle. Computer users who spend their leisure at the computer are called mouse potatoes.</p></div><div class="layout-reply-container"><div class="question-common-abs-scoop"><div class="item"><h3>Leisure inactivities</h3><ul><li>Inactivity lovers in the late 20th century: 1) ${blank(0)}<ul><li>The 2) ${blank(1)} of couch potatoes</li><li>The 3) ${blank(2)} of being a couch potato</li></ul></li><li>Inactivity lovers in the 21st century: 4) ${blank(3)}</li></ul></div></div></div></div></div>`;
  return `<!doctype html><html><body><style>.layoutBody-container{display:grid;grid-template-columns:1fr 1fr;gap:35px}.input-value-measure{position:absolute;left:-10000px;white-space:pre}input,select{width:150px}li{margin:20px 0}</style><header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Test Book</span><span class="pc-break-crumb-text">Time off</span><span class="pc-break-crumb-text">Getting the idea</span></nav><div class="pc-header-tab-activity">Getting the idea</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header><main id="exercise" class="pc-main-container"></main><footer id="footer" class="question-common-course-page"></footer><script>
  const exercise=document.getElementById('exercise'),footer=document.getElementById('footer'),expected=${JSON.stringify(outlineCorrectedAnswers)};
  window.submissions=[];window.revisions=0;window.continues=0;window.completed=false;
  function show(values=[]){
    exercise.innerHTML=${JSON.stringify(content)};
    document.querySelectorAll('input,select').forEach((input,index)=>{input.value=values[index]||'';const mirror=()=>{if(input.tagName==='INPUT'){input.nextElementSibling.textContent=input.value;input.style.width=Math.max(100,input.value.length*8)+'px';}};input.addEventListener('input',mirror);input.addEventListener('blur',mirror);mirror();});
    footer.innerHTML='<button>提交</button>';footer.firstElementChild.onclick=submit;
  }
  function submit(){
    const values=[...document.querySelectorAll('input,select')].map(input=>input.value);window.submissions.push(values);
    const count=values.reduce((n,value,index)=>n+(value===expected[index]?1:0),0),passed=${JSON.stringify(outcome)}==='correct'&&count===4;
    exercise.innerHTML='<h2>答题小结</h2><p>完成本板块内全部必修练习且客观题正确率≥60</p>'+(passed?'':'<p>你没有达到闯关条件，请修改后再提交。</p>')+'<p>共<b>4</b>道题，客观题<strong>4</strong>道，主观题0道</p><p>正确 ('+count+'/4) 部分正确 (0/4) 错误 ('+(4-count)+'/4) 未作答0</p>'+(passed?'<p>全部正确</p>':'');
    if(${JSON.stringify(provisional)}&&window.submissions.length===1){const final=exercise.innerHTML;exercise.innerHTML=final.replace('正确 ('+count+'/4)','正确 (0/4)').replace('错误 ('+(4-count)+'/4)','错误 (4/4)');setTimeout(()=>{exercise.innerHTML=final;},400);}
    footer.innerHTML=passed?'<button>继续学习</button>':'<button>返回修改</button>';
    footer.firstElementChild.onclick=()=>{
      if(passed){window.continues++;window.completed=true;exercise.innerHTML='<textarea id="unrequested"></textarea>';footer.innerHTML='';document.querySelector('.pc-header-task-activity').textContent='Unrequested exercise';return;}
      window.revisions++;show(values);
      if(${JSON.stringify(revision)}==='partial')document.querySelector('.layout-reply-container').innerHTML='<fieldset><legend>Explain your opinion.</legend><textarea></textarea></fieldset>';
      if(${JSON.stringify(revision)}==='other')document.querySelector('.pc-header-task-activity').textContent='Exercise 2';
    };
  }
  show();
  </script></body></html>`;
}
