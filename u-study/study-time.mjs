import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { StudyTimeBrowser } from './study-time-browser.mjs';
import { StudyTimeStore, studyLiveStatuses } from './study-time-store.mjs';
import { isStudyTimeURL, studyCourseLabel } from './study-time-dom.mjs';
import { StudyTimeProgressStore, readStudyTimeGrades, studyTimeGradeCredit } from './study-time-grades.mjs';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const copy = value => JSON.parse(JSON.stringify(value));
const duration = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(value => String(value).padStart(2, '0')).join(':');

// Both clocks must advance normally. A delayed poll, paused page, recovery,
// suspended computer or wall-clock adjustment cannot earn local dwell time.
export class StudyTimeClock {
  constructor({ maxGapMs = 15000 } = {}) { this.maxGapMs = maxGapMs; this.previous = null; }
  sample(wall, monotonic, eligible) {
    const previous = this.previous; this.previous = { wall, monotonic, eligible };
    if (!previous) return { elapsedMs: 0, interruptedMs: 0, gap: false };
    const wallDelta = wall - previous.wall, delta = monotonic - previous.monotonic;
    const gap = wallDelta < 0 || delta < 0 || Math.max(wallDelta, delta) > this.maxGapMs || Math.abs(wallDelta - delta) > 2000;
    const elapsedMs = !gap && eligible && previous.eligible ? Math.max(0, Math.floor(Math.min(wallDelta, delta))) : 0;
    return { elapsedMs, interruptedMs: elapsedMs ? 0 : Math.max(0, wallDelta), gap };
  }
}

export function studyTimeGoalReached(task) {
  const target = task.targetMinutes * 60;
  if (task.mode === 'session') return task.elapsedMs >= target * 1000;
  if (task.platformSeconds === null || task.baselineSeconds === null) return false;
  return task.mode === 'platform-total' ? task.platformSeconds >= target : task.platformSeconds - task.baselineSeconds >= target;
}

