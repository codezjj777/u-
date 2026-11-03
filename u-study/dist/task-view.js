/* Task rendering keeps log nodes, reading position, focus and expanded details. */
(() => {
  function create({container,escape,icon,time,statusNames}){
    let shellKey='',oldLogs=[],taskId=null;
    const line=log=>`<div class="log-line ${log.level==='error'?'error':''}"><span class="log-time">${time(log.timestamp)}</span><span class="log-content">${escape(log.message)}</span></div>`;
    function render(task,demo){
      if(!task){if(shellKey!=='idle'){container.innerHTML=`<div class="task-idle"><span>${icon('sparkles')}</span><h3>准备好，开始下一步</h3><p>选择一门课程并点击开始，<br>这里会实时显示答题进度。</p></div>`;shellKey='idle';}taskId=null;oldLogs=[];return;}
      const key=JSON.stringify([task.id,demo,task.status,task.answered,task.pages,task.source,task.unitLabel,task.requiredCompleted,task.requiredTotal,task.currentEntry,task.manualItems,task.oralReview]);
      let logBox=container.querySelector('.task-live-log');
      const atBottom=!logBox||logBox.scrollHeight-logBox.scrollTop-logBox.clientHeight<40;
      const scrollTop=logBox?.scrollTop||0;
      if(key!==shellKey){
        const previousId=taskId,focused=container.ownerDocument.activeElement,focusAction=container.contains(focused)?focused.dataset?.taskAction:null;
        const wasOpen=container.querySelector('.manual-items')?.open;
        if(logBox&&previousId===task.id)logBox.remove();else{logBox=null;oldLogs=[];}
        const controllable=['waiting','running','paused','review'].includes(task.status);
        container.innerHTML=`<div class="task-live-stats"><div><strong>${String(task.answered||0).padStart(2,'0')}</strong><small>已填答题目</small></div><div><strong>${String(task.pages||0).padStart(2,'0')}</strong><small>已处理页面</small></div><div><strong>${escape(demo?'演示':task.source||'题库')}</strong><small>答案来源</small></div></div>${task.unitLabel?`<p class="task-unit-progress">${escape(task.unitLabel)} · 必修完成 ${task.requiredCompleted||0}/${task.requiredTotal||0}${task.currentEntry?`<br>${escape(task.currentEntry)}`:''}</p>`:''}${task.status==='partial'&&task.manualItems?.length?`<details class="manual-items"><summary>待手动处理 ${task.manualItems.length} 项</summary><ul>${task.manualItems.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></details>`:''}<div class="task-live-log" role="log" aria-label="答题日志" tabindex="0"></div><div class="task-controls">${['waiting','running'].includes(task.status)?`<button class="button secondary" data-task-action="pause">${icon('pause')}暂停</button>`:['paused','review'].includes(task.status)?`<button class="button secondary" data-task-action="resume">${icon('play')}${task.status==='review'?'继续核对':'继续'}</button>`:''}${task.status==='review'&&task.oralReview?.ready===true?`<button class="button primary" data-task-action="replace-oral">${icon('play')}用本地音频重录</button>`:''}${controllable?`<button class="button secondary" data-task-action="stop">${icon('stop')}停止</button>`:''}<span class="running-label">${task.status==='running'?'<span class="pulse-dot"></span>':''}${escape(statusNames[task.status]||'')}</span></div>`;
        const placeholder=container.querySelector('.task-live-log');if(logBox)placeholder.replaceWith(logBox);else logBox=placeholder;
        const details=container.querySelector('.manual-items');if(details&&previousId===task.id)details.open=wasOpen;
        if(focusAction)container.querySelector(`[data-task-action="${focusAction}"]`)?.focus();
        shellKey=key;taskId=task.id;
      }
      const logs=task.logs||[];
      if(JSON.stringify(logs)!==JSON.stringify(oldLogs)){
        let overlap=Math.min(oldLogs.length,logs.length);
        while(overlap&&JSON.stringify(oldLogs.slice(-overlap))!==JSON.stringify(logs.slice(0,overlap)))overlap--;
        if(!oldLogs.length)logBox.replaceChildren();
        for(let count=oldLogs.length-overlap;count>0&&logBox.firstChild;count--)logBox.firstChild.remove();
        for(const log of logs.slice(overlap)){const holder=container.ownerDocument.createElement('div');holder.innerHTML=line(log);logBox.append(holder.firstElementChild);}
        oldLogs=logs.map(log=>({...log}));
      }
      if(logBox){logBox.scrollTop=atBottom?logBox.scrollHeight:scrollTop;}
    }
    return {render};
  }
  globalThis.UStudyTaskView=Object.freeze({create});
})();
