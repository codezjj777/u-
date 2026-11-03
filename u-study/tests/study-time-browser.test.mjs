import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { StudyTimeBrowser, STUDY_TIME_HOME, sharedStudyTimeBrowserAccess } from '../study-time-browser.mjs';
import { OperationManager } from '../operation-manager.mjs';
import { StudyTimeController } from '../study-time.mjs';
import { readStudyTimePageFromDOM, collectStudyTimeDirectoryFromDOM, collectStudyTimeCoursesFromDOM, studyCredit } from '../study-time-dom.mjs';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';

const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true });
const fixtureBase = 'https://ucontent.unipus.cn/offline-study-time';
const group = { name: '大学英语（三）B班', className: '离线学习测试班', period: '2026/08/03-2027/02/03' };
const course = { id: 'course-book2', title: '新标准大学英语（第三版）视听说教程2', url: STUDY_TIME_HOME, entry: { title: '新标准大学英语（第三版）视听说教程2', pageIndex: 0 }, group, status: 'completed', progress: 100, source: 'platform' };
const managementHTML = `<!doctype html><meta charset="utf-8"><section><p>课程名称：${group.name}</p><p>班级名称：${group.className}</p><p>记分周期：${group.period}</p><p>在学教程：1</p><article class="course-card" data-course-id="book2" style="padding:20px"><h3 onclick="window.open('${fixtureBase}/catalog')">${course.title}</h3><p>学习进度100%</p></article></section>`;
const directoryHTML = `<!doctype html><meta charset="utf-8"><style>button,a{display:inline-block;padding:12px}a{color:#168573}.courses-unit_taskItemContainer{padding:12px}</style>
  <div class="courses-unit_unitTabBody"><button id="id-unit1-tab" class="unipus-tabs_tabItemContainer unipus-tabs_tabActive" onclick="unit(1)"><span title="Unit 1">Unit 1</span></button><button id="id-unit2-tab" class="unipus-tabs_tabItemContainer" onclick="unit(2)"><span title="Unit 2">Unit 2</span></button></div>
  <div id="tab-unit-body-container"><div class="unipus-tabs_itemActive"><h2 class="courses-unit_unitNameLabel">Unit 1</h2><div class="ant-collapse-item"><div class="ant-collapse-header" aria-expanded="true">Learning objectives</div><div class="courses-unit_taskItemContainer"><a class="courses-unit_taskTypeName" href="${fixtureBase}/lesson?unit=1" target="_blank">Learning objectives</a><span class="courses-unit_nodePassStateTip">已完成</span></div><div class="courses-unit_taskItemContainer"><span class="courses-unit_taskTypeName">Exercise</span><span class="courses-unit_nodePassStateTip">未开始</span></div></div></div></div>
  <script>function unit(n){document.querySelectorAll('.unipus-tabs_tabItemContainer').forEach((el,i)=>el.classList.toggle('unipus-tabs_tabActive',i===n-1));document.querySelector('.courses-unit_unitNameLabel').textContent='Unit '+n;document.querySelector('a').href='${fixtureBase}/lesson?unit='+n;}</script>`;