export class StudyTimeController {
  constructor({ directory, courses = () => [], browser, browserAccess, storage, readGrades = readStudyTimeGrades, pollMs = 2000, keepAliveMs = 20 * 60000, creditStallMs = 6 * 60000, gradePollMs = 120000, gradeStallMs = 20 * 60000, now = Date.now, monotonic = () => performance.now() } = {}) {
    this.storage = storage || new StudyTimeStore(directory); this.courses = courses;
    this.progressStorage = new StudyTimeProgressStore(directory || this.storage.directory);
    this.browser = browser || new StudyTimeBrowser(directory, { ...browserAccess, onLost: () => this.disconnected() });
    this.pollMs = pollMs; this.keepAliveMs = keepAliveMs; this.creditStallMs = creditStallMs; this.now = now; this.monotonic = monotonic;
    this.loading = null; this.loaded = false; this.catalog = null; this.operation = ''; this.preparing = null; this.tickPending = null;
    this.timer = null; this.controller = null; this.clock = null; this.controlPending = false; this.closing = false; this.closePromise = null;
    this.lastSavedAt = 0; this.lastKeepAliveAt = 0; this.lastCreditGrowthAt = 0; this.lastCreditReadAt = 0; this.nativeRecoveryTotal = 0;
    this.readGrades = readGrades; this.gradePollMs = gradePollMs; this.gradeStallMs = gradeStallMs;
    this.nextGradeReadAt = 0; this.gradeFailures = 0; this.gradePreviousConfirmedAt = null; this.gradeUnchangedMs = 0;
    this.gradeCheckPending = null; this.finishingTask = ''; this.nextPageCreditReadAt = 0;
  }
  async ready() {
    if (this.closing) throw new Error('学习时长服务正在关闭。');
    if (this.loaded) return;
    this.loading ||= Promise.all([this.storage.load(), this.progressStorage.load()]).then(() => { this.loaded = true; }).catch(error => { this.loading = null; throw error; });
    await this.loading;
  }
  active() { return this.storage.tasks.find(task => studyLiveStatuses.has(task.status)); }
  course(id) {
    const course = this.courses().find(course => course.id === id && isStudyTimeURL(course.url));
    if (!course) throw new Error('课程不存在，请先在「我的课程」同步真实课程。');
    if (course.requiresActivation) throw new Error('请先在 U校园激活该教程。');
    return course;
  }
  async state() {
    await this.ready();
    return { tasks: copy(this.storage.tasks), courses: this.courses().filter(course => isStudyTimeURL(course.url)).map(course => ({ id: course.id, title: course.title, label: studyCourseLabel(course), requiresActivation: !!course.requiresActivation })),
      catalog: this.catalog ? copy(this.catalog) : null, windowOpen: this.browser.windowOpen, operation: this.operation, storageError: this.storage.error || '',
      progress: copy(this.progressStorage.snapshot(this.courses().filter(course => isStudyTimeURL(course.url)), this.now())), progressAvailable: !!this.browser.progressAvailable,
      dwellClock: this.dwellClock(), platformRefreshMs: this.gradePollMs, timingVersion: 2, taskCreditVersion: 2, pageReadVersion: 3, idleNoticeVersion: 2 };
  }
  dwellClock() {
    const task = this.active(), sample = this.clock?.previous, now = this.now(), maxAheadMs = 6000;
    if (!task || task.status !== 'running' || !sample) return null;
    const age = now - sample.wall, monotonicAge = this.monotonic() - sample.monotonic;
    return { taskId: task.id, sampledAt: sample.wall, serverNow: now, maxAheadMs, interruptedMs: task.interruptedMs,
      ticking: !!sample.eligible && !this.finishingTask && !this.controller?.signal.aborted && age >= 0 && age <= maxAheadMs && Math.abs(age - monotonicAge) <= 2000 };
  }
  async diagnostics() { await this.ready(); return this.browser.diagnostics ? this.browser.diagnostics() : { windowOpen: false, pages: [] }; }
  async exclusive(label, work) {
    await this.ready(); if (this.operation || this.controlPending) throw conflict('学习窗口正在处理操作，请稍候。');
    this.operation = label;
    try { return await work(); } finally { this.operation = ''; }
  }
  async connect() {
    return this.exclusive('打开学习窗口', async () => this.browser.show());
  }
  async loadCatalog(input) {
    return this.exclusive('读取学习单元', async () => {
      if (this.active()) throw conflict('请先停止学习时长任务，再切换课程或单元。');
      const course = this.course(input.courseId);
      if (input.unitId !== undefined && (typeof input.unitId !== 'string' || input.unitId.length > 200)) throw new Error('学习单元无效。');
      const controller = new AbortController(); this.catalogController = controller;
      try {
        const result = await this.browser.loadCatalog(course, input.unitId, controller.signal);
        this.catalog = { courseId: course.id, unitId: result.unitId, units: result.units, entries: result.entries };
        return copy(this.catalog);
      } finally { this.catalogController = null; }
    });
  }
  async refreshProgress(input) {
    return this.exclusive('读取学习时长', async () => {
      await this.readProgressReport(this.course(input.courseId));
      return copy(this.progressStorage.snapshot(this.courses(), this.now()));
    });
  }
  async readProgressReport(course, signal) {
    if (this.progressPending) throw conflict('正在核对平台学习时长，请稍后再试。');
    signal?.throwIfAborted();
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.progressController = controller;
    const pending = Promise.resolve().then(async () => {
      const report = await this.readGrades(this.browser, course, combined);
      combined.throwIfAborted(); studyTimeGradeCredit(course, report);
      await this.progressStorage.put(report); combined.throwIfAborted(); return report;
    });
    this.progressPending = pending;
    try { return await pending; } finally { this.progressController = null; this.progressPending = null; }
  }
  creditNote(task, note, log = false) {
    if (task.creditNote === note) return;
    task.creditNote = note;
    if (log && note) this.storage.log(task, note, 'warning');
  }
  async taskCredit(task, report, signal, initial = false) {
    const fromGrades = task.creditSource === 'grades' || task.creditKey.startsWith('grades:');
    const canSelectGrades = task.mode !== 'session' && !report.credit && !task.creditKey;
    if (!fromGrades && !canSelectGrades) {
      if (!initial && this.now() < this.nextPageCreditReadAt) return null;
      this.nextPageCreditReadAt = this.now() + this.gradePollMs;
      return report.credit ? { ...report.credit, source: 'page' } : null;
    }
    if (!initial && this.now() < this.nextGradeReadAt) return null;
    let grades; const startedAt = this.now();
    if (initial || !task.creditNote) this.creditNote(task, '正在从综合成绩核对本教材必修学习时长…');
    try { grades = await this.readProgressReport(this.course(task.courseId), signal); }
    catch (error) {
      signal?.throwIfAborted(); this.gradePreviousConfirmedAt = null;
      this.nextGradeReadAt = this.now() + Math.min(30000, this.gradePollMs);
      if (error.status === 409 && task.baselineSeconds !== null) {
        this.creditNote(task, '平台时长核对暂缓：答题或课程读取正在进行，空闲后会继续核对；上次确认值保持不变。', true);
        return null;
      }
      const temporaryReadFailure = /未读到「综合成绩|暂时没有响应|超时|网络/.test(error.message || '');
      if (initial || error.code === 'STUDY_TIME_REVIEW' && !temporaryReadFailure || ++this.gradeFailures >= 3) {
        this.creditNote(task, '综合成绩时长尚未核对成功，请处理原因后点击「继续学习」。');
        throw new Error(`当前页面未提供可核对的已学时长，综合成绩核对未完成：${error.message || '暂时无法读取'}。请核对后点击「继续学习」。`);
      }
      this.creditNote(task, '综合成绩暂时未能读取，将稍后重试；上次确认值保持不变。', true);
      return null;
    }
    signal?.throwIfAborted();
    const credit = studyTimeGradeCredit(this.course(task.courseId), grades), now = this.now();
    if (task.platformSeconds !== null && credit.seconds === task.platformSeconds) {
      if (this.gradePreviousConfirmedAt !== null) this.gradeUnchangedMs += Math.max(0, Math.min(now - this.gradePreviousConfirmedAt, this.gradePollMs * 2));
    } else this.gradeUnchangedMs = 0;
    this.gradePreviousConfirmedAt = now; this.gradeFailures = 0; this.nextGradeReadAt = initial ? now + this.gradePollMs : Math.max(startedAt + this.gradePollMs, now + 1000);
    this.creditNote(task, ''); return credit;
  }
  async start(input) {
    await this.ready();
    if (this.operation || this.controlPending || this.active()) throw conflict('已有学习时长任务或窗口操作，请先完成或停止。');
    const course = this.course(input.courseId);
    if (!Number.isInteger(input.targetMinutes) || input.targetMinutes < 1 || input.targetMinutes > 1440) throw new Error('目标时长请填写 1～1440 之间的整数分钟。');
    if (!['session', 'platform-add', 'platform-total'].includes(input.mode)) throw new Error('请选择有效的时长目标。');
    if (typeof input.keepAlive !== 'boolean') throw new Error('定期活动开关无效。');
    if (typeof input.unitId !== 'string' || typeof input.entryKey !== 'string' || input.unitId.length > 200 || input.entryKey.length > 5000) throw new Error('请先读取并选择学习单元和页面。');
    const catalog = this.catalog;
    const unit = catalog?.courseId === course.id && catalog.unitId === input.unitId && catalog.units.find(unit => unit.id === input.unitId);
    const entry = unit && catalog.entries.find(entry => entry.key === input.entryKey);
    if (!entry) throw new Error('请先读取当前课程的单元和学习页面。');
    const now = this.now(), task = { id: randomUUID(), courseId: course.id, courseTitle: studyCourseLabel(course), unitId: unit.id, unitLabel: unit.label,
      entryKey: entry.key, entryTitle: entry.title, mode: input.mode, targetMinutes: input.targetMinutes, keepAlive: input.keepAlive,
      status: 'waiting', createdAt: now, updatedAt: now, elapsedMs: 0, interruptedMs: 0, recoveries: 0, lastCheckedAt: 0,
      baselineSeconds: null, platformSeconds: null, platformCheckedAt: null, creditKey: '', creditSource: '', creditLabel: '', creditNote: '', pageTitle: '', logs: [] };
    this.storage.tasks.unshift(task); this.storage.tasks = this.storage.tasks.slice(0, 30);
    this.storage.log(task, `正在打开 ${task.unitLabel} / ${task.entryTitle}。`);
    try { await this.storage.save(); } catch (error) { task.status = 'failed'; throw error; }
    this.prepare(task, course, false); return copy(task);
  }
  prepare(task, course, resume) {
    this.operation = resume ? '恢复学习页面' : '打开学习页面';
    this.nextGradeReadAt = 0; this.nextPageCreditReadAt = 0; this.gradeFailures = 0; this.gradePreviousConfirmedAt = null; this.gradeUnchangedMs = 0;
    const controller = new AbortController(); this.controller = controller;
    this.preparing = Promise.resolve().then(async () => {
      const report = resume ? await this.browser.resume(course, task, controller.signal) : await this.browser.openActivity(course, task, controller.signal);
      controller.signal.throwIfAborted();
      if (!report.ready || report.notices?.length) throw new Error(report.issue || '学习页面尚未就绪。');
      if (task.mode !== 'session' && !report.credit && !task.creditKey) this.storage.log(task, '学习页未显示已学时长，正在读取综合成绩中的本教材必修学习时长。');
      const credit = await this.taskCredit(task, report, controller.signal, true);
      controller.signal.throwIfAborted();
      if (task.mode !== 'session' && !credit && task.baselineSeconds === null) throw new Error('尚未核对平台时长，请稍后点击「继续学习」。');
      if (task.mode !== 'session' && !credit && task.creditSource !== 'grades') throw new Error('原任务页面的时长统计暂未恢复，请核对后继续。');
      this.acceptCredit(task, credit, true);
      const now = this.now(); this.lastKeepAliveAt = now; this.lastCreditGrowthAt = now; this.lastCreditReadAt = now;
      this.nativeRecoveryTotal = report.nativeRecoveries || 0;
      this.clock = new StudyTimeClock(); this.clock.sample(now, this.monotonic(), true);
      task.status = 'running'; task.pageTitle = report.title || task.entryTitle; task.lastCheckedAt = now;
      this.storage.log(task, resume ? '学习页面已恢复，继续累计本次任务。' : '学习页面已就绪，开始驻留并检测停计时提示。');
      if (task.mode !== 'session') this.storage.log(task, '平台时长每 2 分钟核对一次，精确到秒；成绩查询期间继续累计正常驻留。');
      if (task.keepAlive) this.storage.log(task, '已启用每 20 分钟一次的轻量页面活动，同时持续检测超时提示。');
      await this.persist(); controller.signal.throwIfAborted();
      if ((task.mode === 'session' || credit) && studyTimeGoalReached(task)) await this.finish(task); else this.schedule();
    }).catch(async error => {
      if (controller.signal.aborted || ['stopped', 'paused', 'interrupted'].includes(task.status)) return;
      task.status = 'review'; this.storage.log(task, error.message || '学习任务需要核对。', 'warning');
      if (!error.preservePage) await this.browser.suspend().catch(() => {}); await this.storage.save().catch(() => {});
    }).finally(() => { this.preparing = null; this.operation = ''; });
  }
  acceptCredit(task, credit, initial = false) {
    if (!credit) return;
    if (task.creditKey && task.creditKey !== credit.key) throw new Error('页面的时长统计范围发生变化，请核对后继续。');
    if (task.platformSeconds !== null && credit.seconds < task.platformSeconds) throw new Error('平台时长比上次读取值减少，可能切换了统计范围，请核对后继续。');
    const now = this.now();
    if (task.platformSeconds === null || credit.seconds > task.platformSeconds) this.lastCreditGrowthAt = now;
    if (task.baselineSeconds === null) task.baselineSeconds = credit.seconds;
    task.platformSeconds = credit.seconds; task.platformCheckedAt = now; task.creditKey = credit.key; this.lastCreditReadAt = now;
    task.creditSource = credit.source || 'page'; task.creditLabel = credit.label || ''; this.creditNote(task, '');
    if (initial && task.mode !== 'session') this.storage.log(task, `已读取平台时长：${duration(credit.seconds)}（${credit.label}）。`);
  }
  async reviewTask(task, error, signal) {
    if (signal?.aborted || task.status !== 'running' || this.finishingTask === task.id) return;
    task.status = 'review'; clearTimeout(this.timer); this.controller?.abort(error);
    this.storage.log(task, error.message || '学习任务需要核对。', 'warning');
    if (!error.preservePage) await this.browser.suspend().catch(() => {});
    await this.storage.save().catch(() => {});
  }
  checkGrades(task, report, signal) {
    if (this.gradeCheckPending || this.now() < this.nextGradeReadAt || task.status !== 'running' || signal?.aborted || this.finishingTask) return;
    // This work owns a separate tab. Do not make the page/dwell poll await it.
    const recoveryCount = task.recoveries;
    this.gradeCheckPending = Promise.resolve().then(async () => {
      const credit = await this.taskCredit(task, report, signal); signal?.throwIfAborted();
      if (task.status !== 'running' || this.finishingTask) return;
      if (task.recoveries !== recoveryCount) { this.nextGradeReadAt = this.now(); return; }
      this.acceptCredit(task, credit);
      if (this.gradeUnchangedMs >= this.gradeStallMs) throw new Error('综合成绩多次核对仍未增长，平台可能延迟更新，请核对必修学习时长后继续。');
      if (credit && studyTimeGoalReached(task)) await this.finish(task);
      else await this.persist();
    }).catch(error => this.reviewTask(task, error, signal)).finally(() => { this.gradeCheckPending = null; });
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.closing || this.finishingTask || this.active()?.status !== 'running') return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, this.pollMs); this.timer.unref?.();
  }
  async tick() {
    if (this.tickPending) return this.tickPending;
    const task = this.active(), signal = this.controller?.signal;
    if (!task || task.status !== 'running' || signal?.aborted || this.closing || this.finishingTask) return;
    this.tickPending = this.observe(task, signal).catch(error => this.reviewTask(task, error, signal)).finally(() => { this.tickPending = null; this.schedule(); });
    return this.tickPending;
  }
  async observe(task, signal) {
    const sessionRecovered = await this.browser.recoverSessionNotice?.(signal) || 0; signal?.throwIfAborted();
    if (sessionRecovered) this.storage.log(task, '已确认课程首页的长时间未操作提示，恢复学习。');
    let report = await this.browser.read(signal); signal?.throwIfAborted();
    if (task.status !== 'running' || this.finishingTask) return;
    let recovered = sessionRecovered + Math.max(0, (report.nativeRecoveries || 0) - this.nativeRecoveryTotal);
    this.nativeRecoveryTotal = report.nativeRecoveries || 0;
    const hadNotice = !!report.notices?.length;
    if (hadNotice) {
      const result = await this.browser.recover(report, signal); report = result.report; recovered += result.recovered;
      signal?.throwIfAborted();
      if (task.status !== 'running' || this.finishingTask) return;
      if (result.recovered) this.storage.log(task, '已正常确认长时间未操作提示，恢复学习。');
      else this.storage.log(task, '已确认学习时间说明，继续驻留。');
    }
    if (!report.ready || report.notices?.length) throw Object.assign(new Error(report.issue || '学习页面暂时无法继续计时，请核对后继续。'), { preservePage: !!(report.notices?.length || report.hasAnswerControls || report.login) });
    const now = this.now(), sample = this.clock.sample(now, this.monotonic(), !hadNotice && !recovered);
    task.elapsedMs += sample.elapsedMs; task.interruptedMs += sample.interruptedMs; task.recoveries += recovered;
    task.lastCheckedAt = now; task.pageTitle = report.title || task.entryTitle;
    if (recovered) {
      this.gradeUnchangedMs = 0; this.gradePreviousConfirmedAt = null; this.nextGradeReadAt = now; this.nextPageCreditReadAt = now;
      this.creditNote(task, '已确认停计时提示，正在核对平台时长是否恢复。');
    }
    if (sample.gap && !hadNotice && !recovered) this.storage.log(task, '检测到休眠、时钟变化或较长响应中断，该段时间未计入驻留。', 'warning');
    let credit = null;
    if (task.creditSource === 'grades' && task.mode !== 'session') this.checkGrades(task, report, signal);
    else credit = await this.taskCredit(task, report, signal);
    signal?.throwIfAborted();
    if (task.status !== 'running' || this.finishingTask) return;
    this.acceptCredit(task, credit);
    if (task.mode !== 'session') {
      if (task.creditSource !== 'grades' && (now - this.lastCreditReadAt > this.creditStallMs || now - this.lastCreditGrowthAt > this.creditStallMs)) throw new Error('多个核对周期内平台时长未增长，请检查页面是否仍在记录学习时长。');
    }
    if ((task.mode === 'session' || credit) && studyTimeGoalReached(task)) { await this.finish(task); return; }
    if (task.keepAlive && now - this.lastKeepAliveAt >= this.keepAliveMs) {
      if (await this.browser.keepAlive(signal)) { this.lastKeepAliveAt = now; this.storage.log(task, '已进行一次轻量页面活动。'); }
    }
    if (recovered || hadNotice || sample.gap || now - this.lastSavedAt >= 10000) await this.persist();
  }
  async persist() { await this.storage.save(); this.lastSavedAt = this.now(); }
  captureDwell(task) {
    const now = this.now();
    if (task.status === 'running' && this.clock?.previous?.eligible && now - task.lastCheckedAt <= 6000) {
      const sample = this.clock.sample(now, this.monotonic(), true);
      task.elapsedMs += sample.elapsedMs; task.interruptedMs += sample.interruptedMs;
    }
  }
  async finish(task) {
    clearTimeout(this.timer); if (task.status !== 'running' || this.finishingTask) return;
    this.captureDwell(task);
    this.finishingTask = task.id;
    try {
      await this.browser.stop(); if (task.status !== 'running') return; task.status = 'completed';
      this.storage.log(task, task.mode === 'session' ? '本次驻留目标已达到，已退出学习页面。平台实际记录时长请在 U校园核对。' : '平台显示的学习时长已达到目标，已退出学习页面。');
      await this.persist();
    } finally { this.finishingTask = ''; }
  }
  async control(id, action) {
    await this.ready();
    const task = this.storage.tasks.find(task => task.id === id);
    if (!task || !studyLiveStatuses.has(task.status)) throw conflict('该学习时长任务已结束。');
    if (this.controlPending) throw conflict('学习时长任务正在处理操作，请稍候。');
    if (action === 'resume') {
      if (this.operation || !['paused', 'review', 'interrupted'].includes(task.status)) throw conflict('当前学习时长任务无法继续。');
      await this.gradeCheckPending;
      const course = this.course(task.courseId); task.status = 'waiting'; this.storage.log(task, '正在重新核对学习页面。');
      await this.persist(); this.prepare(task, course, true); return copy(task);
    }
    if (!['pause', 'stop'].includes(action) || action === 'pause' && task.status !== 'running') throw conflict('当前学习时长任务无法执行此操作。');
    this.controlPending = true;
    try {
      this.captureDwell(task);
      task.status = action === 'pause' ? 'paused' : 'stopped'; clearTimeout(this.timer); this.controller?.abort();
      await this.preparing; await this.tickPending; await this.gradeCheckPending;
      if (action === 'pause') await this.browser.suspend(); else await this.browser.stop();
      this.clock = null;
      this.storage.log(task, action === 'pause' ? '任务已暂停，并已离开计时页面；暂停期间不累计驻留。' : '学习时长任务已停止。');
      await this.persist(); return copy(task);
    } finally { this.controlPending = false; }
  }
  disconnected() {
    const task = this.active(); if (!task || this.closing) return;
    clearTimeout(this.timer); this.controller?.abort(); task.status = 'review'; this.clock = null;
    this.storage.log(task, '学习窗口已关闭。请重新打开学习窗口，登录后继续。', 'warning');
    void this.storage.save().catch(() => {});
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; clearTimeout(this.timer); this.controller?.abort(); this.catalogController?.abort(); this.progressController?.abort();
    this.closePromise = (async () => {
      await this.preparing; await this.tickPending; await this.gradeCheckPending; await this.progressPending?.catch(() => {}); await this.browser.close();
      if (this.loading) await this.loading.catch(() => {});
      if (this.loaded) {
        const task = this.active();
        if (task) { task.status = 'interrupted'; this.storage.log(task, '服务已关闭，任务记录已保存；下次可继续。'); }
        await this.storage.save();
      }
    })();
    return this.closePromise;
  }
}
