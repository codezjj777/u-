// Synthetic editor validation and grading; this is not a textbook answer key.
export const technologyAnswers=[
  'It provides ease and efficiency of modern communication and supports real-time video calls, mobile payments, online shopping, and car-hailing.',
  'HSR technology provides super-fast, comfortable long-distance travel; shortens the Shanghai–Beijing trip; and symbolizes China’s economic strength and growing technological capabilities.',
  'AI technology provides “smart” services… It improves efficiency\u00a0and accessibility.'
];
export const technologyPlainAnswers=[
  technologyAnswers[0],
  "HSR technology provides super-fast, comfortable long-distance travel; shortens the Shanghai-Beijing trip; and symbolizes China's economic strength and growing technological capabilities.",
  'AI technology provides "smart" services... It improves efficiency and accessibility.'
];
export function specialInputHTML({notice=false,rejectSymbols=false,replaceOnBlur=false}={}){
  return `<!doctype html><html><body><style>.layoutBody-container{display:grid;grid-template-columns:1fr 1fr;gap:30px}textarea{width:95%;height:120px}.modal-cover{position:fixed;inset:0;background:#0007;z-index:50;display:flex;align-items:center;justify-content:center}.ant-modal{padding:40px;background:white}button{padding:10px}</style>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Test Book</span><span class="pc-break-crumb-text">Science empowers</span><span class="pc-break-crumb-text">Getting the idea</span></nav><div class="pc-header-tab-activity">Exercises</div><div class="pc-task pc-header-task-activity">Exercise 2</div></header>
  <main class="pc-main-container" id="exercise"><div class="layout-container"><div class="abs-direction">List the benefits of the following technologies.</div><div class="layoutBody-container"><div class="layout-material-container">Synthetic reading about communications, rail travel and smart services. It contains the whole material for all three answers.</div><div class="layout-reply-container question-common-abs-reply">${['5G','HSR','AI'].map((label,i)=>`<div class="question-inputbox"><h3 class="question-inputbox-header">${i+1}. ${label} technology</h3><textarea id="answer-${i}" placeholder="请输入答案..."></textarea></div>`).join('')}</div></div></div></main><footer class="question-common-course-page"><button id="submit">提交</button></footer>
  <script>
  window.acks=0;window.rejections=0;window.submissions=[];window.completed=false;window.committed={};
  window.inputNotice=()=>{if(document.querySelector('.modal-cover'))return;window.rejections++;const cover=document.createElement('div');cover.className='modal-cover';cover.innerHTML='<div class="ant-modal" role="dialog"><p>不支持输入特殊字符哦</p><button>我知道了</button></div>';cover.querySelector('button').onclick=()=>{window.acks++;cover.remove();};document.body.appendChild(cover);};
  const rejected=${JSON.stringify(rejectSymbols)}?/[–—α]/g:/[–—]/g;
  function bind(input){input.addEventListener('input',()=>{const value=input.value.replace(rejected,'');if(value!==input.value){input.value=value;window.inputNotice();}});input.addEventListener('blur',()=>{window.committed[input.id]=input.value;if(${JSON.stringify(replaceOnBlur)}&&!input.dataset.replaced){const clone=input.cloneNode();clone.value=input.value;clone.dataset.replaced='true';bind(clone);input.replaceWith(clone);}});}
  document.querySelectorAll('textarea').forEach(bind);
  document.getElementById('submit').onclick=()=>{const values=[...document.querySelectorAll('textarea')].map(input=>input.value);window.submissions.push(values);const correct=JSON.stringify(values)===${JSON.stringify(JSON.stringify(technologyPlainAnswers))};if(!correct)return;window.completed=true;document.getElementById('exercise').innerHTML='<h2>答题小结</h2><p>共3道题，客观题0道，主观题3道</p><p>已作答(3/3) 未作答(0/3)</p><p>总得分：100 / 100</p>';document.querySelector('footer').innerHTML='';};
  if(${JSON.stringify(notice)})window.inputNotice();
  </script></body></html>`;
}
