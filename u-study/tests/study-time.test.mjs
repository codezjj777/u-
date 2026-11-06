import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StudyTimeController, StudyTimeClock, studyTimeGoalReached } from '../study-time.mjs';
import { StudyTimeStore } from '../study-time-store.mjs';
import { parseStudyDuration, studyCredit, isStudyIdleNotice, isStudyTimeURL, studyEntryMatches } from '../study-time-dom.mjs';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';
import {accessToken,accessHeaders} from './fixtures/local-access.mjs';
import { sharedStudyTimeBrowserAccess } from '../study-time-browser.mjs';
import { normalizeStudyTimeGrades } from '../study-time-grades.mjs';

const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true });
const course = { id: 'course-book', title: '独立学习测试教程', url: 'https://ucontent.unipus.cn/offline-study-time/catalog', source: 'platform', status: 'completed', progress: 100 };
class FakeBrowser {
  constructor() { this.windowOpen = true; this.calls = []; this.report = { ready: true, notices: [], title: 'Learning objectives', nativeRecoveries: 0, credit: null }; }
  async show() { this.calls.push('show'); return { windowOpen: true }; }
  async loadCatalog() { this.calls.push('catalog'); return { unitId: 'unit1', units: [{ id: 'unit1', label: 'Unit 1' }], entries: [{ key: 'entry1', title: 'Learning objectives', path: [], preferred: true }] }; }
  async openActivity(_course, _task, signal) { signal.throwIfAborted(); this.calls.push('open'); return structuredClone(this.report); }
  async resume(...args) { this.calls.push('resume'); return this.openActivity(...args); }
  async read(signal) { signal?.throwIfAborted(); this.calls.push('read'); return structuredClone(this.report); }
  async recover(report) {
    this.calls.push('recover');
    if (report.notices.length !== 1 || report.notices[0].kind === 'unknown') throw Object.assign(new Error('未知提示保留核对'), { preservePage: true });
    this.report.notices = []; return { report: structuredClone(this.report), recovered: report.notices[0].kind === 'idle' ? 1 : 0 };
  }
  async keepAlive() { this.calls.push('activity'); return true; }
  async suspend() { this.calls.push('suspend'); }
  async stop() { this.calls.push('stop'); }
  async close() { this.calls.push('close'); }
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(cache, 'study-time-test-'));
  let wall = 1000000, mono = 1000;
  const browser = new FakeBrowser(), controller = new StudyTimeController({ directory, courses: () => [course], browser, pollMs: 1e8, gradePollMs: 5000, now: () => wall, monotonic: () => mono, ...options });
  t.after(async () => { await controller.close().catch(() => {}); assert.ok(path.resolve(directory).startsWith(cache + path.sep)); await rm(directory, { recursive: true, force: true }); });
  await controller.loadCatalog({ courseId: course.id });
  const start = async (input = {}) => { const task = await controller.start({ courseId: course.id, unitId: 'unit1', entryKey: 'entry1', mode: 'session', targetMinutes: 1, keepAlive: true, ...input }); await controller.preparing; return controller.storage.tasks.find(row => row.id === task.id); };
  return { directory, browser, controller, start, advance: async (ms, { settleGrades = true } = {}) => { wall += ms; mono += ms; await controller.tick(); if (settleGrades) await controller.gradeCheckPending; }, jump: (ms, monoMs = ms) => { wall += ms; mono += monoMs; } };
}

