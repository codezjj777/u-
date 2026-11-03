export function discussionBoardHTML({editable=false,draft='',delay=80,failed=false,mixed=false,duplicates=false,ghost=false,customButton=false,enableDelay=0,mountDelay=0,neverMount=false}={}){
  const editor=editable?'<div contenteditable="true" data-placeholder="我来评论" id="comment"></div>':'<textarea placeholder="我来评论" id="comment"></textarea>';
  return `<!doctype html><html><head><style>textarea,[contenteditable]{width:480px;min-height:80px}button{padding:8px}.ant-modal-wrap{position:fixed;inset:0;z-index:100}.ant-modal{display:none}</style></head><body>
  <header><div class="pc-break-crumb"><span class="pc-break-crumb-text">Offline Book</span><span class="pc-break-crumb-text">Knowing yourself</span><span class="pc-break-crumb-text">Before you read</span></div><div class="pc-header-tab-activity">Before you read</div><div class="pc-task pc-header-task-activity">Before you read</div></header>
  <main class="pc-main-container"><p>Read the following questions and share your answers on the discussion board.</p><p>What helps you learn a new skill?</p>
  ${mixed?'<fieldset><legend>Write a complete answer.</legend><input type="text"></fieldset>':''}
  <div class="layout-container discussion-view"><div class="discussion-title">Read the following questions and share your answers on the discussion board.</div><div class="dis-view"><div class="question-common-abs-reply"><div>
  <section class="discussion-course-page-sdk"><div class="ds-discussion-reply"><div class="ds-discussion-recordList"><h3>全部评论（<span id="total">1</span>条）</h3><div id="comments"><div class="ds-comment-content">A different learner has already commented.</div></div>
  <div class="ds-discussion-reply-container"><textarea placeholder="我来评论" id="reply"></textarea><button id="reply-button">发布</button></div>
  </div><div class="ds-discussion-bottom"><div class="ds-discussion-bottom-textArea-container"><div class="discussion-cloud-bottom-textArea">${editor}</div></div><div class="ds-discussion-bottom-btns">${customButton?'<div id="publish"><span>发布</span></div>':'<button id="publish" disabled class="submit-btn"><span>发 布</span></button>'}${duplicates?'<button>发布</button>':''}</div></div></div></section>
  </div></div></div></div></main>
  <aside class="v3notes"><textarea id="notes">A private note.</textarea><button>发布</button></aside>
  ${ghost?'<div class="ant-modal-wrap"><div class="ant-modal" role="dialog">Closed notice</div></div>':''}
  <script>window.publishes=0;window.replyClicks=0;window.values=[];window.done=false;
  const editor=document.querySelector('#comment'),button=document.querySelector('#publish');
  const value=()=>editor.matches('[contenteditable]')?editor.textContent:editor.value;
  const set=text=>{if(editor.matches('[contenteditable]'))editor.textContent=text;else editor.value=text;};set(${JSON.stringify(draft)});
  editor.oninput=()=>{button.disabled=true;button.setAttribute('aria-disabled','true');setTimeout(()=>{button.disabled=!value().trim();button.setAttribute('aria-disabled',String(button.disabled));},${enableDelay});};editor.dispatchEvent(new Event('input'));
  document.querySelector('#reply-button').onclick=()=>window.replyClicks++;
  button.onclick=()=>{window.publishes++;window.values.push(value());button.disabled=true;setTimeout(()=>{if(${failed}){button.disabled=false;return;}const comment=document.createElement('div');comment.className='ds-comment-content';comment.textContent=value();document.querySelector('#comments').append(comment);document.querySelector('#total').textContent=String(Number(document.querySelector('#total').textContent)+1);set('');window.done=true;},${delay});};
  if(${mountDelay}>0||${neverMount}){const sdk=document.querySelector('.discussion-course-page-sdk'),parent=sdk.parentElement;sdk.remove();if(!${neverMount})setTimeout(()=>parent.append(sdk),${mountDelay});}
  </script></body></html>`;
}
