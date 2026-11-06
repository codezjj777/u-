import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';
import {accessToken,authorizedDashboard} from './fixtures/local-access.mjs';
import { OperationManager } from '../operation-manager.mjs';
import { StudyTimeController } from '../study-time.mjs';
import { StudyTimeBrowser, STUDY_TIME_HOME, sharedStudyTimeBrowserAccess } from '../study-time-browser.mjs';
import { readStudyTimeGradesFromDOM, normalizeStudyTimeGrades } from '../study-time-grades.mjs';

const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true });
const group = { name: '大学英语（三）B班', className: '离线学习测试班', period: '2026/08/03-2027/02/03' };
const titles = ['视听说教程2', '视听说教程3', '综合教程2', '综合教程3'].map(title => `新标准大学英语（第三版）${title}`);
const courses = titles.map((title, index) => ({ id: `course-book${index}`, title, url: STUDY_TIME_HOME, group, entry: { title, pageIndex: 0 }, status: 'completed', progress: 100, source: 'platform' }));
const prior = { ...courses[0], id: 'course-old', group: { ...group, period: '2026/02/27-2026/08/27' } };
const baseURL = 'https://ucloud.unipus.cn', resourceURL = `${baseURL}/app/cmgt/resource-detail/grade-current`;
const management = `<!doctype html><meta charset="utf-8"><section><p>课程名称：${group.name}</p><p>班级名称：${group.className}</p><p>记分周期：${group.period}</p><p>在学教程：4</p>${courses.map((course, index) => `<article class="course-card" data-course-id="book${index}"><h3 onclick="window.open('${resourceURL}')">${course.title}</h3></article>`).join('')}</section>`;
let additionalSeconds = 0;
const clock = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
const bookRows = () => titles.map((title, index) => `<tr><td><span title="${title}" style="display:inline-block;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span></td><td>${clock([12257 + additionalSeconds, 9978, 28504, 2880][index])}</td><td>${[22.6, 27.7, 52.7, 8][index]}</td><td>${[30, 20, 30, 20][index]}%</td></tr>`).join('');
const learningDirectory = `<div class="courses-unit_unitTabBody"><button id="id-unit1-tab" class="unipus-tabs_tabItemContainer unipus-tabs_tabActive"><span title="Unit 1">Unit 1</span></button></div><div id="tab-unit-body-container"><div class="unipus-tabs_itemActive"><h2 class="courses-unit_unitNameLabel">Unit 1</h2><div class="ant-collapse-item"><div class="ant-collapse-header" aria-expanded="true">Learning objectives</div><div class="courses-unit_taskItemContainer"><a class="courses-unit_taskTypeName" href="${baseURL}/fixture/lesson" target="_blank">Learning objectives</a><span class="courses-unit_nodePassStateTip">已完成</span></div></div></div></div>`;
const learningHTML = `<!doctype html><meta charset="utf-8"><title>Learning objectives</title><nav><span class="pc-break-crumb-text">${titles[0]}</span> / <span class="pc-break-crumb-text">Unit 1</span> / <span class="pc-break-crumb-text">Learning objectives</span></nav><main class="pc-main-container"><h1>Learning objectives</h1><p>Learning content without any on-page time statistic.</p></main>`;
function gradeHTML(mode = 'normal') {
  return `<!doctype html><meta charset="utf-8"><style>button{padding:12px}td,th{padding:12px}.ant-modal{background:white;position:fixed;inset:10%;border:1px solid #ddd}</style><nav><button onclick="showGrades()">综合成绩</button><button>教程学习</button></nav>${learningDirectory}<main id="grades"></main><script>
  function showGrades(){fetch('/fixture/tab');document.querySelector('#grades').innerHTML=${JSON.stringify(mode === 'loading' ? '<p>成绩加载中</p>' : `<table><thead><tr><th>考核项</th><th>权重占比</th><th>完成情况</th><th>得分</th><th>操作</th></tr></thead><tbody><tr><td>必修学习时长</td><td>50%</td><td>${clock(53619 + additionalSeconds)}</td><td>14.8</td><td><button onclick="details()">查看详情</button></td></tr><tr><td>教程学习成绩</td><td>50%</td><td>204/204 任务点</td><td>41.7</td><td><button onclick="fetch('/fixture/wrong-detail')">查看详情</button></td></tr></tbody></table>`)};}
  function details(){fetch('/fixture/detail');const el=document.createElement('div');el.className='ant-modal';el.setAttribute('role','dialog');el.innerHTML=${JSON.stringify(`<h2>必修学习时长</h2><table><thead><tr><th>教程名称</th><th>必修学习时长</th><th>百分制得分</th><th>权重占比</th></tr></thead><tbody>${mode === 'partial' ? bookRows().replace(/<tr><td><span title="[^\"]*综合教程3[\s\S]*$/, '') : bookRows()}</tbody></table><p>共4条数据</p><button>确认</button>`)};document.body.append(el);}
  </script>`;
}

test('semester study-time progress in the existing window', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(path.join(cache, 'study-grades-browser-'));
  const store = await new Store(path.join(directory, 'answer-store'), { env: {} }).load(); store.data.courses = [...courses, prior]; store.connected = true;
  let context, uiContext, original, answer, lesson, dashboard, mode = 'normal', answerBusy = true, launches = 0, wall = Date.parse('2026-11-01T14:00:00Z');
  const hits = [], errors = [], originalCalls = [];
  const automation = { context: null, store, pages: { records: new Map() }, taskPages: new Map(), busy: () => answerBusy,
    ensureBrowser: async () => {
      if (automation.context) return automation.context; launches++;
      context = await chromium.launchPersistentContext(path.join(directory, 'shared-browser'), { channel: process.env.USTUDY_TEST_BROWSER || 'msedge', headless: true, chromiumSandbox: true, timeout: 20000 });
      automation.context = context;
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url === STUDY_TIME_HOME) return route.fulfill({ contentType: 'text/html', body: management });
        if (url === resourceURL) return route.fulfill({ contentType: 'text/html', body: gradeHTML(mode) });
        if (url === baseURL + '/fixture/lesson') return route.fulfill({ contentType: 'text/html', body: learningHTML });
        if (url.startsWith(baseURL + '/fixture/')) { hits.push(new URL(url).pathname); return route.fulfill({ body: 'ok' }); }
        return route.abort();
      });
      original = context.pages()[0]; await original.goto(STUDY_TIME_HOME); store.windowOpen = true;
      return context;
    },
    unitsForCourse: async courseId => { originalCalls.push('units'); return { courseId, units: [], entries: [] }; },
  };
  automation.operations = new OperationManager(operation => { store.operation = operation; store.changed({ persist: false }); });
  const browser = new StudyTimeBrowser(directory, { ...sharedStudyTimeBrowserAccess(automation), pollMs: 50 });
  const learning = new StudyTimeController({ directory: path.join(directory, 'study-time'), courses: () => store.data.courses, browser, pollMs: 1e8, now: () => wall });
  const server = createApp({ store, automation, studyTime: learning, port:0,accessToken}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await uiContext?.close(); await server.shutdown(); await context?.close(); await store.flush(); assert.ok(path.resolve(directory).startsWith(cache + path.sep)); await rm(directory, { recursive: true, force: true }); });
  await automation.ensureBrowser();
  answer = await context.newPage(); await answer.setContent('<input id="answer-draft" value="保留答题草稿"><button id="submit" onclick="window.submitted=true">提交</button>'); automation.pages.records.set(answer, { role: 'lesson' }); automation.taskPages.set('answer-task', answer);
  lesson = await browser.newStudyPage(context); await lesson.setContent('<h1>Learning objectives</h1><p id="learning">当前学习页面保持不动</p>'); browser.binding = { page: lesson, url: lesson.url() };
  const originalData = JSON.stringify(store.data), originalPageCount = context.pages().length;
  uiContext = await chromium.launchPersistentContext(path.join(directory, 'dashboard'), { channel: process.env.USTUDY_TEST_BROWSER || 'msedge', headless: true, chromiumSandbox: true, viewport: { width: 1600, height: 1050 }, timeout: 20000 });
  await uiContext.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort()); await uiContext.addInitScript(() => localStorage.setItem('ustudy-demo', 'false'));

  await t.test('an active answer job prevents progress navigation and leaves unread values unknown', async () => {
    dashboard = await uiContext.newPage(); dashboard.on('pageerror', error => errors.push(error.message)); await dashboard.goto(authorizedDashboard(base));
    await dashboard.locator('[data-study-time-card-progress="course-book0"]').filter({ hasText: '待读取平台时长' }).waitFor();
    assert.equal(context.pages().length, originalPageCount); assert.deepEqual(hits, []);
    await assert.rejects(learning.refreshProgress({ courseId: courses[0].id }), /自动答题/);
    assert.equal(context.pages().length, originalPageCount);
    // Offscreen cards use the original app's content-visibility optimization.
    assert.match(await dashboard.locator('[data-study-time-card-progress="course-book0"]').textContent(), /待读取平台时长/);
    assert.equal(await dashboard.locator('[data-study-time-card-progress="course-book0"] [role="progressbar"]').count(), 0);
  });
  await t.test('idle refresh follows grade details once for all four books and preserves shared pages', async () => {
    answerBusy = false; await dashboard.reload();
    await dashboard.locator('[data-study-time-card-progress="course-book0"]').filter({ hasText: '03:24:17' }).waitFor({ timeout: 40000 });
    await dashboard.locator('.study-time-term-summary').filter({ hasText: '14:53:39' }).waitFor();
    assert.deepEqual(hits, ['/fixture/tab', '/fixture/detail']); assert.equal(launches, 1); assert.equal(context.pages().length, originalPageCount);
    assert.equal(original.url(), STUDY_TIME_HOME); assert.equal(await answer.locator('#answer-draft').inputValue(), '保留答题草稿'); assert.equal(await answer.evaluate(() => !!window.submitted), false);
    assert.equal(await lesson.locator('#learning').innerText(), '当前学习页面保持不动'); assert.equal(browser.binding.page, lesson); assert.equal(JSON.stringify(store.data), originalData);
    for (let index = 0; index < 4; index++) assert.equal(await dashboard.locator(`[data-study-time-card-progress="course-book${index}"] [role="progressbar"]`).getAttribute('aria-valuenow'), String([22.6, 27.7, 52.7, 8][index]));
    assert.match(await dashboard.locator('[data-study-time-card-progress="course-old"]').textContent(), /待读取平台时长/);
    const summary = (await learning.state()).progress; assert.equal(summary.groups[0].report.books.length, 4); assert.equal(summary.groups[1].report, null);
    await dashboard.screenshot({ path: path.join(cache, 'study-time-grades-cards.png'), fullPage: true, animations: 'disabled' });
    await dashboard.locator('[data-layout="list"]').click(); assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.match(await dashboard.locator('[data-study-time-card-progress="course-book0"]').innerText(), /03:24:17/);
    await dashboard.locator('[data-layout="grid"]').click(); await dashboard.setViewportSize({ width: 430, height: 1000 }); assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dashboard.screenshot({ path: path.join(cache, 'study-time-grades-mobile.png'), fullPage: true, animations: 'disabled' });
  });
  await t.test('a manual refresh rejects partial details, retains the last result and keeps auto-answer navigation intact', async () => {
    const before = (await learning.state()).progress.groups[0].report; mode = 'partial';
    await dashboard.locator('[data-study-time-card-progress="course-book0"] [data-study-time-progress-course-id]').click();
    await dashboard.locator('.study-time-progress-error').filter({ hasText: /明细不完整/ }).waitFor({ timeout: 40000 });
    assert.deepEqual((await learning.state()).progress.groups[0].report, before); assert.equal(context.pages().length, originalPageCount);
    await dashboard.locator('[data-view="tasks"]').first().click(); assert.equal(await dashboard.locator('#tasks-view').isVisible(), true); assert.deepEqual(originalCalls, []); assert.deepEqual(errors, []);
  });
  await t.test('DOM extraction ignores hidden duplicates and task-score details, and supports table rows made from divs', async () => {
    const page = await uiContext.newPage(); await page.setContent(`<div role="dialog"><h2>必修学习时长</h2><div class="grade-table"><div class="grade-row"><div>教程名称</div><div>必修学习时长</div><div>百分制得分</div><div>权重占比</div></div>${titles.map((title, index) => `<div class="grade-row"><div>${title}</div><div>${['03:24:17', '02:46:18', '07:55:04', '00:48:00'][index]}</div><div>${[22.6, 27.7, 52.7, 8][index]}</div><div>${[30, 20, 30, 20][index]}%</div></div>`).join('')}</div></div><div role="dialog" hidden><h2>必修学习时长</h2><p>教程名称 百分制得分</p></div>`);
    const report = await page.evaluate(readStudyTimeGradesFromDOM); assert.equal(report.ambiguous, false); assert.equal(report.books.length, 4); assert.equal(normalizeStudyTimeGrades(courses[0], report).totalSeconds, 53619);
    await page.evaluate(() => { document.querySelector('[role="dialog"]').removeAttribute('role'); });
    const custom = await page.evaluate(readStudyTimeGradesFromDOM); assert.equal(custom.books.length, 4); assert.equal(normalizeStudyTimeGrades(courses[0], custom).totalSeconds, 53619); await page.close();
  });
  await t.test('a platform goal runs on Learning objectives without inline time and uses fresh grades to finish', async () => {
    mode = 'normal';
    const catalog = await learning.loadCatalog({ courseId: courses[0].id });
    const started = await learning.start({ courseId: courses[0].id, unitId: catalog.unitId, entryKey: catalog.entries[0].key, mode: 'platform-add', targetMinutes: 1, keepAlive: true });
    await learning.preparing;
    const task = learning.storage.tasks.find(task => task.id === started.id), activeLesson = browser.binding.page;
    assert.equal(task.status, 'running'); assert.equal(task.creditSource, 'grades'); assert.equal(task.baselineSeconds, 12257); assert.equal(activeLesson.url(), baseURL + '/fixture/lesson');
    assert.equal(context.pages().length, originalPageCount + 1); assert.equal(launches, 1); assert.equal(await answer.locator('#answer-draft').inputValue(), '保留答题草稿');
    await dashboard.setViewportSize({ width: 1600, height: 1050 }); await dashboard.locator('#study-time-nav').click();
    await dashboard.locator('#study-time-status').filter({ hasText: /^学习中$/ }).waitFor();
    assert.match(await dashboard.locator('#study-time-credit-note').innerText(), /综合成绩.*本教材必修时长/);
    await dashboard.screenshot({ path: path.join(cache, 'study-time-credit-view.png'), fullPage: true, animations: 'disabled' });
    additionalSeconds = 67; wall += 120000; await learning.tick(); await learning.gradeCheckPending;
    assert.equal(task.status, 'completed'); assert.equal(task.platformSeconds, 12324); assert.equal(activeLesson.isClosed(), true);
    await dashboard.locator('#study-time-status').filter({ hasText: /^已完成$/ }).waitFor();
    assert.equal(await dashboard.locator('#study-time-platform').innerText(), '00:01:07');
    assert.equal(context.pages().length, originalPageCount); assert.equal(lesson.isClosed(), false); assert.equal(answer.isClosed(), false); assert.equal(original.url(), STUDY_TIME_HOME);
    assert.equal(JSON.stringify(store.data), originalData); assert.equal((await learning.state()).progress.byCourse[courses[0].id].seconds, 12324);
  });
  await t.test('closing during a grade read cancels and cleans up only the temporary tab', async () => {
    mode = 'loading'; const reading = learning.refreshProgress({ courseId: courses[0].id }); reading.catch(() => {});
    const deadline = Date.now() + 10000; while (context.pages().length === originalPageCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(context.pages().length, originalPageCount + 1);
    const temporary = context.pages().find(page => ![original, answer, lesson].includes(page)), anchor = await context.newCDPSession(original), probe = await context.newCDPSession(temporary);
    try { assert.equal((await anchor.send('Browser.getWindowForTarget')).windowId, (await probe.send('Browser.getWindowForTarget')).windowId); } finally { await anchor.detach(); await probe.detach(); }
    await learning.close(); await assert.rejects(reading);
    assert.equal(original.isClosed(), false); assert.equal(answer.isClosed(), false); assert.equal(await answer.locator('#answer-draft').inputValue(), '保留答题草稿');
    assert.equal(context.pages().length, originalPageCount - 1); assert.equal(lesson.isClosed(), true); assert.equal(launches, 1);
  });
});
