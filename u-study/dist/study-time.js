/* Independent navigation, card entry and view. The answer application's
 * closure, events, transport, settings and task state are never patched. */
(() => {
  'use strict';
  const main = document.querySelector('#main-content'), navigation = document.querySelector('.sidebar nav');
  if (!main || !navigation || document.querySelector('#study-time-view')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const clockIcon = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>');
  const playIcon = svg('<path d="m9 5 10 7-10 7V5Z"/>');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const format = seconds => { const value = Math.max(0, Math.floor(seconds || 0)); return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(part => String(part).padStart(2, '0')).join(':'); };
  const statusNames = { waiting: '正在准备', running: '学习中', paused: '已暂停', review: '待核对', interrupted: '等待继续', stopped: '已停止', completed: '已完成', failed: '未能启动' };
  const live = new Set(['waiting', 'running', 'paused', 'review', 'interrupted']);
  let state = { courses: [], tasks: [], catalog: null, operation: '', windowOpen: false }, catalog = null, visible = false, busy = false, online = false, polling = false;
  let courseKey = '', unitKey = '', entryKey = '', historyKey = '', logTaskId = '', logKey = '', controlKey = '', timer = null, errorMessage = '';
  let progressBusy = '', progressKey = '';
  let dwellAnchor = null, lastDwell = null, dwellTimer = null;
  let shutdownRequested = false;
  const lifetime = new AbortController();
  const progressAttempts = new Map(), progressErrors = new Map();
  const termSummary = document.createElement('section'); termSummary.className = 'study-time-term-summary'; termSummary.setAttribute('aria-label', '学期学习时长'); termSummary.hidden = true;
  const courseToolbar = document.querySelector('#courses-view .section-toolbar'); courseToolbar?.before(termSummary);
  const nav = document.createElement('button');
  nav.type = 'button'; nav.id = 'study-time-nav'; nav.className = 'nav-item'; nav.setAttribute('data-study-time-nav', ''); nav.setAttribute('aria-controls', 'study-time-view'); nav.title = '自动学习时长';
  nav.innerHTML = `${clockIcon}自动学习时长<span class="nav-dot" id="study-time-dot" hidden></span>`; navigation.append(nav);
  const view = document.createElement('section'); view.id = 'study-time-view'; view.className = 'view study-time-view'; view.hidden = true;
  view.innerHTML = `<div class="page-heading"><div><div class="eyebrow">MAKE TIME FOR LEARNING</div><h1>自动学习时长<span class="heading-dot">.</span></h1><p>选好课程与目标，让学习时间有序积累。</p></div><button type="button" class="button secondary" data-study-time-action="window">${clockIcon}显示 U校园窗口</button></div>
    <div class="study-time-error" id="study-time-error" role="alert" hidden></div>
    <div class="study-time-notice"><span>${clockIcon}</span><p>共用已登录的 U校园窗口，无需再次登录。关闭工作台后任务仍会运行。</p><span id="study-time-connection">正在连接…</span></div>
    <div class="study-time-workspace"><section class="panel study-time-config"><div class="panel-title"><h2>新建学习任务</h2><span class="subtle-tag">课程与目标</span></div>
      <label class="field-label" for="study-time-course">选择课程</label><select id="study-time-course"><option value="">正在读取课程…</option></select><p class="form-hint" id="study-time-course-hint">可选择已经完成的课程。</p>
      <div class="study-time-field-heading"><label class="field-label" for="study-time-unit">选择单元</label><button type="button" class="text-button" data-study-time-action="catalog">读取单元</button></div><select id="study-time-unit" disabled><option value="">请先读取单元</option></select>
      <label class="field-label" for="study-time-entry">学习页面</label><select id="study-time-entry" disabled><option value="">优先选择 Learning objectives</option></select>
      <label class="field-label" for="study-time-mode">目标方式</label><select id="study-time-mode"><option value="session">本次驻留</option><option value="platform-add">平台新增时长</option><option value="platform-total">平台累计时长</option></select>
      <label class="field-label" for="study-time-minutes">目标时长</label><div class="study-time-number"><input id="study-time-minutes" type="number" min="1" max="1440" step="1" value="60" inputmode="numeric"><span>分钟</span></div>
      <p class="form-hint" id="study-time-mode-hint">累计页面正常驻留时间；平台实际记录以 U校园为准。</p>
      <label class="study-time-toggle"><input id="study-time-keepalive" type="checkbox" checked><span><strong>定期保持页面活动</strong><small>约 20 分钟一次，并持续检测超时提示。</small></span></label>
      <button type="button" class="button primary full-width" data-study-time-action="start">${playIcon}开始自动学习</button><p class="form-hint" id="study-time-config-hint">读取单元后，选择学习页面即可开始。</p>
    </section><section class="panel study-time-live"><div class="panel-title"><h2>学习进度</h2><span class="subtle-tag" id="study-time-status">等待开始</span></div>
      <div id="study-time-idle" class="study-time-idle"><span>${clockIcon}</span><h3>给学习留一点时间</h3><p>选择课程和目标，<br>这里会显示本次学习进度。</p></div>
      <div id="study-time-progress" hidden><p id="study-time-current" class="study-time-current"></p><div class="study-time-stats"><div><strong id="study-time-elapsed">00:00:00</strong><small>本次驻留</small></div><div><strong id="study-time-platform">—</strong><small>平台确认新增</small></div><div><strong id="study-time-target">60 分钟</strong><small id="study-time-target-label">驻留目标</small></div></div>
        <div class="study-time-progress-track" role="progressbar" aria-label="学习目标进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="study-time-progress-bar"></span></div><p class="form-hint" id="study-time-credit-note"></p>
        <div class="study-time-log" id="study-time-log" role="log" aria-label="学习时长日志" tabindex="0"></div><div class="study-time-controls" id="study-time-controls"></div>
      </div>
    </section></div>
    <section class="panel study-time-history"><div class="panel-title"><h2>学习记录</h2><span>保存在本机</span></div><div id="study-time-history-list"><p class="study-time-empty">开始一次学习后，记录会出现在这里。</p></div></section>`;
  main.insertBefore(view, main.querySelector('.page-footer'));
  const $ = selector => view.querySelector(selector);
  const setText = (selector, value) => { const el = $(selector); if (el.textContent !== String(value)) el.textContent = value; };
  const showError = message => { errorMessage = message || ''; $('#study-time-error').hidden = !errorMessage; setText('#study-time-error', errorMessage); };
  function show(courseId) {
    visible = true;
    for (const section of [document.querySelector('#courses-view'), document.querySelector('#tasks-view')]) if (section) section.hidden = true;
    document.querySelectorAll('.sidebar nav [data-view]').forEach(button => button.classList.remove('active'));
    nav.classList.add('active'); view.hidden = false;
    const breadcrumb = document.querySelector('#breadcrumb-current'); if (breadcrumb) breadcrumb.textContent = '自动学习时长';
    document.title = 'U Study · 自动学习时长';
    if (courseId) {
      $('#study-time-course').value = courseId;
      if (catalog?.courseId !== courseId) catalog = null;
      render();
    }
    void refresh().then(() => { if (courseId && state.courses.some(course => course.id === courseId)) { $('#study-time-course').value = courseId; render(); } });
  }
  function hide() { visible = false; view.hidden = true; nav.classList.remove('active'); }
  function mountCards() {
    const known = new Map(state.courses.map(course => [course.id, course]));
    document.querySelectorAll('#course-grid [data-course-start]').forEach(original => {
      const actions = original.parentElement; if (!actions) return;
      let button = actions.querySelector('[data-study-time-course-id]');
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary study-time-card-button';
        button.innerHTML = `${clockIcon}<span>自动学习时长</span>`;
        button.setAttribute('data-study-time-course-id', original.getAttribute('data-course-start')); original.after(button);
        actions.setAttribute('data-study-time-actions', '');
      }
      const course = known.get(button.getAttribute('data-study-time-course-id'));
      button.disabled = !course || !!course.requiresActivation;
      button.title = course ? '打开此课程的学习时长功能' : '连接并同步真实课程后使用';
      const card = original.closest('.course-card'), anchor = card?.querySelector('.course-progress');
      if (anchor) {
        let progress = card.querySelector('[data-study-time-card-progress]');
        if (!progress) { progress = document.createElement('div'); progress.className = 'study-time-card-progress'; progress.setAttribute('data-study-time-card-progress', original.getAttribute('data-course-start')); anchor.after(progress); }
        const id = original.getAttribute('data-course-start'), saved = state.progress?.byCourse?.[id], group = state.progress?.groups?.find(group => group.courseIds.includes(id));
        const reading = !!progressBusy && group?.courseIds.includes(progressBusy) || state.operation === '读取学习时长' && group?.courseIds.includes(progressBusy);
        const error = progressErrors.get(group?.key), percent = saved?.percent;
        const signature = JSON.stringify([saved, reading, error, online, !!course, course?.requiresActivation, progressBusy, state.operation]);
        if (progress.dataset.renderKey !== signature) {
          progress.dataset.renderKey = signature;
          progress.innerHTML = `<div class="progress-label"><span>学习时长进度</span><strong>${percent == null ? saved ? '未提供' : '待读取' : `${escape(percent)}%`}</strong></div><div class="progress-track" ${percent == null ? '' : `role="progressbar" aria-label="学习时长进度（平台百分制得分）" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escape(percent)}"`}><span style="width:${Number(percent) || 0}%"></span></div><div class="study-time-card-credit"><span title="${saved ? `平台必修学习时长，更新于 ${new Date(saved.checkedAt).toLocaleString('zh-CN')}；进度采用平台百分制得分。` : error ? escape(error) : '从综合成绩的必修学习时长详情读取'}">${saved ? `已学 ${format(saved.seconds)}` : reading ? '正在读取平台时长…' : course?.requiresActivation ? '激活后读取' : error ? '暂未读到，点击重试' : '待读取平台时长'}</span><button type="button" class="text-button" data-study-time-progress-course-id="${escape(id)}" ${!online || !course || course.requiresActivation || progressBusy || state.operation ? 'disabled' : ''}>${reading ? '读取中…' : saved ? '刷新' : '读取'}</button></div>`;
        }
      }
    });
    renderTermSummary();
  }
  function renderTermSummary() {
    const groups = state.progress?.groups?.filter(group => group.current) || [];
    const key = JSON.stringify([groups, progressBusy, [...progressErrors], online, state.operation]);
    termSummary.hidden = !groups.length || !document.querySelector('#course-grid [data-study-time-course-id]:enabled');
    if (progressKey === key) return; progressKey = key;
    termSummary.innerHTML = groups.map(group => {
      const report = group.report, reading = group.courseIds.includes(progressBusy);
      return `<div class="study-time-term-row"><span class="study-time-term-icon">${clockIcon}</span><div><strong>本学期学习时长 <b>${report ? format(report.totalSeconds) : '待读取'}</b></strong><small>${escape(group.group?.name || '')} · ${report ? report.books.length : group.courseIds.length} 本教材${report ? ` · 更新于 ${escape(new Date(report.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))}` : ''}</small>${progressErrors.has(group.key) ? `<small class="study-time-progress-error" role="status">${escape(progressErrors.get(group.key))}</small>` : ''}</div><button type="button" class="text-button" data-study-time-progress-course-id="${escape(group.courseId)}" ${!online || progressBusy || state.operation ? 'disabled' : ''}>${reading ? '读取中…' : '刷新学习时长'}</button></div>`;
    }).join('');
  }
  async function refreshProgress(courseId, automatic = false) {
    if (progressBusy || state.operation || !online) return;
    const group = state.progress?.groups?.find(group => group.courseIds.includes(courseId));
    if (!group) return;
    progressBusy = courseId; progressAttempts.set(group.key, Date.now()); progressErrors.delete(group.key); mountCards();
    try {
      const progress = await request('/progress', { courseId }); state.progress = progress;
    } catch (error) {
      // Active answer operations retain their browser lease; retry when idle.
      if (!automatic || error.status !== 409) progressErrors.set(group.key, error.message);
      if (automatic && error.status === 409) progressAttempts.set(group.key, Date.now() - 4 * 60000);
    } finally { progressBusy = ''; mountCards(); }
  }
  function refreshProgressWhenIdle() {
    if (progressBusy || busy || state.operation || state.tasks.some(task => live.has(task.status)) || !state.progressAvailable || document.hidden || document.querySelector('#courses-view')?.hidden || !document.querySelector('#course-grid [data-study-time-course-id]:enabled')) return;
    const now = Date.now(), group = state.progress?.groups?.find(group => group.current && now - (group.report?.checkedAt || 0) >= 5 * 60000 && now - (progressAttempts.get(group.key) || 0) >= 5 * 60000);
    if (group) void refreshProgress(group.courseId, true);
  }
  function render() {
    const task = state.tasks[0], active = state.tasks.find(task => live.has(task.status)), locked = busy || !!active || !!state.operation;
    const courses = state.courses, key = JSON.stringify(courses);
    if (key !== courseKey) {
      const previous = $('#study-time-course').value || active?.courseId;
      $('#study-time-course').innerHTML = courses.length ? courses.map(course => `<option value="${escape(course.id)}" ${course.requiresActivation ? 'disabled' : ''}>${escape(course.label)}${course.requiresActivation ? ' · 待激活' : ''}</option>`).join('') : '<option value="">请先同步真实课程</option>';
      if (courses.some(course => course.id === previous)) $('#study-time-course').value = previous;
      courseKey = key;
    }
    const selected = $('#study-time-course').value;
    if (state.catalog?.courseId === selected && !catalog) catalog = state.catalog;
    const matching = catalog?.courseId === selected ? catalog : null;
    const nextUnitKey = JSON.stringify(matching?.units || []);
    if (unitKey !== nextUnitKey) {
      $('#study-time-unit').innerHTML = matching?.units.length ? matching.units.map(unit => `<option value="${escape(unit.id)}">${escape(unit.label)}</option>`).join('') : '<option value="">请先读取单元</option>';
      if (matching) $('#study-time-unit').value = matching.unitId; unitKey = nextUnitKey;
    }
    const entries = matching && matching.unitId === $('#study-time-unit').value ? matching.entries : [];
    const nextEntryKey = JSON.stringify(entries);
    if (entryKey !== nextEntryKey) {
      const previous = $('#study-time-entry').value;
      $('#study-time-entry').innerHTML = entries.length ? entries.map(entry => `<option value="${escape(entry.key)}">${escape([...entry.path, entry.title].filter((name, index, all) => !index || name !== all[index - 1]).join(' / '))}</option>`).join('') : '<option value="">优先选择 Learning objectives</option>';
      $('#study-time-entry').value = entries.find(entry => entry.key === previous)?.key || entries.find(entry => entry.preferred)?.key || entries[0]?.key || ''; entryKey = nextEntryKey;
    }
    $('#study-time-course').disabled = locked; $('#study-time-unit').disabled = locked || !matching?.units.length; $('#study-time-entry').disabled = locked || !entries.length;
    for (const selector of ['#study-time-mode', '#study-time-minutes', '#study-time-keepalive']) $(selector).disabled = locked;
    $('[data-study-time-action="catalog"]').disabled = locked || !online || !selected;
    $('[data-study-time-action="start"]').disabled = locked || !online || !entries.length;
    $('[data-study-time-action="window"]').disabled = busy || !!state.operation;
    setText('#study-time-config-hint', state.operation ? `正在${state.operation}…` : active ? '已有学习任务，可在右侧暂停、继续或停止。' : !courses.length ? '请先在「我的课程」同步课程，再开始学习。' : '读取单元后，选择学习页面即可开始。');
    setText('#study-time-course-hint', courses.find(course => course.id === selected)?.label || '可选择已经完成的课程。');
    setText('#study-time-connection', online ? state.windowOpen ? 'U校园窗口已打开' : '学习服务已连接' : '学习服务未连接');
    document.querySelector('#study-time-dot').hidden = !active;
    setText('#study-time-mode-hint', $('#study-time-mode').value === 'session' ? '累计页面正常驻留时间；平台实际记录以 U校园为准。' : '每 2 分钟核对一次平台已学时长，精确到秒；学习页未显示时长时，从综合成绩读取本教材的必修学习时长。');
    $('#study-time-idle').hidden = !!task; $('#study-time-progress').hidden = !task; setText('#study-time-status', statusNames[task?.status] || '等待开始');
    if (task) renderTask(task);
    const nextHistory = JSON.stringify(state.tasks.map(task => [task.id, task.status, Math.floor(task.elapsedMs / 60000)]));
    if (nextHistory !== historyKey) {
      $('#study-time-history-list').innerHTML = state.tasks.length ? state.tasks.map(task => `<div class="study-time-history-row"><span class="study-time-history-icon">${clockIcon}</span><div><strong>${escape(task.courseTitle)}</strong><small>${escape(new Date(task.createdAt).toLocaleString('zh-CN'))} · ${escape(task.unitLabel)}</small></div><span>${Math.floor(task.elapsedMs / 60000)} 分钟驻留</span><span class="subtle-tag">${escape(statusNames[task.status])}</span></div>`).join('') : '<p class="study-time-empty">开始一次学习后，记录会出现在这里。</p>';
      historyKey = nextHistory;
    }
    if (state.storageError) showError(state.storageError);
    mountCards();
  }
  function anchorDwell() {
    const clock = state.dwellClock;
    dwellAnchor = clock ? { ...clock, receivedAt: performance.now(), receivedWall: Date.now() } : null;
  }
  function elapsedForDisplay(task) {
    let value = task.elapsedMs;
    const anchor = dwellAnchor, previous = lastDwell;
    if (task.status === 'running' && (!online || !anchor) && previous?.id === task.id) return Math.max(task.elapsedMs, previous.value);
    if (task.status === 'running' && online && anchor?.taskId === task.id && anchor.ticking && !document.hidden) {
      const elapsed = performance.now() - anchor.receivedAt, wallElapsed = Date.now() - anchor.receivedWall;
      const age = anchor.serverNow - anchor.sampledAt;
      if (elapsed >= 0 && wallElapsed >= 0 && Math.abs(elapsed - wallElapsed) <= 2000) {
        value += Math.max(0, Math.min(anchor.maxAheadMs, age + elapsed));
        if (previous?.id === task.id && previous.interruptedMs === anchor.interruptedMs) value = Math.max(value, previous.value);
      }
      if (task.mode === 'session') value = Math.min(value, task.targetMinutes * 60000);
    }
    lastDwell = { id: task.id, value, interruptedMs: anchor?.interruptedMs };
    return value;
  }
  function renderDwell(task) {
    const elapsedMs = elapsedForDisplay(task);
    setText('#study-time-elapsed', format(elapsedMs / 1000));
    if (task.mode === 'session') {
      const percent = Math.min(100, Math.max(0, Math.floor(elapsedMs / (task.targetMinutes * 60000) * 100)));
      $('#study-time-progress-bar').style.width = `${percent}%`; $('.study-time-progress-track').setAttribute('aria-valuenow', String(percent));
    }
  }
  function startDwellDisplay() {
    clearInterval(dwellTimer);
    if (shutdownRequested) return;
    dwellTimer = setInterval(() => { if (visible && !document.hidden && state.tasks[0]) renderDwell(state.tasks[0]); }, 100);
  }
  function renderTask(task) {
    setText('#study-time-current', `${task.courseTitle} / ${task.unitLabel} / ${task.entryTitle}`);
    const increase = task.platformSeconds === null || task.baselineSeconds === null ? null : Math.max(0, task.platformSeconds - task.baselineSeconds);
    setText('#study-time-platform', increase === null ? '—' : format(increase)); setText('#study-time-target', `${task.targetMinutes} 分钟`);
    setText('#study-time-target-label', { session: '驻留目标', 'platform-add': '平台新增目标', 'platform-total': '平台累计目标' }[task.mode]);
    const value = task.mode === 'session' ? task.elapsedMs / 1000 : task.mode === 'platform-total' ? task.platformSeconds || 0 : increase || 0;
    const percent = Math.min(100, Math.max(0, Math.floor(value / (task.targetMinutes * 60) * 100)));
    $('#study-time-progress-bar').style.width = `${percent}%`; $('.study-time-progress-track').setAttribute('aria-valuenow', String(percent));
    renderDwell(task);
    setText('#study-time-credit-note', task.platformSeconds === null ? `${task.mode === 'session' ? '以上为本机驻留时间。' : '正在等待平台确认时长。'}${task.creditNote || '平台实际记录以 U校园为准。'}` : `${task.creditSource === 'grades' ? '综合成绩 · 本教材必修时长' : task.creditLabel || '平台当前累计'} ${format(task.platformSeconds)} · 每 2 分钟核对 · 最近核对 ${new Date(task.platformCheckedAt).toLocaleTimeString('zh-CN')}${task.recoveries ? ` · 已恢复超时提示 ${task.recoveries} 次` : ''}${task.creditNote ? ` · ${task.creditNote}` : ''}`);
    const nextControlKey = JSON.stringify([task.id, task.status, busy]);
    if (nextControlKey !== controlKey) {
      $('#study-time-controls').innerHTML = `${task.status === 'running' ? '<button type="button" class="button secondary" data-study-time-action="pause">暂停</button>' : ''}${['paused', 'review', 'interrupted'].includes(task.status) ? '<button type="button" class="button primary" data-study-time-action="resume">继续学习</button>' : ''}${live.has(task.status) ? '<button type="button" class="button secondary" data-study-time-action="stop">停止</button>' : ''}<span>${escape(statusNames[task.status])}</span>`;
      $('#study-time-controls').querySelectorAll('button').forEach(button => { button.disabled = busy; }); controlKey = nextControlKey;
    }
    const nextLogKey = JSON.stringify(task.logs);
    if (nextLogKey !== logKey || task.id !== logTaskId) {
      const box = $('#study-time-log'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      box.innerHTML = task.logs.map(log => `<p data-level="${escape(log.level)}"><time>${escape(new Date(log.timestamp).toLocaleTimeString('zh-CN'))}</time><span>${escape(log.message)}</span></p>`).join('');
      if (atEnd || task.id !== logTaskId) box.scrollTop = box.scrollHeight; logKey = nextLogKey; logTaskId = task.id;
    }
  }
  async function request(route, data) {
    if (shutdownRequested) throw new DOMException('程序正在安全退出。', 'AbortError');
    const response = await UStudyService.fetchLocal(`/study-time${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-UStudy': '1' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(data === undefined ? 5000 : 65000)]) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(route === '/state' && [404, 405].includes(response.status) ? '当前后台尚未加载学习功能，请在答题任务结束后停止并重新启动程序。' : result.error || '学习时长操作未完成。'), { status: response.status });
    return result;
  }
  async function refresh() {
    if (shutdownRequested) return;
    if (polling) return; polling = true;
    try { state = await request('/state'); anchorDwell(); if (!online) showError(''); online = true; render(); refreshProgressWhenIdle(); }
    catch (error) { online = false; if (visible) showError(error.message || '学习服务连接中断，正在重连。'); render(); }
    finally { polling = false; }
  }
  async function poll() {
    if (shutdownRequested) return;
    await refresh(); clearTimeout(timer);
    if (!shutdownRequested) timer = setTimeout(poll, visible || state.tasks.some(task => live.has(task.status)) ? 1500 : 10000);
  }
  async function action(name) {
    if (shutdownRequested) return;
    if (busy) return; busy = true; showError(''); render();
    try {
      if (name === 'window') await request('/window', {});
      else if (name === 'catalog') { catalog = await request('/catalog', { courseId: $('#study-time-course').value, ...($('#study-time-unit').value ? { unitId: $('#study-time-unit').value } : {}) }); unitKey = ''; render(); }
      else if (name === 'start') {
        const targetMinutes = Number($('#study-time-minutes').value);
        if (!Number.isInteger(targetMinutes) || targetMinutes < 1 || targetMinutes > 1440) throw new Error('目标时长请填写 1～1440 之间的整数分钟。');
        await request('/tasks', { courseId: $('#study-time-course').value, unitId: $('#study-time-unit').value, entryKey: $('#study-time-entry').value, targetMinutes, mode: $('#study-time-mode').value, keepAlive: $('#study-time-keepalive').checked });
      } else if (['pause', 'resume', 'stop'].includes(name)) {
        const task = state.tasks.find(task => live.has(task.status)); if (task) await request(`/tasks/${encodeURIComponent(task.id)}/${name}`, {});
      }
      await refresh();
    } catch (error) { showError(error.message || '学习操作未完成，请重试。'); }
    finally { busy = false; render(); }
  }
  document.addEventListener('click', event => {
    if (shutdownRequested) return;
    const progressButton = event.target.closest('[data-study-time-progress-course-id]');
    if (progressButton && !progressButton.disabled) { void refreshProgress(progressButton.getAttribute('data-study-time-progress-course-id')); return; }
    const entry = event.target.closest('[data-study-time-nav],[data-study-time-course-id]');
    if (entry && !entry.disabled) { show(entry.getAttribute('data-study-time-course-id')); return; }
    if (visible && event.target.closest('[data-view],[data-course-start]')) hide();
    const button = event.target.closest('[data-study-time-action]');
    if (button && view.contains(button) && !button.disabled) void action(button.getAttribute('data-study-time-action'));
  });
  $('#study-time-course').addEventListener('change', () => { catalog = null; unitKey = ''; entryKey = ''; render(); });
  $('#study-time-unit').addEventListener('change', () => { entryKey = ''; void action('catalog'); });
  $('#study-time-mode').addEventListener('change', render);
  // Observe rendered cards and visibility only; leave the original event path
  // intact when a user returns to courses or auto-answer.
  const grid = document.querySelector('#course-grid');
  if (grid) new MutationObserver(mountCards).observe(grid, { childList: true, subtree: false });
  const visibility = new MutationObserver(() => { if (visible && [document.querySelector('#courses-view'), document.querySelector('#tasks-view')].some(section => section && !section.hidden)) hide(); });
  for (const section of [document.querySelector('#courses-view'), document.querySelector('#tasks-view')]) if (section) visibility.observe(section, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { dwellAnchor = null; void refresh(); } });
  window.addEventListener('pagehide', () => { clearInterval(dwellTimer); clearTimeout(timer); });
  window.addEventListener('ustudy-shutdown', () => { shutdownRequested = true; clearInterval(dwellTimer); clearTimeout(timer); lifetime.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted && !shutdownRequested) { dwellAnchor = null; startDwellDisplay(); void poll(); } });
  mountCards(); startDwellDisplay(); void poll();
})();