function lessonHTML(unit = '1') {
  return `<!doctype html><meta charset="utf-8"><title>Learning objectives</title><style>body{font:16px Arial;padding:24px}.ant-modal{position:fixed;inset:20% 15%;padding:30px;background:#f1f7f5;border:1px solid #ddd;z-index:10}button{padding:10px}</style><nav class="pc-break-crumb"><span class="pc-break-crumb-text">${course.title}</span> / <span class="pc-break-crumb-text">Unit ${unit}</span> / <span class="pc-break-crumb-text">Learning objectives</span></nav><main class="pc-main-container"><h1>Learning objectives</h1><p>After completing this unit, you will be able to talk about scientific discoveries and achievements.</p><p data-study-time-stat>本单元已学时长：<span id="credited">0分钟</span></p></main><aside><textarea id="notes">侧栏笔记不属于学习正文</textarea></aside><script>
    window.resumed=0;window.setCredit=seconds=>{if(!document.querySelector('[data-fixture-frozen]'))document.getElementById('credited').textContent=seconds+'秒';};
    window.notice=(kind='idle')=>{const el=document.createElement('div');el.className='ant-modal';el.id='fixture-notice';el.setAttribute('role','dialog');el.innerHTML='<p>'+(kind==='idle'?'您已长时间未操作，系统已暂停学习计时，请点击继续学习。':kind==='unit'?'本单元学习时间：30分钟，是否必修：是。':'是否授权访问摄像头？')+'</p><button>'+(kind==='idle'?'继续学习':kind==='unit'?'我知道了':'确定')+'</button>';el.querySelector('button').onclick=()=>{if(kind==='idle')window.resumed++;el.remove();};document.body.append(el);};
  </script>`;
}
async function legacyIdle(page, { type = 'div', text = '由于你长时间未操作，请点确定继续使用。', duplicate = false, hidden = false } = {}) {
  await page.evaluate(({ type, text, duplicate, hidden }) => {
    const mask = document.createElement('div'); mask.id = 'legacy-session-mask'; mask.setAttribute('data-fixture-frozen', 'true');
    mask.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:9999'; if (hidden) mask.hidden = true;
    const panel = document.createElement('div'); panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:500px;height:300px;background:white';
    const title = document.createElement('h3'); title.textContent = '提示'; const message = document.createElement('p'); message.textContent = text;
    panel.append(title, message);
    for (let index = 0; index < (duplicate ? 2 : 1); index++) {
      const button = document.createElement(type); if (type === 'input') { button.type = 'button'; button.value = '确定'; } else { button.className = 'accept-button'; button.textContent = '确定'; }
      button.style.cssText = 'display:block;cursor:pointer;background:#299be0;color:white;width:120px;height:36px;margin:20px auto;text-align:center';
      button.onclick = () => { window.legacyConfirmed = (window.legacyConfirmed || 0) + 1; mask.remove(); }; panel.append(button);
    }
    mask.append(panel); document.body.append(mask);
  }, { type, text, duplicate, hidden });
}
async function routeFixture(route, localBase, startupNotice = false) {
  const url = route.request().url();
  if (localBase && url.startsWith(localBase + '/')) return route.continue();
  if (url === STUDY_TIME_HOME) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: managementHTML });
  if (url === fixtureBase + '/catalog') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: directoryHTML });
  if (url.startsWith(fixtureBase + '/lesson')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: lessonHTML(new URL(url).searchParams.get('unit') || '1') + (startupNotice ? '<script>window.notice("unknown")</script>' : '') });
  return route.abort();
}

