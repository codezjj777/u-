export const matchingPrompts=[
  'If bad posture becomes habitual,',
  'She stopped at a hardware store',
  'I think the best way to enlarge your vocabulary',
  'On a chilly evening some years ago in Africa,',
  'The large central diamond',
  'To arrest a person, the police have to be reasonably sure that',
  'The only thing you can do is to be watchful and',
  'This mutual gaze is a major part of',
  "Nature's repair process is slow but steady,",
  'He began to tremble so uncontrollably with fright that'
];
export const matchingWords=['habitual','hardware','enlarge','chilly','diamond','arrest','watchful','gaze','steady','tremble'];
export const matchingOptions=[
  'I met a baby elephant wrapped in a red blanket.',
  'see a doctor for any changes in your physical condition.',
  'children risk long-term effects.',
  'the person committed a crime.',
  'he had no voice left with which to beg for his life.',
  'to buy a new water faucet (水龙头) for her apartment.',
  'with cells being constantly renewed.',
  'is reading English novels.',
  'is surrounded by eight smaller gems.',
  'the attachment between a mother and a child.'
];
export const matchingMap=[2,5,7,0,8,3,1,9,6,4];
export const matchingAnswers=matchingMap.map(index=>matchingOptions[index]);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

// Reproduce the screenshot's fixed left column and the publisher's sortable
// right column. All answer state changes originate from real drag events.
export function sentenceMatchingHTML({mode='pointer',reverse=false,tall=false,renumber=true,missing=false,duplicate=false,leftClass=true,grading='correct',pressRender='',repaintOnScroll=false}={}){
  const indices=matchingPrompts.map((_,index)=>index);if(reverse)indices.reverse();
  const order=reverse?[9,8,7,6,5,4,3,2,1,0]:[1,2,0,3,4,5,6,7,8,9];
  const left=indices.slice(0,missing?9:10).map((index,i)=>`<div class="${leftClass?'sequence-question-view-item-text':'left-sentence'}">${i+1}. ${escape(matchingPrompts[index]).replace(matchingWords[index],'<u>'+matchingWords[index]+'</u>')}</div>`).join('');
  const right=order.map((index,i)=>`<div class="sequence-reply-view-item-text" data-option-id="${index}" ${mode==='html5'?'draggable="true"':''}><span>${String.fromCharCode(65+(renumber?i:index))}.</span><span>${escape(matchingOptions[duplicate&&i===1?order[0]:index])}</span></div>`).join('');
  return `<!doctype html><html><body><style>
    body{font:14px Arial;margin:18px}.sequence-view{display:grid;grid-template-columns:40% 60%;gap:12px}.sequence-question-view-item-text,.left-sentence,.sequence-reply-view-item-text{height:${tall?84:42}px;box-sizing:border-box;margin-bottom:7px;padding:8px}.sequence-reply-view-item-text{border:1px solid #9cf;cursor:move;user-select:none;display:flex;align-items:center;gap:8px;background:#fafafa}#submit{margin-top:12px}
    </style><header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Complete English Book</span><span class="pc-break-crumb-text">Unit 1</span><span class="pc-break-crumb-text">Language focus</span></nav><div class="pc-header-tab-activity">Language focus</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header><div class="layout-progress-container"><div class="comp-question-progress" style="width:100%"></div></div>
    <main id="exercise" class="layout-container"><div class="abs-direction">Directions: Match the sentence halves. Pay special attention to the meanings of the underlined words.</div><div class="sequence-view"><div class="sequence-question-view">${left}</div><div class="sequence-reply-view"><div class="sortable-list-wrapper">${right}</div></div></div></main><footer><button id="submit">提交</button></footer>
    <script>
      const initial=${JSON.stringify(order)},options=${JSON.stringify(matchingOptions)},expected=${JSON.stringify(indices.map(i=>matchingMap[i]))},mode=${JSON.stringify(mode)},renumber=${JSON.stringify(renumber)},pressRender=${JSON.stringify(pressRender)};
      window.answerOrder=[...initial];window.dragEvents=0;window.submitted=false;window.submittedOrder=[];let held=null,started=0,hover=null;
      let list=document.querySelector('.sortable-list-wrapper');window.pressRepaints=0;window.scrollRepaints=0;
      function render(){list.innerHTML=window.answerOrder.map((id,i)=>'<div class="sequence-reply-view-item-text" data-option-id="'+id+'" '+(mode==='html5'?'draggable="true"':'')+'><span>'+String.fromCharCode(65+(renumber?i:id))+'.</span><span>'+options[id]+'</span></div>').join('');}
      function commit(source,target){if(source==null||target==null||source===target||mode==='inert')return;const next=[...window.answerOrder],from=next.indexOf(source),to=next.indexOf(target);next.splice(from,1);next.splice(to,0,source);window.dragEvents++;setTimeout(()=>{window.answerOrder=next;render();},60);if(mode==='revert')setTimeout(()=>{window.answerOrder=[...initial];render();},160);}
      const item=event=>event.target.closest('.sequence-reply-view-item-text');
      function repaint(kind){if(kind==='sequence'){const section=document.querySelector('.sequence-view');section.outerHTML=section.outerHTML;list=document.querySelector('.sortable-list-wrapper');list.removeAttribute('data-ustudy-control');}else if(kind==='container'){list.outerHTML='<div class="sortable-list-wrapper"></div>';list=document.querySelector('.sortable-list-wrapper');}render();}
      document.addEventListener('mousedown',event=>{if(mode==='html5')return;const row=item(event);if(row){held=Number(row.dataset.optionId);started=Date.now();hover=held;if(pressRender){window.pressRepaints++;repaint(pressRender);}}});
      ${repaintOnScroll?"document.addEventListener('scroll',()=>{window.scrollRepaints++;repaint('container');},true);":''}
      document.addEventListener('mousemove',event=>{if(held==null||Date.now()-started<150)return;const row=item(event);if(row)hover=Number(row.dataset.optionId);});
      document.addEventListener('mouseup',()=>{window.pointerReleased=true;if(held!=null&&Date.now()-started>=150)commit(held,hover);held=null;});
      list.addEventListener('dragstart',event=>{const row=item(event);if(row){held=Number(row.dataset.optionId);event.dataTransfer.setData('text/plain',String(held));}});
      list.addEventListener('dragover',event=>event.preventDefault());list.addEventListener('drop',event=>{event.preventDefault();const row=item(event);if(row)commit(held,Number(row.dataset.optionId));held=null;});
      document.getElementById('submit').onclick=()=>{window.submitted=true;window.submittedOrder=[...window.answerOrder];const all=JSON.stringify(expected)===JSON.stringify(window.answerOrder),correct=${JSON.stringify(grading)}==='incorrect'?9:all?10:0;document.getElementById('exercise').innerHTML='<h2>答题小结</h2><p>共 10 道题，客观题 10 道，主观题 0 道</p><p>正确 ('+correct+'/10)</p><p>错误 ('+(10-correct)+'/10)</p><p>未作答 0</p>';document.querySelector('footer').innerHTML='';};
    </script></body></html>`;
}
