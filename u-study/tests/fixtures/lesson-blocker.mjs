// Synthetic ten-blank exercise. All state changes use normal input/click events.
export const blockerAnswers=['dizzying','renovated','dialect','blend','chopped','retirement','blooming','accommodation','residents','dense'];
export function lessonBlockerHTML({mode='ghost',late=true,keep=false}={}){
  return `<!doctype html><html><head><style>body{font:16px Arial;margin:20px}.comp-abs-input input{width:140px}.input-value-measure{position:absolute;left:-10000px}.ant-modal-wrap{position:fixed;inset:0;z-index:1000;background:transparent}.ant-modal{width:420px;margin:100px auto;padding:25px;background:white;border:1px solid #aaa}button{padding:10px}footer{padding-top:20px}</style></head><body>
    <header><div class="pc-break-crumb"><span class="pc-break-crumb-text">Offline Book</span><span class="pc-break-crumb-text">Offline Unit</span><span class="pc-break-crumb-text">Language focus</span></div><div class="pc-header-tab-activity">Language focus</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header>
    <main class="pc-main-container" id="exercise"><div class="layout-container"><div class="abs-direction">Complete the sentences with the correct form of the words below.</div><div class="option-wrapper">${blockerAnswers.map(word=>'<span class="option">'+word+'</span>').join(' ')}</div><div class="question-common-abs-scoop"><div class="item">${blockerAnswers.map((_word,index)=>'<p>'+ (index+1)+'. Use the required form for this sentence: <span class="comp-abs-input"><input id="blank-'+index+'" type="text"><span class="input-value-measure"></span></span>.</p>').join('')}</div></div></div></main><footer class="question-common-course-page"><button id="submit">提 交</button></footer>
    <script>
      window.submissions=[];window.inputEvents=0;window.acks=0;window.dangerCalls=0;window.modalShown=false;window.completed=false;
      window.showBlocker=()=>{
        if(document.querySelector('.ant-modal-wrap'))return;window.modalShown=true;
        const wrap=document.createElement('div');wrap.className='ant-modal-wrap';wrap.tabIndex=-1;
        if(${JSON.stringify(mode)}!=='empty'){
          wrap.innerHTML='<div class="ant-modal" role="dialog"><p>'+(${JSON.stringify(mode)}==='study'?'本单元学习时间：2026-09-01至2026-12-18；是否必修：必修':'确认清空当前答案？')+'</p><button id="danger">提交</button><button id="close-modal">关闭弹窗</button></div>';
          const modal=wrap.querySelector('.ant-modal');
          if(${JSON.stringify(mode)}==='ghost'){modal.style.display='none';modal.setAttribute('aria-hidden','true');}
          if(${JSON.stringify(mode)}==='study'){modal.innerHTML='<p>本单元学习时间：2026-09-01至2026-12-18</p><p>是否必修：必修</p><button id="ack">我知道了</button>';modal.querySelector('#ack').onclick=()=>{window.acks++;modal.style.display='none';modal.setAttribute('aria-hidden','true');};}
          else {modal.querySelector('#danger').onclick=()=>window.dangerCalls++;modal.querySelector('#close-modal').onclick=()=>wrap.remove();}
        }
        document.body.append(wrap);
      };
      document.querySelectorAll('input').forEach((input,index)=>{input.oninput=()=>{window.inputEvents++;input.nextElementSibling.textContent=input.value;};input.onblur=()=>{if(${late}&&index===9&&input.value&&!window.modalShown)window.showBlocker();};});
      document.querySelector('#submit').onclick=()=>{const values=[...document.querySelectorAll('#exercise input')].map(input=>input.value);window.submissions.push(values);window.completed=JSON.stringify(values)===${JSON.stringify(JSON.stringify(blockerAnswers))};if(${!keep}){const correct=window.completed?10:0;document.querySelector('#exercise').innerHTML='<h2>答题小结</h2><p>共10道题，客观题10道，主观题0道</p><p>正确 ('+correct+'/10)</p><p>错误 ('+(10-correct)+'/10)</p><p>未作答0</p>';document.querySelector('footer').innerHTML='';}};
      if(!${late})window.showBlocker();
    </script></body></html>`;
}