test('shared-window study-time browser and dashboard', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(path.join(cache, 'study-time-browser-'));
  const store = await new Store(path.join(directory, 'answer-store'), { env: {} }).load(); store.data.courses = [structuredClone(course)]; store.connected = true;
  const originalCalls = [], errors = []; let uiContext, dashboard, startupNotice = false, launches = 0, originalHome;
  const automation = {
    context: null, store,
    pages: { records: new Map() }, taskPages: new Map(),
    ensureBrowser: async () => {
      if (automation.context) return automation.context;
      launches++;
      const context = await chromium.launchPersistentContext(path.join(store.directory, 'browser-profile'), { channel: process.env.USTUDY_TEST_BROWSER || 'msedge', headless: true, chromiumSandbox: true, timeout: 20000 });
      await context.route('**/*', route => routeFixture(route, undefined, startupNotice));
      automation.context = context; originalHome = context.pages()[0]; await originalHome.goto(STUDY_TIME_HOME);
      context.on('close', () => { automation.context = null; }); return context;
    },
    busy: () => store.data.tasks.some(task => ['running', 'paused'].includes(task.status)),
    unitsForCourse: async courseId => { originalCalls.push('units'); return { courseId, activeUnitId: 'id-unit1-tab', units: [{ id: 'id-unit1-tab', label: 'Unit 1' }], availability: 'ready', summary: { required: 1, completed: 0, pending: 1, unknown: 0 }, account: '离线测试', heading: 'Unit 1', sourceURL: fixtureBase + '/catalog', entries: [{ title: 'Exercise', path: [], required: true, requiredLabel: '必修', status: '未开始', rowText: '必修 Exercise 未开始' }] }; },
    startTask: (courseId, unitId) => { originalCalls.push('start'); const task = { id: 'independent-answer-task', courseId, courseTitle: course.title, unitId, unitLabel: 'Unit 1', status: 'running', createdAt: Date.now(), answered: 0, pages: 0, logs: [{ message: '原有答题任务运行中', timestamp: Date.now() }] }; store.data.tasks.unshift(task); store.changed({ persist: false }); return task; },
    controlTask: (id, action) => { originalCalls.push(action); const task = store.data.tasks.find(task => task.id === id); task.status = action === 'pause' ? 'paused' : 'stopped'; store.changed({ persist: false }); return task; },
  };
  automation.operations = new OperationManager(operation => { store.operation = operation; store.changed({ persist: false }); });
  const browser = new StudyTimeBrowser(path.join(directory, 'study-time'), { ...sharedStudyTimeBrowserAccess(automation), pollMs: 50 });
  const learning = new StudyTimeController({ directory: path.join(directory, 'study-time'), courses: () => store.data.courses, browser, pollMs: 1e8, gradePollMs: 50 });
  browser.onLost = () => learning.disconnected();
  const server = createApp({ store, automation, studyTime: learning, port: 0 }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await uiContext?.close(); await server.shutdown(); await automation.context?.close(); await store.flush(); assert.ok(path.resolve(directory).startsWith(cache + path.sep)); await rm(directory, { recursive: true, force: true }); });
  uiContext = await chromium.launchPersistentContext(path.join(directory, 'ui-browser'), { channel: process.env.USTUDY_TEST_BROWSER || 'msedge', headless: true, chromiumSandbox: true, viewport: { width: 1440, height: 1080 }, timeout: 20000 });
  await uiContext.route('**/*', route => routeFixture(route, base)); await uiContext.addInitScript(() => localStorage.setItem('ustudy-demo', 'false'));

  await t.test('page readers distinguish credited statistics, completed learning entries and answer controls', async () => {
    const page = await uiContext.newPage(); await page.goto(fixtureBase + '/lesson');
    let report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(report.ready, true); assert.equal(studyCredit(report.statistics).seconds, 0);
    await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>要求学习时长：999分钟</p><p>本单元学习时间：60分钟，是否必修：是</p>'));
    report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(studyCredit(report.statistics).seconds, 0);
    await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<input id="answer" value="原有草稿">'));
    report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(report.ready, false); assert.equal(report.hasAnswerControls, true); assert.equal(await page.locator('#answer').inputValue(), '原有草稿');
    await page.goto(fixtureBase + '/catalog'); report = await page.evaluate(collectStudyTimeDirectoryFromDOM);
    assert.equal(report.units.length, 2); assert.equal(report.entries[0].status, '已完成'); assert.equal(report.entries[0].preferred, true);
    await page.goto(STUDY_TIME_HOME); report = await page.evaluate(collectStudyTimeCoursesFromDOM); assert.deepEqual(report.entries[0].group, group); assert.equal(report.entries[0].sourceId, 'book2'); await page.close();
  });
  await t.test('the actual thirty-minute prompt is recognized without dialog roles, for div and input confirm controls', async () => {
    const page = await uiContext.newPage(); await page.goto(fixtureBase + '/lesson');
    for (const type of ['div', 'input']) {
      await legacyIdle(page, { type });
      const report = await page.evaluate(readStudyTimePageFromDOM);
      assert.equal(report.notices.length, 1); assert.equal(report.notices[0].kind, 'idle'); assert.equal(report.notices[0].exactSession, true); assert.equal(report.notices[0].button, '确定');
      await page.locator(report.notices[0].selector).click(); assert.equal(await page.locator('#legacy-session-mask').count(), 0);
    }
    await legacyIdle(page);
    await page.locator('#legacy-session-mask p').evaluate(el => el.replaceWith(document.createTextNode(el.textContent)));
    const unwrapped = await page.evaluate(readStudyTimePageFromDOM); assert.equal(unwrapped.notices.length, 1); assert.equal(unwrapped.notices[0].kind, 'idle');
    await page.locator(unwrapped.notices[0].selector).click();
    await legacyIdle(page, { duplicate: true });
    let report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(report.notices.length, 1); assert.equal(report.notices[0].selector, null); assert.equal(report.notices[0].ambiguous, true);
    await page.locator('#legacy-session-mask').evaluate(el => el.remove());
    await legacyIdle(page, { text: '确定提交答案吗？' });
    report = await page.evaluate(readStudyTimePageFromDOM, { noticeOnly: true, exactIdleOnly: true }); assert.equal(report.notices.length, 0); assert.equal(await page.locator('#legacy-session-mask').count(), 1);
    await page.locator('#legacy-session-mask').evaluate(el => el.remove());
    await legacyIdle(page, { hidden: true });
    report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(report.notices.length, 0);
    await page.locator('#legacy-session-mask').evaluate(el => el.remove());
    await page.locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<p>由于你长时间未操作，请点确定继续使用。</p><button>确定</button>'));
    report = await page.evaluate(readStudyTimePageFromDOM); assert.equal(report.notices.length, 0); await page.close();
  });
  await t.test('the card and sidebar open a separate workspace and leave the original answer selection untouched', async () => {
    dashboard = await uiContext.newPage(); dashboard.on('pageerror', error => errors.push(error.message)); await dashboard.goto(base);
    await dashboard.locator('[data-study-time-course-id="course-book2"]:enabled').waitFor();
    const originalSelection = await dashboard.locator('#task-course').inputValue();
    await dashboard.screenshot({ path: path.join(cache, 'study-time-cards.png'), fullPage: true });
    await dashboard.locator('[data-study-time-course-id="course-book2"]').click();
    assert.equal(await dashboard.locator('#study-time-view').isVisible(), true); assert.equal(await dashboard.locator('#tasks-view').isVisible(), false);
    assert.equal(await dashboard.locator('#study-time-course').inputValue(), course.id); assert.equal(await dashboard.locator('#task-course').inputValue(), originalSelection); assert.deepEqual(originalCalls, []);
    assert.equal(await dashboard.locator('#breadcrumb-current').innerText(), '自动学习时长');
    await dashboard.locator('[data-view="tasks"]').first().click(); assert.equal(await dashboard.locator('#study-time-view').isVisible(), false); assert.equal(await dashboard.locator('#tasks-view').isVisible(), true);
    await dashboard.locator('#study-time-nav').click(); assert.equal(await dashboard.locator('#study-time-view').isVisible(), true);
  });
  await t.test('one visible iframe is inspected through an empty parent, and parent notices and child drafts stay scoped', async () => {
    const context = await browser.ensure(), page = await context.newPage(); await page.goto(fixtureBase + '/lesson');
    await page.setContent(`<nav><span class="pc-break-crumb-text">Learning objectives</span></nav><main class="pc-main-container"><iframe src="${fixtureBase}/lesson?unit=1" style="width:800px;height:400px"></iframe></main>`);
    await page.frameLocator('iframe').locator('h1').waitFor();
    let report = await browser.inspect(page); assert.equal(report.ready, true); assert.notEqual(report.frame, page.mainFrame());
    await page.evaluate(() => { const el = document.createElement('div'); el.setAttribute('role', 'dialog'); el.innerHTML = '<p>您已长时间未操作，学习计时已暂停。</p><button>继续学习</button>'; el.querySelector('button').onclick = () => el.remove(); document.body.append(el); });
    report = await browser.inspect(page); assert.equal(report.notices.length, 1); assert.equal(report.notices[0].frame, page.mainFrame());
    browser.ownedPages.add(page);
    const recovered = await browser.dismissNotice(page, report); assert.equal(recovered.recovered, 1); assert.equal(recovered.report.ready, true);
    await page.frameLocator('iframe').locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<input id="child-draft" value="保持草稿">'));
    report = await browser.inspect(page); assert.equal(report.ready, false); assert.equal(report.hasAnswerControls, true); assert.equal(await page.frameLocator('iframe').locator('#child-draft').inputValue(), '保持草稿'); await page.close();
  });
  await t.test('startup waits through destroyed navigation contexts and resume binds the final page only after it stabilizes', async () => {
    const context = await browser.ensure(), page = await browser.newStudyPage(context), previous = browser.binding, evaluate = browser.evaluate;
    const task = { entryTitle: 'Learning objectives', unitId: 'id-unit2-tab', entryKey: 'test' };
    let reads = 0;
    await page.goto(fixtureBase + '/lesson?unit=2');
    browser.binding = { page, url: page.url(), pending: true, expectedTitle: task.entryTitle, suspended: false };
    browser.evaluate = async function (frame, reader, signal) {
      if (frame.page() === page && reader === readStudyTimePageFromDOM && ++reads === 1) {
        await page.goto(fixtureBase + '/lesson?unit=2&redirected=1');
        throw new Error('Execution context was destroyed, most likely because of a navigation.');
      }
      return evaluate.call(this, frame, reader, signal);
    };
    try {
      const loading = await browser.inspect(page);
      assert.equal(loading.ready, false); assert.equal(loading.transient, true); assert.deepEqual(loading.notices, []);
      const loaded = await browser.waitForActivity(page, task);
      assert.equal(loaded.ready, true); assert.ok(reads >= 3); assert.equal(browser.binding.pending, undefined); assert.equal(browser.binding.url, page.url());
      browser.binding = { page, url: fixtureBase + '/lesson?unit=2&old=1', pending: true, expectedTitle: task.entryTitle, suspended: false };
      await page.goto(fixtureBase + '/lesson?unit=2&final=1');
      const resumed = await browser.resume(course, task);
      assert.equal(resumed.ready, true); assert.equal(browser.binding.url, page.url());
      await page.goto(fixtureBase + '/lesson?unit=2&manual=1');
      await assert.rejects(browser.read(), /地址已变化/);
    } finally { browser.evaluate = evaluate; browser.binding = previous; await page.close(); }
  });
  await t.test('cancellation during an empty startup read stops waiting without claiming the page is ready', async () => {
    const context = await browser.ensure(), page = await browser.newStudyPage(context), readFrames = browser.readFrames, previous = browser.binding;
    await page.goto(fixtureBase + '/lesson'); const controller = new AbortController();
    browser.readFrames = async function (target, ...args) { return target === page ? [] : readFrames.call(this, target, ...args); };
    const timer = setTimeout(() => controller.abort(new Error('cancel startup')), 80);
    try { await assert.rejects(browser.waitForActivity(page, { entryTitle: 'Learning objectives', unitId: 'id-unit1-tab' }, controller.signal), error => error.name === 'AbortError' || /cancel startup/.test(error.message)); assert.equal(page.isClosed(), false); }
    finally { clearTimeout(timer); browser.readFrames = readFrames; browser.binding = previous; await page.close(); }
  });
  await t.test('late fragment initialization preserves the binding, while a real content change still requires review', async () => {
    const context = await browser.ensure(), page = await browser.newStudyPage(context), previous = browser.binding;
    const task = { entryTitle: 'Learning objectives', unitId: 'id-unit2-tab' };
    try {
      await page.goto(fixtureBase + '/lesson?unit=2'); await browser.waitForActivity(page, task);
      await page.evaluate(() => { location.hash = 'initialized'; });
      assert.equal((await browser.read()).ready, true);
      await browser.suspend(); assert.ok(page.url().startsWith('about:blank'));
      assert.equal((await browser.resume(course, task)).ready, true);
      await page.evaluate(() => { location.hash = 'different-section'; document.querySelector('h1').textContent = 'Other section'; });
      await assert.rejects(browser.read(), /学习内容已切换/);
      await page.goto(fixtureBase + '/lesson?unit=2'); await browser.waitForActivity(page, task);
      await page.evaluate(() => { location.hash = 'initialized-again'; });
      await browser.stop(); assert.equal(page.isClosed(), true);
    } finally { browser.binding = previous; await page.close(); }
  });
  await t.test('the existing logged-in window opens the selected page in its own tab without another browser or popup', async () => {
    await dashboard.locator('[data-study-time-action="window"]').click();
    await dashboard.locator('[data-study-time-action="catalog"]:enabled').waitFor(); await dashboard.locator('[data-study-time-action="catalog"]').click();
    await dashboard.locator('#study-time-unit:enabled').waitFor({ timeout: 40000 });
    await dashboard.locator('#study-time-unit').selectOption('id-unit2-tab');
    await dashboard.waitForFunction(() => document.querySelector('#study-time-entry').value.includes('id-unit2-tab') && !document.querySelector('#study-time-entry').disabled);
    assert.equal(browser.context, automation.context); assert.equal(launches, 1); assert.notEqual(browser.context, uiContext);
    await dashboard.locator('#study-time-mode').selectOption('platform-add'); await dashboard.locator('#study-time-minutes').fill('1'); await dashboard.locator('[data-study-time-action="start"]').click();
    await dashboard.locator('#study-time-status').filter({ hasText: /^学习中$/ }).waitFor({ timeout: 40000 });
    assert.equal(new URL(browser.binding.page.url()).searchParams.get('unit'), '2'); assert.equal(learning.storage.tasks[0].baselineSeconds, 0); assert.equal(store.data.tasks.length, 0);
    const anchor = await browser.context.newCDPSession(originalHome), lesson = await browser.context.newCDPSession(browser.binding.page);
    try { assert.equal((await anchor.send('Browser.getWindowForTarget')).windowId, (await lesson.send('Browser.getWindowForTarget')).windowId); } finally { await anchor.detach(); await lesson.detach(); }
    assert.equal(browser.context.pages().length, 2); assert.equal(originalHome.url(), STUDY_TIME_HOME); assert.equal(originalHome.listenerCount('dialog'), 0);
    assert.equal(await originalHome.evaluate(() => !!window.__uStudyTimeSameTab), false);
  });
  await t.test('the dwell display advances one second at a time without inventing platform credit', async () => {
    await dashboard.bringToFront();
    await dashboard.waitForFunction(() => document.visibilityState === 'visible');
    // Other cases drive tick() manually. Enable real page polls while checking
    // the visible stopwatch, as the running application does.
    const previousPollMs = learning.pollMs; learning.pollMs = 1000;
    await learning.tick(); learning.schedule();
    try {
    const minimum = Math.floor(learning.storage.tasks[0].elapsedMs / 1000);
    await dashboard.locator('#study-time-nav').click();
    await dashboard.waitForFunction(minimum => document.querySelector('#study-time-elapsed').textContent.split(':').map(Number).reduce((total, part) => total * 60 + part, 0) >= minimum, minimum);
    const samples = await dashboard.locator('#study-time-elapsed').evaluate(el => new Promise(resolve => {
      const samples = [el.textContent], observer = new MutationObserver(() => { if (samples.at(-1) !== el.textContent) samples.push(el.textContent); });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(samples); }, 2400);
    }));
    const seconds = value => value.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
    const info = await dashboard.evaluate(async () => { const state = await (await fetch('/api/study-time/state')).json(); return { hidden: document.hidden, clock: state.dwellClock, taskStatus: state.tasks[0]?.status }; });
    assert.ok(samples.length >= 3, JSON.stringify({ samples, info }));
    for (let index = 1; index < samples.length; index++) assert.equal(seconds(samples[index]) - seconds(samples[index - 1]), 1, JSON.stringify(samples));
    assert.equal(await dashboard.locator('#study-time-platform').innerText(), '00:00:00');
    await dashboard.route('**/api/study-time/state', route => route.abort());
    await dashboard.locator('#study-time-error').waitFor({ state: 'visible' });
    const frozen = await dashboard.locator('#study-time-elapsed').evaluate(el => new Promise(resolve => { const before = el.textContent; setTimeout(() => resolve([before, el.textContent]), 2100); }));
    assert.equal(frozen[0], frozen[1]); assert.equal(await dashboard.locator('#study-time-platform').innerText(), '00:00:00');
    await dashboard.unroute('**/api/study-time/state');
    await dashboard.locator('#study-time-error').waitFor({ state: 'hidden' });
    } finally { await dashboard.unroute('**/api/study-time/state'); learning.pollMs = previousPollMs; clearTimeout(learning.timer); await learning.tickPending; clearTimeout(learning.timer); }
  });
  await t.test('known inactivity notices resume normally, native alerts recover, and unknown prompts remain for review', async () => {
    const page = browser.binding.page; await page.evaluate(() => window.notice('idle')); await learning.tick();
    assert.equal(await page.evaluate(() => window.resumed), 1); assert.equal(learning.storage.tasks[0].recoveries, 1); assert.equal(await page.locator('#fixture-notice').count(), 0);
    await page.evaluate(() => window.notice('unit')); await learning.tick(); assert.equal(learning.storage.tasks[0].recoveries, 1);
    await page.evaluate(() => alert('您已长时间未操作，学习计时已停止，请继续学习。')); await learning.tick(); assert.equal(learning.storage.tasks[0].recoveries, 2);
    await page.evaluate(() => window.notice('unknown')); await learning.tick(); assert.equal(learning.storage.tasks[0].status, 'review'); assert.equal(await page.locator('#fixture-notice').isVisible(), true);
    await dashboard.locator('#study-time-status').filter({ hasText: /^待核对$/ }).waitFor(); await page.locator('#fixture-notice button').click(); await dashboard.locator('[data-study-time-action="resume"]').click();
    await dashboard.locator('#study-time-status').filter({ hasText: /^学习中$/ }).waitFor(); assert.equal(learning.storage.tasks[0].status, 'running');
  });
  await t.test('the original answer entry and controls still work while the new task runs', async () => {
    await dashboard.locator('[data-view="courses"]').first().click(); await dashboard.locator('[data-course-start="course-book2"]').click();
    await dashboard.locator('#start-task:enabled').waitFor(); await dashboard.locator('#start-task').click(); await dashboard.locator('[data-task-action="pause"]').waitFor();
    assert.equal(learning.storage.tasks[0].status, 'running'); assert.equal(store.data.tasks[0].status, 'running'); assert.deepEqual(originalCalls, ['units', 'start']);
    const pageCount = browser.context.pages().length;
    await assert.rejects(browser.loadCatalog(course, 'id-unit1-tab'), /自动答题/); assert.equal(browser.context.pages().length, pageCount); assert.equal(originalHome.url(), STUDY_TIME_HOME);
    await dashboard.locator('#study-time-nav').click(); await dashboard.locator('[data-study-time-action="pause"]').click();
    await dashboard.locator('#study-time-status').filter({ hasText: /^已暂停$/ }).waitFor(); assert.ok(browser.binding.page.url().startsWith('about:blank')); assert.equal(store.data.tasks[0].status, 'running'); assert.deepEqual(originalCalls, ['units', 'start']);
    const frozen = await dashboard.locator('#study-time-elapsed').evaluate(el => new Promise(resolve => { const before = el.textContent; setTimeout(() => resolve([before, el.textContent]), 2100); }));
    assert.equal(frozen[0], frozen[1]);
    await dashboard.locator('[data-study-time-action="resume"]').click(); await dashboard.locator('#study-time-status').filter({ hasText: /^学习中$/ }).waitFor();
    await dashboard.locator('[data-view="tasks"]').first().click(); await dashboard.locator('[data-task-action="pause"]').click();
    await dashboard.locator('#task-status-label').filter({ hasText: /已暂停/ }).waitFor(); assert.equal(learning.storage.tasks[0].status, 'running'); assert.deepEqual(originalCalls, ['units', 'start', 'pause']);
  });
  await t.test('a confirmed platform goal closes only the study page and the view fits desktop and mobile', async () => {
    const page = browser.binding.page; await page.evaluate(() => window.setCredit(60)); await learning.tick(); assert.equal(learning.storage.tasks[0].status, 'completed'); assert.equal(page.isClosed(), true); assert.equal(store.data.tasks[0].status, 'paused');
    await dashboard.locator('#study-time-nav').click(); await dashboard.locator('#study-time-status').filter({ hasText: /^已完成$/ }).waitFor();
    assert.equal(await dashboard.locator('.study-time-progress-track').getAttribute('aria-valuenow'), '100');
    await dashboard.screenshot({ path: path.join(cache, 'study-time-view.png'), fullPage: true });
    await dashboard.setViewportSize({ width: 430, height: 1000 });
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dashboard.screenshot({ path: path.join(cache, 'study-time-mobile.png'), fullPage: true }); assert.deepEqual(errors, []);
  });
  await t.test('an unknown startup prompt keeps its own page and resumes without creating another learning tab', async () => {
    automation.controlTask(store.data.tasks[0].id, 'stop');
    startupNotice = true;
    const started = await learning.start({ courseId: course.id, unitId: 'id-unit2-tab', entryKey: learning.catalog.entries[0].key, mode: 'session', targetMinutes: 60, keepAlive: true });
    await learning.preparing; startupNotice = false;
    const task = learning.storage.tasks.find(task => task.id === started.id), page = browser.binding.page, count = browser.context.pages().length;
    assert.equal(task.status, 'review'); assert.equal(await page.locator('#fixture-notice').isVisible(), true);
    await page.locator('#fixture-notice button').click(); await learning.control(task.id, 'resume'); await learning.preparing;
    assert.equal(task.status, 'running'); assert.equal(browser.binding.page, page); assert.equal(browser.context.pages().length, count);
    await learning.control(task.id, 'stop'); assert.equal(page.isClosed(), true); assert.equal(store.data.tasks[0].status, 'stopped');
  });
  await t.test('a directory initially rendered as locked waits for its real learning entries', async () => {
    await learning.loadCatalog({ courseId: course.id, unitId: 'id-unit2-tab' });
    const page = browser.catalog.page;
    await page.evaluate(() => { document.querySelectorAll('.courses-unit_nodePassStateTip').forEach(el => { el.textContent = '已锁定'; }); setTimeout(() => document.querySelectorAll('.courses-unit_nodePassStateTip').forEach(el => { el.textContent = '已完成'; }), 800); });
    const result = await learning.loadCatalog({ courseId: course.id, unitId: 'id-unit2-tab' });
    assert.equal(result.unitId, 'id-unit2-tab'); assert.ok(result.entries.some(entry => entry.title === 'Learning objectives'));
  });
  await t.test('the real prompt on both course home and learning tab is confirmed and platform seconds can increase again', async () => {
    const started = await learning.start({ courseId: course.id, unitId: learning.catalog.unitId, entryKey: learning.catalog.entries[0].key, mode: 'platform-add', targetMinutes: 60, keepAlive: true });
    await learning.preparing;
    const task = learning.storage.tasks.find(task => task.id === started.id), page = browser.binding.page;
    assert.equal(task.status, 'running');
    await page.evaluate(() => window.setCredit(1799));
    automation.pages.records.set(originalHome, { role: 'home' });
    await legacyIdle(originalHome, { type: 'input' }); await legacyIdle(page, { type: 'div' });
    await page.evaluate(() => window.setCredit(1900)); assert.equal(await page.locator('#credited').innerText(), '1799秒');
    await learning.tick();
    assert.equal(task.status, 'running'); assert.equal(task.recoveries, 2); assert.equal(await originalHome.locator('#legacy-session-mask').count(), 0); assert.equal(await page.locator('#legacy-session-mask').count(), 0);
    assert.equal(await originalHome.evaluate(() => window.legacyConfirmed), 1); assert.equal(await page.evaluate(() => window.legacyConfirmed), 1);
    await page.evaluate(() => window.setCredit(1801)); await new Promise(resolve => setTimeout(resolve, 60)); await learning.tick();
    assert.equal(task.platformSeconds, 1801); assert.equal(task.status, 'running'); assert.equal(originalHome.listenerCount('dialog'), 0); assert.equal(originalHome.url(), STUDY_TIME_HOME);
    await legacyIdle(originalHome, { text: '确定提交答案吗？' }); await learning.tick(); assert.equal(await originalHome.locator('#legacy-session-mask').count(), 1);
    await originalHome.locator('#legacy-session-mask').evaluate(el => el.remove());
    await legacyIdle(originalHome); automation.taskPages.set('protected-home-test', originalHome);
    assert.equal(await browser.recoverSessionNotice(), 0); assert.equal(await originalHome.locator('#legacy-session-mask').count(), 1);
    automation.taskPages.delete('protected-home-test'); await originalHome.locator('#legacy-session-mask').evaluate(el => el.remove());
    await learning.control(task.id, 'stop'); assert.equal(page.isClosed(), true); assert.equal(originalHome.isClosed(), false);
    await learning.loadCatalog({ courseId: course.id, unitId: 'id-unit2-tab' });
  });
  await t.test('closing study-time releases only its tabs and retains the original browser, login and answer draft', async () => {
    const context = automation.context, answerPage = await context.newPage(); await answerPage.goto(fixtureBase + '/lesson');
    await answerPage.locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<textarea id="existing-answer">保留答题草稿</textarea>'));
    const adopted = browser.catalog.page; automation.pages.records.set(adopted, { role: 'lesson' }); automation.taskPages.set('answer-adopted', adopted);
    await adopted.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<textarea id="adopted-draft">已被答题接管的草稿</textarea>'));
    await assert.rejects(browser.navigate(adopted, fixtureBase + '/lesson'), /自动答题接管/);
    await context.addCookies([{ name: 'shared-login', value: 'offline-test-only', url: 'https://ucloud.unipus.cn' }]);
    await learning.close(); assert.equal(originalHome.isClosed(), false); assert.equal(answerPage.isClosed(), false); assert.equal(automation.context, context);
    assert.equal(await answerPage.locator('#existing-answer').inputValue(), '保留答题草稿'); assert.ok((await context.cookies()).some(cookie => cookie.name === 'shared-login'));
    assert.equal(adopted.isClosed(), false); assert.equal(await adopted.locator('#adopted-draft').inputValue(), '已被答题接管的草稿');
    assert.equal(browser.ownedPages.size, 0); assert.equal(launches, 1); await answerPage.close(); await adopted.close();
  });
});
