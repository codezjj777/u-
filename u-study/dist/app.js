/* U Study: dependency-free UI. No account credentials are handled here. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const icons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    sparkles:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z"/>',
    leaf:'<path d="M20 3C6 2 2 8 5 16c8 5 16-1 15-13Z"/><path d="M3 21 15 9M9 15v-5m0 5h5"/>',
    settings:'<path d="m9 3-.6 2.2-2 .9-2-.6-2 3.4 1.5 1.6v2.3l-1.5 1.5 2 3.5 2.1-.6 1.9 1 .6 2.2h4l.6-2.2 2-1 2 .6 2-3.5-1.5-1.5v-2.3l1.5-1.6-2-3.4-2.1.6-1.9-.9L13 3H9Z"/><circle cx="11" cy="12" r="3"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
    power:'<path d="M12 3v9M6.3 5.8a8.5 8.5 0 1 0 11.4 0"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    book:'<path d="M12 6C8 3 5 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-1-10 2Zm0 0v15"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
    shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    play:'<path d="m8 4 13 8L8 20V4Z"/>', pause:'<path d="M8 5v14M16 5v14"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    x:'<path d="m6 6 12 12M6 18 18 6"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    external:'<path d="M14 3h7v7m-9 2 9-9M10 3H4v17h17v-6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    graduation:'<path d="m2 9 10-5 10 5-10 5-10-5Zm4 3v5c4 3 8 3 12 0v-5M22 9v7"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
  function hydrate(root = document) { root.querySelectorAll('i[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); }); }
  const demos = [
    { id:'demo-1',title:'新视野大学英语 · 读写教程 2',subtitle:'Unit 4 · College life in the Internet age',progress:62,status:'active',label:'大学英语',edition:'读写教程 · 第三版',cover:'sage',english:'READING & WRITING',book:'新视野',volume:'大学英语 · 读写教程 2' },
    { id:'demo-2',title:'新视野大学英语 · 视听说教程 2',subtitle:'Unit 3 · Life moments',progress:38,status:'active',label:'视听说',edition:'视听说教程 · 第三版',cover:'blue',english:'LISTENING & SPEAKING',book:'听见世界',volume:'大学英语 · 视听说教程 2' },
    { id:'demo-3',title:'新一代大学英语 · 综合教程 1',subtitle:'Unit 5 · A journey of discovery',progress:81,status:'active',label:'综合英语',edition:'综合教程 · 基础篇',cover:'sand',english:'EXPLORE YOUR WORLD',book:'新一代',volume:'大学英语 · 综合教程 1' },
    { id:'demo-4',title:'大学英语 · 基础语法与写作',subtitle:'所有演示单元均已完成',progress:100,status:'completed',label:'语法写作',edition:'基础语法 · 实践篇',cover:'lavender',english:'GRAMMAR & EXPRESSION',book:'笔下有光',volume:'大学英语 · 基础语法与写作' }
  ];
  const sampleQuestions = [
    {question:'If I had known about the meeting, I ____ attended it.',options:['had','would have','have','will have'],type:'single'},
    {question:'Choose the synonyms of important.',options:['irrelevant','essential','trivial','significant'],type:'multiple'},
    {question:'She has been learning English ____ five years.',options:[],type:'text'}
  ];
  const sampleBank = UStudy.validateBank([
    {question:sampleQuestions[0].question,answer:'would have',explanation:'过去事实的虚拟条件句，主句使用 would have done。'},
    {question:sampleQuestions[1].question,answer:['significant','essential'],explanation:'significant 和 essential 都可以表达重要性。'},
    {question:sampleQuestions[2].question,answer:'for',explanation:'for 用于一段时间，since 用于起始时间点。'}
  ]);
  const defaults = {aiEnabled:false,endpoint:'',model:'',autoSubmit:false,oralMode:'short',questionSelector:'',nextSelector:'',submitSelector:''};
  let state = {courses:[],tasks:[],activity:[],settings:{...defaults},bankCount:0,connected:false,syncing:false,keyPresent:false};
  let apiAvailable = false, demo = localStorage.getItem('ustudy-demo') !== 'false', filter = 'all', layout = localStorage.getItem('ustudy-layout') || 'grid', view = 'courses', demoTask = null, demoTimer = null, toastTimer;
  let pendingBank = null, courseOptionsKey = '', manualEntriesClearing=false, bankExporting=false;
  let unitCatalog=null,unitsLoading=false,unitOptionsKey='',unitError='';
  let taskStarting=false,progressRefreshInFlight=false;
  const progressRefreshAttempts=new Map(),recentlyFinishedTasks=new Set();
  let aiTestController = null;
  let settingsServiceError=false,aiServiceError=false;
  let shutdownRequested=false,shutdownPending=false,shutdownComplete=false,shutdownController=null;
  const service=UStudyService.createClient({onState:acceptState,onNotice:notice=>toast(notice.message),onConnectionChange:handleServiceConnection});
  const activeStatuses = new Set(['waiting','running','paused','review','stopping']);
  const statusNames = {waiting:'读取必修目录',running:'正在处理必修',paused:'已暂停',review:'等待核对',partial:'有待手动项目',completed:'已完成',failed:'需要处理',stopped:'已停止',stopping:'正在停止'};
  const time = ts => new Date(ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const taskView=UStudyTaskView.create({container:$('#task-live-content'),escape,icon,time,statusNames});
  const regionCache=new Map();
  function setHTML(selector,html){if(regionCache.get(selector)===html)return;regionCache.set(selector,html);$(selector).innerHTML=html;}
  const dateTime = ts => new Date(ts).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const courses = () => demo ? demos : state.courses;
  const tasks = () => demo ? (demoTask ? [demoTask] : []) : state.tasks;
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove('show'),6000); }
  async function api(path, data, method = 'POST', signal) {
    if(shutdownRequested)throw new Error('程序正在安全退出。');
    return service.request(path,data,method,signal);
  }
  async function safeExit(){
    if(shutdownPending||shutdownComplete)return;
    shutdownRequested=true;shutdownPending=true;shutdownController=new AbortController();
    $('#safe-exit').disabled=true;$('.app-shell').inert=true;$('#shutdown-overlay').hidden=false;$('#shutdown-overlay').dataset.state='busy';
    $('#shutdown-title').textContent='正在安全退出';$('#shutdown-message').textContent='正在停止任务、保存数据并关闭学习窗口，请稍候。';$('#shutdown-symbol').classList.add('spinning');$('#shutdown-retry').hidden=true;$('#shutdown-panel').focus?.();
    clearTimeout(demoTimer);aiTestController?.abort();window.dispatchEvent(new window.Event('ustudy-shutdown'));
    try{
      const result=await service.shutdown({signal:shutdownController.signal,onProgress:phase=>{
        if(phase==='stopping')$('#shutdown-message').textContent='正在等待后台程序完全退出，请稍候。';
      }});
      shutdownComplete=true;$('#shutdown-overlay').dataset.state='done';$('#shutdown-title').textContent='程序已安全退出';$('#shutdown-symbol').innerHTML=icon('check');
      $('#shutdown-message').textContent=(result.saved?'学习记录已保存。':'')+'后台程序已停止，可以关闭此页面。下次使用时请双击「一键启动.cmd」。';$('#connection-state').textContent='程序已退出';
      setTimeout(()=>{if(typeof window.close==='function')window.close();},350);
    }catch(error){
      service.stop();
      $('#shutdown-overlay').dataset.state='error';$('#shutdown-title').textContent='安全退出尚未完成';$('#shutdown-message').textContent=error.message||'请重试退出，或运行「一键停止.cmd」。';$('#shutdown-retry').hidden=false;$('#shutdown-retry').focus?.();
    }finally{shutdownPending=false;$('#shutdown-symbol').classList.remove('spinning');}
  }
  function renderServiceStatus(){
    renderKeyStatus();
    $('#bank-status').textContent=pendingBank?`已读取 ${pendingBank.length} 条题库记录，保存后生效`:`题库共 ${state.bankCount||0} 条记录，其中 ${state.exerciseBankCount||0} 道完整大题`;
    $('#export-bank').disabled=demo||bankExporting||!apiAvailable||!state.bankCount;
    const manualCount=state.manualEntryCount||0;
    $('#manual-entry-status').textContent=`已记住 ${manualCount} 个待手动项目`;
    $('#clear-manual-entries').disabled=demo||manualEntriesClearing||!apiAvailable||!manualCount||!!state.operation||state.syncing||state.tasks.some(task=>activeStatuses.has(task.status));
    const message=state.storageError||state.operation?.label||'';
    $('#system-status').hidden=!message;$('#system-status').textContent=message;$('#system-status').dataset.error=String(!!state.storageError);
    $('#connection-state').innerHTML=`<span class="status-dot ${!apiAvailable||demo||!state.connected?'amber':''}"></span>${!apiAvailable?'本地服务重连中':demo?'演示模式':state.connected?'U校园已连接':'等待登录'}`;
    $('#settings-service-state').textContent=apiAvailable?'本地服务已连接':'本地服务连接中…';
    $('#settings-service-state').dataset.connected=String(apiAvailable);
    $('#settings-service-note').hidden=apiAvailable;
    $('#connector-detail').textContent=apiAvailable?state.windowOpen?'本地登录窗口已打开。登录完成后即可同步。':'本地服务已就绪。点击上方按钮打开登录窗口。':'正在自动重连本地服务，已填写的内容会保留。也可使用「重新连接」。';
  }
  function renderKeyStatus(){
    $('#api-key').disabled=state.keySource==='environment';
    $('#api-key').placeholder=state.keyPresent?'留空继续使用已保存的 Key':'输入 API Key，保存后重启仍可使用';
    $('#api-key-status').textContent=state.keyPresent?(state.keySource==='environment'?'正在使用环境变量 Key':state.keySource==='local'?'Key 已保存在本机，重启后自动恢复':'当前 Key 仅在旧服务内存中，新版需保存一次以保留到本机'):'开发阶段：保存到本机 .runtime/credentials.json，发布前再调整密钥管理';
  }
  function handleServiceConnection(available){
    apiAvailable=available;if(shutdownRequested){$('#connection-state').textContent=shutdownComplete?'程序已退出':'正在安全退出';return;}renderServiceStatus();
    if(available){
      if(settingsServiceError){$('#settings-error').hidden=true;settingsServiceError=false;}
      if(aiServiceError){$('#ai-test-result').hidden=true;aiServiceError=false;}
    }
  }
  function setDemo(value) { demo = value; localStorage.setItem('ustudy-demo',String(value)); renderAll(); }
  function illustration(cover) {
    const arts = {
      sage:'<path d="M42 87 27 37l31-6 29 19-30 9 12 38Z" fill="#f7faf0" stroke="#9eae8b"/><path d="m58 31 13 48M27 37l28 18 32-5M55 55l14 42M69 97l28-9-10-38"/><path d="m39 46 11 7m-8 3 10 6m-7 3 9 6m-6 3 8 5"/><path d="M92 48c-3-10 5-22 13-28-1 12-4 25-13 28Zm3-5c9-1 15-8 17-16-10 2-18 9-17 16Z" fill="#b7c9a1" stroke="none"/><path d="m91 68 3-25m-4 10c-10-2-14-10-12-18 8 4 12 11 12 18Z"/><circle cx="25" cy="18" r="2" stroke="none" fill="currentColor" opacity=".35"/><path d="M12 81h11m-5-5v10"/>',
      blue:'<path d="M32 70V41a28 28 0 0 1 56 0v29" stroke="#a4bbc9" stroke-width="6"/><rect x="25" y="49" width="17" height="31" rx="6" fill="#f9fcfd" stroke="#8eabbe"/><rect x="78" y="49" width="17" height="31" rx="6" fill="#f9fcfd" stroke="#8eabbe"/><path d="m48 45 1 29m7-36v44m9-52v60m8-45v29" stroke="#9ab7c7"/><circle cx="105" cy="28" r="11" stroke="#bacdd5"/><path d="m102 23 7 5-7 5V23Z" fill="#c2d3dc" stroke="none"/><path d="M21 94c16-6 49 9 77-3" stroke="#c3d4dc"/>',
      sand:'<circle cx="70" cy="49" r="33" fill="#fbf8ef" stroke="#c7b391"/><ellipse cx="70" cy="49" rx="16" ry="33" stroke="#c7b391"/><path d="M37 49h66M42 32h56M42 66h56M70 16v66" stroke="#c7b391"/><path d="M69 82v10m-16 2h34" stroke="#b4a078" stroke-width="2"/><path d="m21 19 4 7 8-2-4 8 4 6-8-1-5 6v-9l-7-3 8-4v-8Z" fill="#e8d7ac" stroke="none"/><path d="m104 81 5 5m-5 0 5-5" stroke="#c5ae80"/>',
      lavender:'<path d="m30 36 43-7 12 60-43 7-12-60Z" fill="#f8f6fb" stroke="#baafca"/><path d="m38 45 28-5m-26 13 28-5m-26 13 19-4m-17 12 28-5m-26 13 23-4" stroke="#c1b5cd"/><path d="m72 67 22-41 8 4-23 41-8 7 1-11Z" fill="#c6b8d5" stroke="#b5a5c8"/><path d="m94 26 3-6c2-4 10 0 8 4l-3 6M72 67l7 4"/><path d="M99 73h12m-6-6v12" stroke="#c9beda"/><circle cx="21" cy="61" r="3" fill="#cec3dc" stroke="none"/>'
    };
    return `<div class="cover-illustration"><svg viewBox="0 0 130 110" aria-hidden="true">${arts[cover] || arts.sage}</svg></div>`;
  }
  function decorate(course, index = 0) { return {...{cover:['sage','blue','sand','lavender'][index % 4],english:'YOUR LEARNING JOURNEY',book:course.title?.split(/[·（(]/)[0].slice(0,8) || '我的课程',volume:'U校园 · 课程学习',label:'U校园课程',edition:'已同步的真实课程'},...course}; }
  function coverHTML(course) { return `<div class="course-cover cover-${escape(course.cover)}"><div class="cover-copy"><span>${escape(course.english)}</span><strong>${escape(course.book)}</strong><small>${escape(course.volume)}</small></div><span class="course-status"><span></span>${course.requiresActivation?'待激活':course.status === 'completed' ? '已完成' : '学习中'}</span>${illustration(course.cover)}</div>`; }
  function courseHTML(raw, index) {
    const c = decorate(raw,index), pct = c.progress === null || c.progress === undefined ? '未提供' : `${c.progress}%`;
    const groupInfo=c.group?`<div class="course-group"><strong>${escape(c.group.name)}</strong><span>${escape(c.group.className)}</span><small>记分周期 ${escape(c.group.period)}</small></div>`:`<div class="course-meta">${icon('graduation')}${escape(c.label)}<span>·</span>${escape(c.edition)}</div>`;
    return `<article class="course-card">${coverHTML(c)}<div class="course-body">${groupInfo}<h2 title="${escape(c.title)}">${escape(c.title)}</h2><p class="course-subtitle">${escape(c.requiresActivation?'请先在 U校园激活教程':c.subtitle || '打开课程，查看学习内容')}</p><div class="course-progress"><div class="progress-label"><span>课程进度</span><strong>${pct}</strong></div><div class="progress-track"><span style="width:${Number(c.progress) || 0}%"></span></div></div><div class="course-actions"><button class="button primary" data-course-start="${escape(c.id)}" ${c.requiresActivation?'disabled':''}>${icon('sparkles')}${c.requiresActivation?'待激活':'自动答题'}</button><button class="detail-button" data-course-detail="${escape(c.id)}">查看课程 ${icon('arrow-right')}</button></div></div></article>`;
  }
  function renderCourses() {
    const all = courses(), query = UStudy.normalize($('#course-search').value);
    const shown = all.filter(c => (filter === 'all' || c.status === filter&&(filter!=='active'||!c.requiresActivation)) && UStudy.normalize(UStudy.courseLabel(c)+' '+c.subtitle).includes(query));
    $('#course-grid').innerHTML = shown.map(courseHTML).join('');
    $('#course-grid').classList.toggle('list-layout',layout === 'list');
    $('#empty-state').hidden = shown.length > 0;
    const grouped=all.some(c=>c.group),groupCount=new Set(shown.map(c=>UStudy.courseGroupKey(c.group)).filter(Boolean)).size;
    $('#metric-total-label').textContent=grouped?'教程入口':'全部课程';
    $('#metric-total').innerHTML = `${String(all.length).padStart(2,'0')}<small>${grouped?'个':'门'}</small>`;
    $('#metric-active').innerHTML = `${String(all.filter(x=>x.status!=='completed'&&!x.requiresActivation).length).padStart(2,'0')}<small>${grouped?'个':'门'}</small>`;
    $('#metric-completed').innerHTML = `${String(all.filter(x=>x.status==='completed').length).padStart(2,'0')}<small>${grouped?'个':'门'}</small>`;
    $('#nav-count').textContent = all.length; $('#filter-total').textContent = all.length;
    $('#list-summary').textContent = `${groupCount?`${groupCount} 个课程班级 · ${shown.length} 个教程入口`:`共 ${shown.length} 门课程`}${query ? ' · 搜索结果' : ''}`;
    $('#sync-caption').textContent = demo ? '演示数据 · 随时体验' : state.lastSynced ? `${state.syncCoverage?.complete===false?'部分同步 · ':''}同步于 ${time(state.lastSynced)}` : '等待同步真实课程';
    $$('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter));
    $$('[data-layout]').forEach(b=>b.classList.toggle('selected',b.dataset.layout===layout));
    $('#demo-notice').hidden = !demo;
    renderServiceStatus();
    $('#demo-toggle').textContent = demo ? '退出演示，显示真实课程' : '体验演示课程';
    $$('[data-action=sync]').forEach(b=>{b.disabled=state.syncing;b.classList.toggle('spinning',state.syncing)});
  }
  function renderActivity() {
    const items = demo ? [{message:'已载入 4 门演示课程',timestamp:Date.now(),icon:'book'},{message:'本地答题演示已准备就绪',timestamp:Date.now(),icon:'sparkles'},{message:'连接账号即可同步真实课程',timestamp:Date.now(),icon:'shield'}] : state.activity.slice(0,5);
    setHTML('#recent-activity',items.length ? items.map(a=>`<div class="activity-item"><span class="activity-marker">${icon(a.icon || 'check')}</span><div><p>${escape(a.message)}</p><small>${demo ? '演示提示' : dateTime(a.timestamp)}</small></div></div>`).join('') : '<div class="history-empty">等待第一次课程同步</div>');
  }
  function renderTasks() {
    const previous = $('#task-course').value, all = courses();
    const optionsKey=JSON.stringify(all.map(c=>[c.id,c.title,c.progress,c.group,c.requiresActivation]));
    if(optionsKey!==courseOptionsKey){$('#task-course').innerHTML = all.length ? all.map(c=>`<option value="${escape(c.id)}" ${c.requiresActivation?'disabled':''}>${escape(UStudy.courseLabel(c))}${c.requiresActivation?' · 待激活':''}</option>`).join('') : '<option value="">请先同步课程</option>';if (all.some(c=>c.id===previous)) $('#task-course').value=previous;courseOptionsKey=optionsKey;updateTaskCourse();}
    $('#bank-count-label').textContent = demo ? '3 道演示题目 · 仅用于体验' : `已导入 ${state.bankCount} 道题目${state.settings.aiEnabled ? ' · AI 补充已启用' : ''}`;
    $('#submit-summary').textContent = state.settings.autoSubmit ? '自动提交并继续' : '填答后等待确认';
    $('#oral-mode-summary').textContent = state.settings.oralMode==='retell' ? '完整复述' : '短录音 · 5 秒';
    setHTML('#tasks-banner',`<span class="notice-icon">${icon('info')}</span><p>${demo ? '当前为演示模式：使用 3 道示例题体验自动匹配，不会操作真实课程。' : '任务运行时不会自动将课程窗口置前。需要人工核对时，请从任务栏切换到 U校园窗口。'}</p>${demo ? '<button data-action="connect">连接真实课程 ↗</button>' : ''}`);
    const list = tasks(), latest = list[0], busy = latest && activeStatuses.has(latest.status);
    $('#task-dot').hidden = !busy;
    renderUnits();
    $('#task-hint').textContent = all.find(c=>c.id===$('#task-course').value)?.requiresActivation?'该教程待激活，请先在 U校园完成激活。':demo ? '演示任务在本地运行，不会影响 U校园课程。' : '只处理所选单元中的必修且未完成项目。';
    $('#task-status-label').textContent = latest ? statusNames[latest.status] || latest.status : '等待开始';
    taskView.render(latest,demo);
    setHTML('#task-history-list',list.length ? list.map(t=>`<div class="history-row"><span class="square-icon">${icon('sparkles')}</span><div class="history-title"><strong>${escape(t.courseTitle)}</strong><small>${dateTime(t.createdAt)}${t.unitLabel?` · ${escape(t.unitLabel)}`:''}${demo ? ' · 演示任务' : ''}</small></div><span>${t.answered || 0} 题已填答</span><span class="subtle-tag">${escape(statusNames[t.status] || t.status)}</span></div>`).join('') : '<div class="history-empty">开始一次答题后，记录会出现在这里。</div>');
  }
  function updateTaskCourse() { const c = courses().find(c=>c.id===$('#task-course').value); $('#task-course-preview').innerHTML = c ? `<div class="task-course-mini"><span>${icon('book')}</span><div><h3>${escape(c.title)}</h3>${c.group?`<p>${escape(c.group.name)} · ${escape(c.group.className)}</p><p>${escape(c.group.period)}</p>`:''}<p>${demo ? '演示课程' : '来自 U校园'} · ${c.progress == null ? '未提供进度' : `课程进度 ${c.progress}%`}</p></div></div>` : '';if(unitCatalog?.courseId!==c?.id){unitCatalog=null;unitError='';}renderUnits(); }
  function renderUnits(){
    const course=courses().find(c=>c.id===$('#task-course').value),busy=tasks().some(t=>activeStatuses.has(t.status))||!!state.operation||state.syncing||taskStarting;
    const catalog=unitCatalog?.courseId===course?.id?unitCatalog:null;
    const units=demo?[{id:'demo-unit',label:'演示单元'}]:catalog?.units||[];
    const key=JSON.stringify([demo,course?.id,units]);
    if(key!==unitOptionsKey){$('#task-unit').innerHTML=units.length?units.map(unit=>`<option value="${escape(unit.id)}">${escape(unit.label)}</option>`).join(''):'<option value="">请先读取课程目录</option>';if(catalog)$('#task-unit').value=catalog.activeUnitId;unitOptionsKey=key;}
    const valid=demo||catalog&&catalog.activeUnitId===$('#task-unit').value;
    const requirementsPending=catalog?.availability==='pending';
    $('#directory-preview').hidden=demo||!catalog||!valid;
    setHTML('#directory-preview-content',catalog&&valid?`<p>${escape(catalog.account?`来源账号：${catalog.account}`:'来源：程序专用窗口')}</p><p>${escape(catalog.heading||'')} · ${catalog.entries?.length||0} 个目录项目</p>${catalog.sourceURL?`<a href="${escape(UStudy.safeCourseUrl(catalog.sourceURL)||'#')}" target="_blank" rel="noopener noreferrer">打开来源目录 ↗</a>`:''}<ul>${(catalog.entries||[]).map(entry=>`<li title="${escape(entry.rowText||'')}"><strong>${escape([...entry.path,entry.title].filter((name,index,all)=>index===0||name!==all[index-1]).join(' / '))}</strong><span>${escape(entry.requiredLabel||'未标必修')} · ${escape(entry.status||'状态未读取')}</span></li>`).join('')}</ul>`:'');
    $('#task-course').disabled=unitsLoading||busy;
    $('#task-unit').disabled=!units.length||unitsLoading||busy;
    $('#load-units').disabled=demo||!course||course.requiresActivation||unitsLoading||busy;
    $('#load-units').textContent=unitsLoading?'读取中…':'读取目录';
    $('#task-unit-summary').textContent=unitsLoading?(requirementsPending?'目录已出现，正在等待必修要求和完成状态载入…':'正在读取所选单元的真实目录…'):'';
    if(!unitsLoading&&!unitError)$('#task-unit-summary').textContent=demo?'仅用于体验本地示例题。':catalog&&valid?`必修 ${catalog.summary.required} 项 · 已完成 ${catalog.summary.completed} 项 · 待处理 ${catalog.summary.pending} 项${catalog.summary.unknown?` · 状态待核对 ${catalog.summary.unknown} 项`:''}。跳过选修和已完成项目。`:'请点击「读取目录」，再选择要处理的单元。';
    else if(unitError&&!unitsLoading)$('#task-unit-summary').textContent=unitError;
    $('#start-task').disabled=!course||course.requiresActivation||busy||unitsLoading||!valid||!demo&&(catalog?.summary.required===0||requirementsPending);
    if(!unitsLoading&&!unitError&&!demo&&catalog&&valid&&!catalog.summary.required)$('#task-unit-summary').textContent=requirementsPending?'目录暂时全部显示「已锁定」，必修要求尚未载入；请稍后重试或选择其他单元。':'未读取到必修标记，请先核对目录明细中的来源账号和课程班级，再重新读取。';
  }
  async function loadUnits(unitId){
    const courseId=$('#task-course').value;if(demo||!courseId||unitsLoading)return;
    let selected=unitId||(unitCatalog?.courseId===courseId?$('#task-unit').value:'');
    unitsLoading=true;unitError='';renderUnits();
    const deadline=Date.now()+25000;
    try{
      for(;;){
        const result=await api('/units',{courseId,...(selected?{unitId:selected}:{})});
        if($('#task-course').value!==courseId)return;
        unitCatalog=result;unitOptionsKey='';renderUnits();selected=result.activeUnitId;
        if(result.availability!=='pending'||Date.now()>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
    }catch(error){unitError=error.message;}
    finally{unitsLoading=false;renderUnits();refreshFinishedCourseProgress();}
  }

  function renderAll() { renderCourses(); renderActivity(); renderTasks(); }
  function switchView(next) { view=next; $('#courses-view').hidden=next!=='courses';$('#tasks-view').hidden=next!=='tasks';$$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));$('#breadcrumb-current').textContent=next==='courses'?'我的课程':'自动答题';document.title=`U Study · ${next==='courses'?'我的课程':'自动答题'}`;if(next==='tasks')renderTasks(); }
  function openDialog(id) { const d = $(id); if(!d.open)d.showModal(); }
  function openSettings() {
    resetAIConnectionTest();
    const s = {...defaults,...state.settings};
    for (const [id,key] of [['ai-enabled','aiEnabled'],['auto-submit','autoSubmit']]) $('#'+id).checked=s[key];
    for (const [id,key] of [['api-endpoint','endpoint'],['api-model','model'],['oral-mode','oralMode'],['question-selector','questionSelector'],['next-selector','nextSelector'],['submit-selector','submitSelector']]) $('#'+id).value=s[key];
    $('#api-key').value='';
    renderKeyStatus();
    $('#bank-status').textContent=pendingBank?`已选择 ${pendingBank.length} 道题目，保存后生效`:`已导入 ${state.bankCount} 道真实题目`;
    $('#settings-error').hidden=true;settingsServiceError=false;renderServiceStatus();$('#ai-fields').classList.toggle('inactive',!s.aiEnabled);openDialog('#settings-dialog');
  }
  function resetAIConnectionTest(){
    aiTestController?.abort();aiTestController=null;
    aiServiceError=false;
    const button=$('#test-ai-connection');button.disabled=false;button.classList.remove('spinning');button.setAttribute('aria-busy','false');button.innerHTML=icon('refresh')+'测试连接';
    const result=$('#ai-test-result');result.hidden=true;result.textContent='';delete result.dataset.status;
  }
  function showAIConnectionResult(message,status){const result=$('#ai-test-result');result.hidden=false;result.dataset.status=status;result.textContent=message;}
  async function testAIConnection(){
    if(aiTestController)return;
    const button=$('#test-ai-connection'),endpoint=$('#api-endpoint').value.trim(),model=$('#api-model').value.trim(),apiKey=$('#api-key').value.trim();
    $('#settings-error').hidden=true;
    if(!UStudy.validateEndpoint(endpoint)||!model){showAIConnectionResult('请先填写有效的 HTTPS 接口地址和模型名称。','error');return;}
    const controller=new AbortController();aiTestController=controller;
    button.disabled=true;button.classList.add('spinning');button.setAttribute('aria-busy','true');button.innerHTML=icon('refresh')+'测试中…';
    showAIConnectionResult('正在请求 AI 接口，最多等待 20 秒…','testing');
    try{
      await service.ensureConnected();
      if(aiTestController!==controller)return;
      if(!apiKey&&!state.keyPresent)throw new Error('请填写 API Key，保存后会保留在本机。');
      const result=await api('/ai/test',{endpoint,model,...(apiKey?{apiKey}:{})},'POST',controller.signal);
      if(aiTestController!==controller)return;
      const elapsed=result.latencyMs<1000?`${result.latencyMs} 毫秒`:`${(result.latencyMs/1000).toFixed(2)} 秒`;
      showAIConnectionResult(`连接成功 · ${result.model} · 耗时 ${elapsed}`,'success');
    }catch(error){if(aiTestController===controller){aiServiceError=error.code==='SERVICE_UNAVAILABLE';showAIConnectionResult(`连接失败：${error.message}`,'error');}}
    finally{if(aiTestController===controller){aiTestController=null;button.disabled=false;button.classList.remove('spinning');button.setAttribute('aria-busy','false');button.innerHTML=icon('refresh')+'测试连接';}}
  }
  function refreshFinishedCourseProgress(){
    const known=new Set(state.tasks.map(task=>task.id));
    for(const id of progressRefreshAttempts.keys())if(!known.has(id))progressRefreshAttempts.delete(id);
    for(const id of recentlyFinishedTasks)if(!known.has(id))recentlyFinishedTasks.delete(id);
    if(demo||!apiAvailable||!state.windowOpen||state.syncing||state.operation||unitsLoading||taskStarting||progressRefreshInFlight||state.tasks.some(task=>activeStatuses.has(task.status)))return;
    const finished=state.tasks.filter(task=>['completed','partial'].includes(task.status)&&state.courses.some(course=>course.id===task.courseId)&&(state.connected||recentlyFinishedTasks.has(task.id))).map(task=>({id:task.id,stamp:Number(task.updatedAt||task.logs?.at(-1)?.timestamp||task.createdAt)||0})).filter(task=>task.stamp>(state.lastSynced||0)&&progressRefreshAttempts.get(task.id)!==task.stamp);
    if(!finished.length)return;
    for(const task of finished)progressRefreshAttempts.set(task.id,task.stamp);
    progressRefreshInFlight=true;
    void syncCourses({automatic:true}).then(started=>{if(!started)for(const task of finished)if(progressRefreshAttempts.get(task.id)===task.stamp)progressRefreshAttempts.delete(task.id);}).finally(()=>{progressRefreshInFlight=false;});
  }
  async function syncCourses({automatic=false}={}) {
    try {
      await service.ensureConnected();
      if(automatic&&(demo||!state.windowOpen||state.syncing||state.operation||unitsLoading||taskStarting||state.tasks.some(task=>activeStatuses.has(task.status))))return false;
      if(!state.windowOpen&&!state.connected){if(!automatic)openDialog('#connect-dialog');return false;}
      state.syncing=true;renderCourses();renderUnits();await api('/sync',{});
      if(!automatic)toast('正在读取课程，请留意登录窗口。');return true;
    }catch(e){state.syncing=false;renderCourses();renderUnits();toast(automatic?`课程进度暂未刷新：${e.message}`:e.message);return e.status!==409;}
  }
  async function openPlatform() {
    try{toast('正在打开独立的 U校园登录窗口…');await api('/connect',{});state.windowOpen=true;renderCourses();toast('登录窗口已打开，完成登录后点击「同步课程」。');}catch(e){toast(e.message);}
  }
  function showCourse(id) {
    const index = courses().findIndex(c=>c.id===id), c = decorate(courses()[index],index);if(!c.id)return;
    $('#course-dialog-title').textContent=c.title;
    $('#course-dialog-content').innerHTML=`<div class="course-detail-cover">${coverHTML(c)}</div><div class="detail-row"><span>课程来源</span><strong>${demo?'演示数据':'U校园 · 已同步'}</strong></div>${c.group?`<div class="detail-row"><span>所属课程</span><strong>${escape(c.group.name)}</strong></div><div class="detail-row"><span>班级</span><strong>${escape(c.group.className)}</strong></div><div class="detail-row"><span>记分周期</span><strong>${escape(c.group.period)}</strong></div>`:''}<div class="detail-row"><span>课程进度</span><strong>${c.progress==null?'平台未提供':c.progress+'%'}</strong></div><div class="detail-row"><span>课程状态</span><strong>${c.requiresActivation?'待激活':c.status==='completed'?'已完成':'进行中'}</strong></div><div class="detail-row"><span>课程内容</span><strong>${escape(c.subtitle||'在 U校园窗口查看')}</strong></div><div class="detail-actions"><button class="button secondary" data-open-course="${escape(c.id)}">${icon('external')}打开课程</button><button class="button primary" data-course-start="${escape(c.id)}" ${c.requiresActivation?'disabled':''}>${icon('sparkles')}${c.requiresActivation?'待激活':'自动答题'}</button></div>${demo?'<div class="inline-note">这是用于界面演示的课程。连接后将显示你的真实课程信息。</div>':''}`;
    openDialog('#course-dialog');
  }
  function selectTaskCourse(id) {
    const course=courses().find(course=>course.id===id);if(!course||course.requiresActivation)return;
    $('#course-dialog').close();switchView('tasks');
    if(unitsLoading)return;
    $('#task-course').value=id;updateTaskCourse();
    if(!$('#load-units').disabled)void loadUnits();
    $('#start-task').focus();
  }
  function demoLog(message,level='info') { demoTask.logs.push({message,level,timestamp:Date.now()});renderTasks(); }
  function demoStep() {
    if(!demoTask||demoTask.status!=='running')return;
    const i=demoTask.answered;if(i>=sampleQuestions.length){demoTask.status='completed';demoTask.pages=1;demoLog('演示完成：3 道示例题已通过题库匹配。真实课程尚未操作。');return;}
    const q=sampleQuestions[i], result=UStudy.matchAnswer(q,UStudy.buildBankIndex(sampleBank));
    if(!result){demoTask.status='failed';demoLog('示例题未匹配成功。','error');return;}
    demoTask.answered++;demoLog(`第 ${i+1} 题 · ${result.answers.join(' / ')}。${result.explanation}`);
    demoTimer=setTimeout(demoStep,1100);
  }
  async function startTask() {
    const c=courses().find(c=>c.id===$('#task-course').value);if(!c)return;
    if(demo){clearTimeout(demoTimer);demoTask={id:'demo-'+Date.now(),courseTitle:c.title,createdAt:Date.now(),status:'running',answered:0,pages:0,logs:[],source:'题库'};demoLog('正在运行本地演示：读取示例题目，按答案原文匹配选项。');demoTimer=setTimeout(demoStep,900);return;}
    const unitId=$('#task-unit').value;
    if(unitsLoading||unitCatalog?.courseId!==c.id||unitCatalog.activeUnitId!==unitId){toast('请先读取目录并选择单元。');return;}
    if($('#start-task').disabled||taskStarting)return;taskStarting=true;$('#start-task').disabled=true;
    try{const result=await api('/tasks',{courseId:c.id,unitId});state.tasks=[result.task,...state.tasks.filter(x=>x.id!==result.task.id)];renderTasks();toast('必修任务已启动，请留意 U校园窗口。');}catch(e){toast(e.message);}finally{taskStarting=false;renderUnits();refreshFinishedCourseProgress();}
  }
  async function taskAction(action) {
    const current=tasks()[0];if(!current)return;
    if(demo){clearTimeout(demoTimer);demoTask.status=action==='stop'?'stopped':action==='pause'?'paused':'running';demoLog(action==='stop'?'演示任务已停止。':action==='pause'?'已暂停演示。':'继续演示。');if(action==='resume')demoTimer=setTimeout(demoStep,500);return;}
    try{await api(`/tasks/${encodeURIComponent(current.id)}/${action}`,{});}catch(e){toast(e.message);}
  }
  document.addEventListener('click',async e=>{
    if(shutdownRequested)return;
    const close=e.target.closest('[data-close]');if(close){close.closest('dialog')?.close();return;}
    const nav=e.target.closest('[data-view]');if(nav){switchView(nav.dataset.view);return;}
    const f=e.target.closest('[data-filter]');if(f){filter=f.dataset.filter;renderCourses();return;}
    const l=e.target.closest('[data-layout]');if(l){layout=l.dataset.layout;localStorage.setItem('ustudy-layout',layout);renderCourses();return;}
    const detail=e.target.closest('[data-course-detail]');if(detail){showCourse(detail.dataset.courseDetail);return;}
    const start=e.target.closest('[data-course-start]');if(start){selectTaskCourse(start.dataset.courseStart);return;}
    const open=e.target.closest('[data-open-course]');if(open){if(demo){toast('演示课程没有实际链接，连接 U校园后即可打开。');return;}if(open.disabled)return;open.disabled=true;try{toast('正在等待 U校园课程加载…');await api('/open-course',{courseId:open.dataset.openCourse});toast('已在独立窗口打开课程。');}catch(err){toast(err.message);}finally{open.disabled=false;}return;}
    const task=e.target.closest('[data-task-action]');if(task){if(task.disabled)return;task.disabled=true;try{await taskAction(task.dataset.taskAction);}finally{task.disabled=false;}return;}
    const actionButton=e.target.closest('[data-action]'),action=actionButton?.dataset.action;
    if(action==='shutdown'){await safeExit();return;}
    if(action==='connect')openDialog('#connect-dialog');if(action==='settings')openSettings();if(action==='help')openDialog('#help-dialog');
    if(['sync','open-platform'].includes(action)){if(actionButton.disabled)return;actionButton.disabled=true;try{if(action==='sync')await syncCourses();else await openPlatform();}finally{actionButton.disabled=false;}}
  });
  $('#demo-toggle').addEventListener('click',()=>{setDemo(!demo);$('#connect-dialog').close();toast(demo?'已切换至演示课程。':'已切换至真实课程。登录后点击同步。');});
  $('#course-search').addEventListener('input',renderCourses);$('#task-course').addEventListener('change',updateTaskCourse);$('#start-task').addEventListener('click',startTask);
  $('#load-units').addEventListener('click',()=>loadUnits());$('#task-unit').addEventListener('change',()=>loadUnits($('#task-unit').value));
  $('#ai-enabled').addEventListener('change',()=>$('#ai-fields').classList.toggle('inactive',!$('#ai-enabled').checked));
  $('#test-ai-connection').addEventListener('click',testAIConnection);
  $('#shutdown-retry').addEventListener('click',()=>{void safeExit();});
  $('#clear-manual-entries').addEventListener('click',async()=>{
    if($('#clear-manual-entries').disabled)return;
    manualEntriesClearing=true;renderServiceStatus();
    try{const result=await api('/manual-entries/clear',{});state.manualEntryCount=result.manualEntryCount;toast(`已清除 ${result.cleared} 个标记，下次运行将重新检测。`);}
    catch(error){toast(error.message);}
    finally{manualEntriesClearing=false;renderServiceStatus();}
  });
  for(const id of ['api-endpoint','api-model','api-key'])$('#'+id).addEventListener('input',resetAIConnectionTest);
  $('#settings-dialog').addEventListener('close',resetAIConnectionTest);
  $('#reconnect-service').addEventListener('click',async()=>{const button=$('#reconnect-service');button.disabled=true;button.textContent='连接中…';try{await service.ensureConnected();toast('本地服务已连接，可继续测试或保存。');}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent='重新连接';}});
  $('#bank-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>8*1024*1024)throw new Error('题库文件不能超过 8 MB。');pendingBank=UStudy.validateBank(JSON.parse(await file.text()));$('#bank-status').textContent=`已读取 ${pendingBank.length} 道题，保存后生效`;toast(`题库格式验证通过：${pendingBank.length} 道题。`);}catch(err){toast(err.message);}finally{e.target.value='';}
  });
  $('#export-bank').addEventListener('click',async()=>{
    if($('#export-bank').disabled)return;bankExporting=true;renderServiceStatus();
    try{
      const bank=await api('/bank/export'),url=URL.createObjectURL(new Blob([JSON.stringify(bank,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='u-study-question-bank.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`已导出 ${bank.length} 条完整题库记录。`);
    }catch(error){toast(error.message);}
    finally{bankExporting=false;renderServiceStatus();}
  });
  $('#settings-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=$('#settings-form button[type=submit]');if(button.disabled)return;button.disabled=true;button.textContent='保存中…';
    const s={aiEnabled:$('#ai-enabled').checked,endpoint:$('#api-endpoint').value.trim(),model:$('#api-model').value.trim(),autoSubmit:$('#auto-submit').checked,oralMode:$('#oral-mode').value,questionSelector:$('#question-selector').value.trim(),nextSelector:$('#next-selector').value.trim(),submitSelector:$('#submit-selector').value.trim()};
    try{
      if(s.aiEnabled&&(!UStudy.validateEndpoint(s.endpoint)||!s.model))throw new Error('请填写有效的 HTTPS 接口地址和模型名称。');
      const apiKey=$('#api-key').value.trim();
      const result=await api('/settings',{settings:s,...(apiKey?{apiKey}:{}),...(pendingBank?{bank:pendingBank}:{})});if(result.storageError)throw new Error(result.storageError);state={...state,...result};pendingBank=null;
      $('#api-key').value='';$('#settings-dialog').close();renderTasks();toast('答题设置已保存。');
    }catch(err){settingsServiceError=err.code==='SERVICE_UNAVAILABLE';$('#settings-error').hidden=false;$('#settings-error').textContent=err.message;}
    finally{button.disabled=false;button.textContent='保存设置';}
  });
  $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();switchView('courses');$('#course-search').focus();}});
  function acceptState(next) {
    if(shutdownRequested)return;
    const previous=state.lastSynced,previousTasks=new Map(state.tasks.map(task=>[task.id,task.status])),connectionChanged=state.connected!==next.connected||state.windowOpen!==next.windowOpen||state.syncing!==next.syncing;
    state={...state,...next};if(!state.windowOpen)recentlyFinishedTasks.clear();
    const info=next.appInfo,modified=$('#app-modified');
    $('#app-version').textContent=info?.version?`版本 v${info.version}`:'版本未知';
    modified.textContent=info?.modifiedAt||'—';if(info?.modifiedAt)modified.setAttribute('datetime',info.modifiedAt);else modified.removeAttribute('datetime');
    $('#app-build').title=info?'当前后台版本及最后修改日期':'当前后台未提供版本信息，请安全退出后重新启动。';
    for(const task of state.tasks)if(state.windowOpen&&['completed','partial'].includes(task.status)&&activeStatuses.has(previousTasks.get(task.id)))recentlyFinishedTasks.add(task.id);
    if(state.lastSynced&&state.lastSynced!==previous){setDemo(false);$('#connect-dialog').close();}else{if(connectionChanged)renderCourses();renderActivity();renderTasks();}renderServiceStatus();refreshFinishedCourseProgress();
  }
  function initialize() {
    hydrate();renderAll();
    void service.start().catch(()=>{});
  }
  window.addEventListener('pagehide',()=>{service.stop();shutdownController?.abort();clearTimeout(demoTimer);});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!shutdownRequested)void service.start().catch(()=>{});});
  for(const event of ['online','focus'])window.addEventListener(event,()=>{if(!shutdownRequested&&!service.isConnected())void service.ensureConnected().catch(()=>{});});
  initialize();
})();