test('duration parsing requires explicit units or an unambiguous hours:minutes:seconds value', () => {
  for (const [value, seconds] of [['1小时30分钟5秒', 5405], ['1.5小时', 5400], ['02:03:04', 7384], ['0分钟', 0], ['90 seconds', 90], ['5分30秒', 330]]) assert.equal(parseStudyDuration(value), seconds, value);
  for (const value of ['', '30', '01:30', '要求30分钟', '-1分钟', '1:60:00', '99:00:90', 'Infinity小时']) assert.equal(parseStudyDuration(value), null, value);
});
test('credited statistics reject conflicting scopes and values', () => {
  const a = { label: '本单元已学时长', value: '30分钟', scope: 'unit' };
  assert.deepEqual(studyCredit([a, a]), { label: a.label, scope: a.scope, seconds: 1800, key: JSON.stringify([a.scope, a.label]) });
  assert.equal(studyCredit([a, { ...a, value: '31分钟' }]), null);
  assert.equal(studyCredit([a, { ...a, scope: 'course' }]), null);
  assert.equal(studyCredit([{ ...a, value: '要求30分钟' }]), null);
});
test('idle recognition excludes ordinary authorizations and unit time requirements', () => {
  for (const text of ['由于你长时间未操作，请点确定继续使用。', '您已长时间未操作，系统暂停学习计时，请继续学习。', '您超过30分钟没有进行学习操作，计时已停止。', 'Your session is inactive. Continue learning?']) assert.equal(isStudyIdleNotice(text), true);
  for (const text of ['是否授权使用麦克风？', '本单元学习时间30分钟，是否必修：是。', '确定提交答案吗？']) assert.equal(isStudyIdleNotice(text), false);
});
test('learning URLs are restricted to HTTPS Unipus hosts without embedded credentials', () => {
  assert.equal(isStudyTimeURL('https://ucontent.unipus.cn/a'), true);
  for (const value of ['http://ucontent.unipus.cn/a', 'https://unipus.cn.evil.test', 'https://user:password@ucontent.unipus.cn/a', 'javascript:alert(1)', 'file:///test']) assert.equal(isStudyTimeURL(value), false);
});
test('a readable page must still identify the selected learning entry', () => {
  assert.equal(studyEntryMatches('Learning objectives', { title: 'Learning objectives', crumbs: [] }), true);
  assert.equal(studyEntryMatches('Learning objectives', { title: 'English Book', crumbs: ['Unit 2', 'Learning objectives'] }), true);
  assert.equal(studyEntryMatches('Learning objectives', { title: 'Overview', crumbs: ['Unit 2', 'Overview'] }), false);
  assert.equal(studyEntryMatches('', { title: '' }), false);
});
test('shared access reuses the host context and refuses to contend with an answer operation', async () => {
  const context = {}, host = { context, busy: () => false, ensureBrowser: () => assert.fail('must reuse the open context') };
  const access = sharedStudyTimeBrowserAccess(host); assert.equal(await access.getContext(), context); assert.equal(access.existingContext(), context);
  let calls = 0; host.busy = () => true;
  await assert.rejects(access.runShared(async () => { calls++; }), /自动答题/); assert.equal(calls, 0);
  host.busy = () => false; await access.runShared(async () => { calls++; }); assert.equal(calls, 1);
  await assert.rejects(sharedStudyTimeBrowserAccess({}).getContext(), /请先连接/);
});

test('session notice access is restricted to the course home and never an answer page or active answer operation', () => {
  let busy = false;
  const home = { url: () => 'https://ucloud.unipus.cn/app/cmgt/course-management' }, lesson = { url: () => 'https://ucontent.unipus.cn/pc.html' };
  const host = { busy: () => busy, pages: { records: new Map([[home, { role: 'home' }]]) }, taskPages: new Map(), operations: { active: null } };
  const access = sharedStudyTimeBrowserAccess(host);
  assert.equal(access.canConfirmSessionNotice(home), true); assert.equal(access.canConfirmSessionNotice(lesson), false);
  busy = true; assert.equal(access.canConfirmSessionNotice(home), false); busy = false;
  host.operations.active = { kind: 'sync' }; assert.equal(access.canConfirmSessionNotice(home), false); host.operations.active = null;
  host.pages.records.set(home, { role: 'lesson' }); assert.equal(access.canConfirmSessionNotice(home), false);
  host.pages.records.set(home, { role: 'home', protected: 'draft' }); assert.equal(access.canConfirmSessionNotice(home), false);
  host.pages.records.set(home, { role: 'home' }); host.taskPages.set('answer', home); assert.equal(access.canConfirmSessionNotice(home), false);
});

