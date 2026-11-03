import {inlineWordBankHTML,inlineWordBankAnswers} from './inline-word-bank.mjs';

export const translationAnswer='We learn English every day.\nWe help one another.';
export const descriptionAnswer='The park is quiet.\nPeople walk together.';
export const letterAnswer='Dear Alex,\n\nI enjoyed our visit to the library. Let us meet again next week.\n\nBest wishes,\nSam';
export const manualAnswer='Correct manually entered answer.';
export function gradedAnswer(question){
  if(question.question.includes('Which color'))return ['Blue'];
  if(question.question.includes('Which animals'))return ['Cat','Dog'];
  if(question.question.includes('whale is a mammal'))return ['True.'];
  if(question.question.includes('Real friends'))return inlineWordBankAnswers;
  if(question.question.includes('dropdowns'))return ['goes','walk'];
  if(question.question.includes('Translate the paragraph'))return [translationAnswer];
  if(question.question.includes('short description'))return [descriptionAnswer];
  if(question.question.includes('Write a letter'))return [letterAnswer];
  if(question.question.includes('manual answer'))return [manualAnswer];
  throw new Error('Unexpected fixture question: '+question.question);
}

export function gradedExerciseHTML({reverse=false,mode='correct',startSecond=false}={}){
  const order=values=>reverse?[...values].reverse():values;
  const radio=(id,title,values)=>`<fieldset><legend>${title}</legend>${order(values).map(value=>`<label><input type="radio" name="${id}">${value}</label>`).join('')}</fieldset>`;
  const checkbox=`<fieldset><legend>Which animals are pets? Select two.</legend>${order(['Cat','Dog','Shark']).map(value=>`<label><input type="checkbox" name="pets">${value}</label>`).join('')}</fieldset>`;
  const first=radio('color','Which color is the sky?',['Blue','Red'])+checkbox+radio('truefalse','A whale is a mammal.',['True.','False.']);
  let cloze=inlineWordBankHTML().match(/<main class="layout-container">([\s\S]*?)<\/main>/)[1];
  if(reverse){const bank=cloze.match(/<div class="option-wrapper">([\s\S]*?)<\/div>/)[1];cloze=cloze.replace(bank,(bank.match(/<span class="option">[\s\S]*?<\/span>/g)||[]).reverse().join(''));}
  const select=(values)=>`<select><option value="">请选择</option>${order(values).map(value=>`<option value="${reverse?'new-':'old-'}${value}">${value}</option>`).join('')}</select>`;
  const second=cloze+`<fieldset><legend>Complete the dropdowns.</legend>She ${select(['goes','went'])} home. They ${select(['walk','ran'])} daily.</fieldset><div class="question-item"><h3><p>Translate the paragraph.</p><p>Keep both sentences and punctuation.</p></h3><textarea id="translation"></textarea></div><div class="question-item"><h3>Write a short description.</h3><div id="description" contenteditable="true"></div></div><div data-ipublish-question-group-type="writing_group"><div data-question-id="letter"><div class="editor-content"><p>Write a letter about a visit to the library.</p></div><textarea id="letter" placeholder="Your letter"></textarea></div></div>`;
  const manual='<div class="question-item"><h3>Write a manual answer.</h3><textarea id="manual-answer"></textarea></div>';
  return `<!doctype html><html><body><style>.input-value-measure{position:absolute;left:-10000px}input[type=text]{width:180px}textarea,[contenteditable]{min-height:35px;display:block}</style>
    <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Complete English Book</span><span class="pc-break-crumb-text">Unit 1</span><span class="pc-break-crumb-text">Practice</span></nav><div class="pc-header-tab-activity">Practice</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header>
    <div class="layout-progress-container"><div class="comp-question-progress" style="width:50%"></div></div>
    <main id="exercise" class="pc-main-container"></main><footer id="footer"></footer>
    <script>
      window.submitted=false;window.savedFirst=[];
      const exercise=document.getElementById('exercise'),footer=document.getElementById('footer');
      function show(body,last){exercise.innerHTML='<div class="layout-container"><div class="abs-direction">Answer every part of this exercise.</div><div class="passage"><p>Complete original reading material.</p><p>The library opens at 8:00 and closes at six.</p></div>'+body+'</div>';document.querySelector('.comp-question-progress').style.width=last?'100%':'50%';document.querySelectorAll('.comp-abs-input input').forEach(input=>input.oninput=()=>input.nextElementSibling.textContent=input.value);footer.innerHTML=last?'<button id="submit">提交</button>':'<button id="next">下一题</button>';if(last)footer.firstElementChild.onclick=submit;else footer.firstElementChild.onclick=()=>{window.savedFirst=[...document.querySelectorAll('input:checked')].map(el=>el.parentElement.textContent);show(${JSON.stringify(second)},true);};}
      function submit(){window.submitted=true;const total=${mode==='manual'?1:8},correct=${mode==='pass'?7:mode==='pending'?5:mode==='manual'?1:8};exercise.innerHTML='<h2>答题小结</h2><p>共 '+total+' 道题，客观题 '+${mode==='manual'?0:5}+' 道，主观题 '+${mode==='manual'?1:3}+' 道</p><p>正确 ('+correct+'/'+${mode==='pending'?5:mode==='manual'?1:8}+')</p><p>错误 ('+${mode==='pass'?1:0}+'/'+total+')</p><p>部分正确 (0/'+total+')</p><p>未作答 0</p>'+${JSON.stringify(mode==='pending'?'<p>主观题待批改</p>':'<p>已达到闯关条件</p>')};footer.innerHTML='';}
      show(${JSON.stringify(mode==='manual'?manual:startSecond?second:first)},${JSON.stringify(mode==='manual'||startSecond)});
    </script></body></html>`;
}