test('idle recovery forces a fresh platform check and discards a grade response started before confirmation', async t => {
  let calls = 0, resolvePending;
  const f = await fixture(t, { gradePollMs: 120000, readGrades: async (_browser, _course, signal) => {
    calls++;
    if (calls === 2) return new Promise((resolve, reject) => { resolvePending = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    return grades(calls === 1 ? 100 : 160);
  } });
  const task = await f.start({ mode: 'platform-add' });
  for (let index = 0; index < 12; index++) await f.advance(10000, { settleGrades: false });
  assert.equal(calls, 2);
  f.browser.report.notices = [{ kind: 'idle' }]; await f.advance(2000, { settleGrades: false });
  assert.equal(task.recoveries, 1); resolvePending(grades(5000)); await f.controller.gradeCheckPending;
  assert.equal(task.platformSeconds, 100); assert.equal(task.status, 'running');
  await f.advance(2000); assert.equal(calls, 3); assert.equal(task.platformSeconds, 160); assert.equal(task.status, 'completed');
});
test('the dwell clock excludes unready transitions, suspended computers and clock corrections', () => {
  const clock = new StudyTimeClock(); assert.equal(clock.sample(1000, 1000, true).elapsedMs, 0);
  assert.equal(clock.sample(3000, 3000, true).elapsedMs, 2000);
  assert.equal(clock.sample(5000, 5000, false).elapsedMs, 0);
  assert.equal(clock.sample(7000, 7000, true).elapsedMs, 0);
  assert.equal(clock.sample(9000, 9000, true).elapsedMs, 2000);
  assert.equal(clock.sample(100000, 100000, true).gap, true);
  assert.equal(clock.sample(200000, 102000, true).elapsedMs, 0);
  assert.equal(clock.sample(190000, 104000, true).elapsedMs, 0);
});
test('platform goals cannot be completed by local runtime', () => {
  const task = { mode: 'platform-add', targetMinutes: 30, elapsedMs: 3600000, baselineSeconds: 5400, platformSeconds: 5880 };
  assert.equal(studyTimeGoalReached(task), false);
  assert.equal(studyTimeGoalReached({ ...task, platformSeconds: null }), false);
  assert.equal(studyTimeGoalReached({ ...task, platformSeconds: 7200 }), true);
  assert.equal(studyTimeGoalReached({ ...task, mode: 'platform-total', targetMinutes: 120, platformSeconds: 7200 }), true);
  assert.equal(studyTimeGoalReached({ ...task, mode: 'session' }), true);
});
test('a completed course can run without an answer bank or AI, and stops at its dwell goal', async t => {
  const f = await fixture(t, { keepAliveMs: 20000 }); const before = JSON.stringify(course), task = await f.start();
  for (let i = 0; i < 6; i++) await f.advance(10000);
  assert.equal(task.elapsedMs, 60000); assert.equal(task.status, 'completed'); assert.equal(task.platformSeconds, null);
  assert.equal(f.browser.calls.filter(call => call === 'stop').length, 1); assert.ok(f.browser.calls.includes('activity'));
  assert.equal(JSON.stringify(course), before); assert.match(task.logs.at(-1).message, /驻留目标.*平台实际记录/);
});
test('pause, stop and resume act only on the independent browser and exclude the entire pause interval', async t => {
  const f = await fixture(t), task = await f.start({ targetMinutes: 60 }); await f.advance(5000);
  await f.controller.control(task.id, 'pause'); assert.equal(task.status, 'paused'); assert.ok(f.browser.calls.includes('suspend'));
  f.jump(3600000); await f.controller.control(task.id, 'resume'); await f.controller.preparing; await f.advance(5000);
  assert.equal(task.elapsedMs, 10000); await f.controller.control(task.id, 'stop'); assert.equal(task.status, 'stopped');
  await assert.rejects(f.controller.control(task.id, 'resume'), /已结束/);
});
test('an idle dialog is restored without counting its interrupted poll, while unknown dialogs remain visible', async t => {
  const f = await fixture(t), task = await f.start({ targetMinutes: 60 }); await f.advance(5000);
  f.browser.report.notices = [{ kind: 'idle' }]; await f.advance(5000);
  assert.equal(task.recoveries, 1); assert.equal(task.elapsedMs, 5000); assert.equal(task.status, 'running');
  const suspends = f.browser.calls.filter(call => call === 'suspend').length;
  f.browser.report.notices = [{ kind: 'unknown' }]; await f.advance(5000);
  assert.equal(task.status, 'review'); assert.equal(task.elapsedMs, 5000); assert.equal(f.browser.calls.filter(call => call === 'suspend').length, suspends);
  f.browser.report.notices = []; await f.controller.control(task.id, 'resume'); await f.controller.preparing; assert.equal(task.status, 'running');
});

test('a confirmed inactivity pause excludes the gap without misreporting it as an unexplained sleep', async t => {
  const f = await fixture(t), task = await f.start({ targetMinutes: 60 });
  f.browser.report.notices = [{ kind: 'idle' }]; await f.advance(30 * 60000);
  assert.equal(task.status, 'running'); assert.equal(task.elapsedMs, 0); assert.equal(task.interruptedMs, 30 * 60000); assert.equal(task.recoveries, 1);
  assert.equal(task.logs.some(log => /检测到休眠/.test(log.message)), false);
});
test('missing platform statistics require review rather than reporting the local clock as platform time', async t => {
  const f = await fixture(t), task = await f.start({ mode: 'platform-add' });
  assert.equal(task.status, 'review'); assert.equal(task.platformSeconds, null); assert.match(task.logs.at(-1).message, /未提供可核对的已学时长/);
});
test('a platform increase completes a platform goal and does not require a matching local duration', async t => {
  const f = await fixture(t); f.browser.report.credit = { seconds: 5400, key: 'unit-time', label: '本单元已学时长' };
  const task = await f.start({ mode: 'platform-add', targetMinutes: 30 }); f.browser.report.credit.seconds = 7200; await f.advance(5000);
  assert.equal(task.status, 'completed'); assert.equal(task.baselineSeconds, 5400); assert.equal(task.platformSeconds, 7200); assert.equal(task.elapsedMs, 5000);
});

const grades = seconds => normalizeStudyTimeGrades(course, { detailOpen: true, books: [
  { title: course.title, value: `${seconds}秒`, score: '10', weight: '50%' },
  { title: '本学期另一本教材', value: '20小时', score: '100', weight: '50%' },
] });

test('a learning page without statistics gets a fresh textbook baseline from grades and polls to its platform goal', async t => {
  let calls = 0, seconds = 5400;
  const f = await fixture(t, { gradePollMs: 120000, readGrades: async () => { calls++; return grades(seconds); } });
  await f.controller.progressStorage.put(grades(1)); // Yesterday's cached value is not a task baseline.
  const task = await f.start({ mode: 'platform-add' });
  assert.equal(task.status, 'running'); assert.equal(task.baselineSeconds, 5400); assert.equal(task.creditSource, 'grades'); assert.equal(calls, 1);
  assert.match(task.creditLabel, /本教材/); assert.match(task.creditKey, /^grades:/);
  for (let i = 0; i < 11; i++) await f.advance(10000);
  assert.equal(task.status, 'running'); assert.equal(calls, 1); assert.equal(task.platformSeconds, 5400);
  seconds = 5467; await f.advance(10000);
  assert.equal(task.status, 'completed'); assert.equal(task.platformSeconds, 5467); assert.equal(calls, 2);
  assert.equal((await f.controller.state()).progress.byCourse[course.id].seconds, 5467);
});

test('inline platform credit refreshes every two minutes and retains seconds', async t => {
  const f = await fixture(t, { gradePollMs: 120000 }); f.browser.report.credit = { seconds: 5437, key: 'unit-time', label: '本单元已学时长' };
  const task = await f.start({ mode: 'platform-add', targetMinutes: 60 });
  assert.match(task.logs.find(log => /已读取平台时长/.test(log.message)).message, /01:30:37/);
  f.browser.report.credit.seconds = 5506;
  for (let index = 0; index < 11; index++) await f.advance(10000);
  assert.equal(task.platformSeconds, 5437);
  await f.advance(10000); assert.equal(task.platformSeconds, 5506); assert.equal(task.platformSeconds - task.baselineSeconds, 69);
});

test('a slow grade request does not block dwell, page checks or keepalive and cannot start another request', async t => {
  let calls = 0, resolveGrades;
  const f = await fixture(t, { gradePollMs: 10000, keepAliveMs: 20000, readGrades: async (_browser, _course, signal) => {
    if (++calls === 1) return grades(100);
    return new Promise((resolve, reject) => { resolveGrades = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } });
  const task = await f.start({ mode: 'platform-add', targetMinutes: 60 });
  for (let index = 0; index < 6; index++) await f.advance(10000, { settleGrades: false });
  assert.equal(calls, 2); assert.equal(task.status, 'running'); assert.equal(task.elapsedMs, 60000); assert.equal(task.platformSeconds, 100);
  assert.equal(f.browser.calls.filter(call => call === 'read').length, 6); assert.equal(f.browser.calls.filter(call => call === 'activity').length, 3);
  assert.equal(task.logs.some(log => /休眠|较长响应中断/.test(log.message)), false);
  resolveGrades(grades(127)); await f.controller.gradeCheckPending; assert.equal(task.platformSeconds, 127); assert.equal(task.status, 'running');
});

test('a real timer gap is still excluded even though grades are checked independently', async t => {
  const f = await fixture(t, { readGrades: async () => grades(100) }), task = await f.start({ mode: 'platform-add', targetMinutes: 60 });
  const fresh = (await f.controller.state()).dwellClock; assert.equal(fresh.ticking, true);
  f.jump(120000); assert.equal((await f.controller.state()).dwellClock.ticking, false);
  await f.controller.tick(); await f.controller.gradeCheckPending;
  assert.equal(task.elapsedMs, 0); assert.equal(task.interruptedMs, 120000); assert.equal(task.logs.filter(log => /休眠/.test(log.message)).length, 1);
  await f.controller.control(task.id, 'pause'); assert.equal((await f.controller.state()).dwellClock, null);
});

test('a goal reached by a grade response cannot race an in-flight page read into manual review', async t => {
  let calls = 0, resolveGrades, rejectPage, pageStarted;
  const readingPage = new Promise(resolve => { pageStarted = resolve; });
  const f = await fixture(t, { gradePollMs: 10000, readGrades: async (_browser, _course, signal) => {
    if (++calls === 1) return grades(100);
    return new Promise((resolve, reject) => { resolveGrades = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } });
  const task = await f.start({ mode: 'platform-add' }); await f.advance(10000, { settleGrades: false });
  f.browser.read = () => new Promise((_, reject) => { rejectPage = reject; pageStarted(); });
  f.browser.stop = async () => { rejectPage(new Error('学习页面已关闭')); await Promise.resolve(); };
  f.jump(2000); const tick = f.controller.tick(); await readingPage;
  resolveGrades(grades(160)); await f.controller.gradeCheckPending; await tick;
  assert.equal(task.status, 'completed'); assert.equal(task.platformSeconds, 160); assert.equal(task.logs.some(log => /需要核对|页面已关闭/.test(log.message)), false);
});

test('a grades-based total goal uses only this textbook and cannot finish on other books or local elapsed time', async t => {
  let seconds = 30;
  const f = await fixture(t, { readGrades: async () => grades(seconds), gradePollMs: 10000 });
  const task = await f.start({ mode: 'platform-total', targetMinutes: 1 });
  assert.equal(task.status, 'running'); assert.equal(task.platformSeconds, 30);
  task.elapsedMs = 24 * 3600000; await f.advance(10000); assert.equal(task.status, 'running');
  seconds = 60; await f.advance(10000); assert.equal(task.status, 'completed');
});

test('a grade task keeps its scope if the page later exposes unrelated unit statistics', async t => {
  let seconds = 100;
  const f = await fixture(t, { readGrades: async () => grades(seconds), gradePollMs: 10000 });
  const task = await f.start({ mode: 'platform-add', targetMinutes: 60 }), key = task.creditKey;
  f.browser.report.credit = { seconds: 999999, key: 'other-unit', label: '本单元已学时长' };
  seconds = 110; await f.advance(10000);
  assert.equal(task.status, 'running'); assert.equal(task.platformSeconds, 110); assert.equal(task.creditKey, key);
});

test('failed initial grade verification does not turn an old cache into a baseline', async t => {
  const f = await fixture(t, { readGrades: async () => { throw new Error('成绩尚未发布'); } });
  await f.controller.progressStorage.put(grades(99999));
  const task = await f.start({ mode: 'platform-total' });
  assert.equal(task.status, 'review'); assert.equal(task.baselineSeconds, null); assert.equal(task.platformSeconds, null); assert.match(task.logs.at(-1).message, /成绩尚未发布/);
});

test('an active answer lease defers grade checks and growth resumes without changing the answer job', async t => {
  let busy = false, seconds = 100;
  const f = await fixture(t, { readGrades: async () => { if (busy) throw Object.assign(new Error('自动答题进行中'), { status: 409 }); return grades(seconds); }, gradePollMs: 10000, creditStallMs: 15000, gradeStallMs: 30000 });
  const task = await f.start({ mode: 'platform-add' }); busy = true;
  for (let i = 0; i < 6; i++) await f.advance(10000);
  assert.equal(task.status, 'running'); assert.equal(task.platformSeconds, 100); assert.match(task.creditNote, /暂缓/);
  assert.equal(task.logs.filter(log => /核对暂缓/.test(log.message)).length, 1);
  busy = false; seconds = 160; await f.advance(10000);
  assert.equal(task.status, 'completed'); assert.equal(task.creditNote, '');
});

test('pausing and resuming a grades task preserves the verified baseline and source across persistence', async t => {
  let seconds = 100;
  const f = await fixture(t, { readGrades: async () => grades(seconds) });
  const task = await f.start({ mode: 'platform-add', targetMinutes: 60 }), key = task.creditKey;
  await f.controller.control(task.id, 'pause'); seconds = 120;
  await f.controller.control(task.id, 'resume'); await f.controller.preparing;
  assert.equal(task.status, 'running'); assert.equal(task.baselineSeconds, 100); assert.equal(task.platformSeconds, 120); assert.equal(task.creditKey, key);
  const restored = new StudyTimeStore(f.directory); await restored.load();
  assert.equal(restored.tasks[0].creditSource, 'grades'); assert.equal(restored.tasks[0].creditLabel, task.creditLabel); assert.equal(restored.tasks[0].baselineSeconds, 100);
});

test('unchanged confirmed grades and a decreasing grade value require review without resetting the baseline', async t => {
  for (const decrease of [false, true]) await t.test(decrease ? 'decreasing' : 'unchanged', async t => {
    let seconds = 100;
    const f = await fixture(t, { readGrades: async () => grades(seconds), gradePollMs: 5000, gradeStallMs: 15000 });
    const task = await f.start({ mode: 'platform-add', targetMinutes: 60 });
    if (decrease) seconds = 99;
    for (let i = 0; i < 3 && task.status === 'running'; i++) await f.advance(5000);
    assert.equal(task.status, 'review'); assert.equal(task.baselineSeconds, 100); assert.equal(task.platformSeconds, 100);
  });
});

test('stopping during a periodic grade check cancels it and cannot complete or resurrect the task', async t => {
  let calls = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { gradePollMs: 10000, readGrades: async (_browser, _course, signal) => {
    if (++calls === 1) return grades(100);
    entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return grades(10000);
  } });
  const task = await f.start({ mode: 'platform-add' }); f.jump(10000);
  const tick = f.controller.tick(); await started; await f.controller.control(task.id, 'stop'); await tick;
  assert.equal(task.status, 'stopped'); assert.equal(task.platformSeconds, 100); assert.equal(f.controller.progressPending, null);
});
test('stalled, decreasing or differently scoped platform values enter review', async t => {
  for (const change of ['stall', 'decrease', 'scope']) await t.test(change, async t => {
    const f = await fixture(t, { creditStallMs: 12000 }); f.browser.report.credit = { seconds: 100, key: 'unit-time', label: '本单元已学时长' };
    const task = await f.start({ mode: 'platform-add', targetMinutes: 60 });
    if (change === 'decrease') f.browser.report.credit.seconds = 99;
    if (change === 'scope') f.browser.report.credit.key = 'course-time';
    await f.advance(7000); if (change === 'stall') await f.advance(7000);
    assert.equal(task.status, 'review'); assert.notEqual(task.status, 'completed');
  });
});
test('stopping during startup cannot resurrect a running task', async t => {
  const f = await fixture(t); let entered;
  const called = new Promise(resolve => { entered = resolve; });
  f.browser.openActivity = async (_course, _task, signal) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  const task = await f.controller.start({ courseId: course.id, unitId: 'unit1', entryKey: 'entry1', mode: 'session', targetMinutes: 60, keepAlive: true });
  await called; await f.controller.control(task.id, 'stop'); assert.equal(f.controller.storage.tasks[0].status, 'stopped'); assert.equal(f.controller.timer, null);
});
test('task validation and the independent task lock reject invalid or overlapping starts', async t => {
  const f = await fixture(t), input = { courseId: course.id, unitId: 'unit1', entryKey: 'entry1', mode: 'session', targetMinutes: 60, keepAlive: true };
  for (const patch of [{ targetMinutes: 0 }, { targetMinutes: 1.5 }, { targetMinutes: 1441 }, { mode: 'fake' }, { entryKey: 'other' }, { keepAlive: 'yes' }]) await assert.rejects(f.controller.start({ ...input, ...patch }));
  await f.start(); await assert.rejects(f.controller.start(input), /已有学习时长任务/);
});
test('restart preserves its own progress and offers an interrupted task without earning downtime', async t => {
  const f = await fixture(t), task = await f.start({ targetMinutes: 60 }); await f.advance(10000); await f.controller.close();
  const restored = new StudyTimeStore(f.directory); await restored.load();
  assert.equal(restored.tasks[0].status, 'interrupted'); assert.equal(restored.tasks[0].elapsedMs, 10000);
  const raw = await readFile(path.join(f.directory, 'state.json'), 'utf8'); assert.equal(raw.includes('browser-profile'), false); assert.equal(raw.includes('apiKey'), false);
  assert.equal(restored.tasks[0].id, task.id);
});
test('the new API retains origin checks and leaves original answer state and endpoints independent', async t => {
  const directory = await mkdtemp(path.join(cache, 'study-time-http-'));
  const store = await new Store(directory, { env: {} }).load(); store.data.courses = [structuredClone(course)];
  let answerStarts = 0, answerControls = 0;
  const automation = { busy: () => true, startTask: (courseId, unitId) => { answerStarts++; return { id: 'answer-task', courseId, unitId, status: 'running' }; }, controlTask: () => { answerControls++; return { id: 'answer-task', status: 'paused' }; } };
  const learning = new StudyTimeController({ directory: path.join(directory, 'study-time'), courses: () => store.data.courses, browser: new FakeBrowser(), pollMs: 1e8 });
  const server = createApp({ store, automation, studyTime: learning, port:0,accessToken}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data, headers = {}) => fetch(base + '/api' + route, { method: 'POST', headers:{...accessHeaders,'Content-Type': 'application/json', 'X-UStudy': '1', Origin: base, ...headers }, body: JSON.stringify(data) });
  t.after(async () => { await server.shutdown(); await store.flush(); assert.ok(path.resolve(directory).startsWith(cache + path.sep)); await rm(directory, { recursive: true, force: true }); });
  const before = JSON.stringify(store.data);
  assert.equal((await fetch(base + '/api/study-time/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(base + '/api/study-time/diagnostics', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.deepEqual(await (await fetch(base + '/api/study-time/diagnostics', { headers: accessHeaders })).json(), { windowOpen: false, pages: [] });
  assert.equal((await post('/study-time/window', {}, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('/study-time/window', {}, { 'X-UStudy': '0' })).status, 403);
  assert.equal((await post('/study-time/catalog', { courseId: course.id })).status, 200);
  const result = await post('/study-time/tasks', { courseId: course.id, unitId: 'unit1', entryKey: 'entry1', mode: 'session', targetMinutes: 60, keepAlive: true });
  assert.equal(result.status, 202); await learning.preparing;
  assert.equal(answerStarts, 0); assert.equal(answerControls, 0); assert.equal(JSON.stringify(store.data), before);
  assert.equal((await post('/tasks', { courseId: course.id, unitId: 'unit1' })).status, 202); assert.equal(answerStarts, 1);
  const task = learning.storage.tasks[0]; assert.equal((await post(`/study-time/tasks/${task.id}/pause`, {})).status, 200); assert.equal(answerControls, 0);
  assert.equal((await post('/tasks/answer-task/pause', {})).status, 200); assert.equal(answerControls, 1); assert.equal(task.status, 'paused');
  assert.equal((await post('/study-time/tasks', 'bad')).status, 400);
  assert.equal((await post('/study-time/nonexistent', {})).status, 404);
});
