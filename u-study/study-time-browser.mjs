import { setTimeout as sleep } from 'node:timers/promises';
import { createBackgroundPage } from './browser-session.mjs';
import { isStudyTimeURL, studyText, studyEntryMatches, isStudyIdleNotice, studyCredit, readStudyTimePageFromDOM, collectStudyTimeCoursesFromDOM, collectStudyTimeDirectoryFromDOM } from './study-time-dom.mjs';

export const STUDY_TIME_HOME = 'https://ucloud.unipus.cn/app/cmgt/course-management';
// The textbook initializes its fragment after the content has loaded. Course
// parameters remain part of the binding; visible content identity is checked too.
export function studyTimePageAddress(value) { const url = new URL(value); url.hash = ''; return url.href; }
const check = signal => signal?.throwIfAborted();
const closed = page => !page || page.isClosed();
const review = message => Object.assign(new Error(message), { code: 'STUDY_TIME_REVIEW', preservePage: true });
const waitingForContent = () => ({ ready: false, loading: true, transient: true, notices: [], statistics: [], credit: null,
  hasAnswerControls: false, login: false, title: '', crumbs: [], contentPresent: false,
  issue: '学习页面正在跳转或加载，正在等待内容就绪。' });
const withDeadline = async (promise, timeoutMs, signal) => {
  let timer, abort;
  try {
    check(signal);
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(review('学习窗口暂时没有响应，请核对窗口后继续。')), timeoutMs);
      abort = () => reject(signal.reason); signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
};

// Use the host's existing session without replacing its methods or settings.
export function sharedStudyTimeBrowserAccess(automation) {
  return {
    existingContext: () => automation.context || null,
    isIdle: () => !automation.busy?.() && !automation.store?.syncing && !automation.store?.catalogLoading && !automation.catalogLoading && !automation.operations?.active,
    canOperatePage: page => !automation.pages?.records?.has(page) && ![...(automation.taskPages?.values() || [])].includes(page),
    canConfirmSessionNotice: page => {
      if (automation.busy?.() || automation.store?.syncing || automation.store?.catalogLoading || automation.catalogLoading || automation.operations?.active || [...(automation.taskPages?.values() || [])].includes(page)) return false;
      const record = automation.pages?.records?.get(page);
      if (record && (record.role !== 'home' || record.protected)) return false;
      try { const url = new URL(page.url()); return url.origin === 'https://ucloud.unipus.cn' && /^\/app\/cmgt\/course-management\/?$/.test(url.pathname); } catch { return false; }
    },
    getContext: async () => {
      if (typeof automation.ensureBrowser !== 'function') throw review('请先连接 U校园窗口。');
      return automation.context || automation.ensureBrowser();
    },
    runShared: async work => {
      if (automation.busy?.() || automation.store?.syncing || automation.store?.catalogLoading || automation.catalogLoading) throw Object.assign(new Error('自动答题或课程读取正在进行，请等待结束后再读取学习单元。'), { status: 409 });
      return automation.operations ? automation.operations.run('catalog', work, { timeoutMs: 60000 }) : work();
    },
  };
}

/** Installed on study-owned pages only. Site links stay in the same tab. */
export function keepStudyNavigationInTab() {
  window.open = url => { if (url) location.assign(new URL(String(url), location.href).href); return window; };
  if (window.__uStudyTimeSameTab) return;
  window.__uStudyTimeSameTab = true;
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[target]');
    if (link && !['_self', '_top', '_parent', ''].includes(link.target.toLowerCase())) link.target = '_self';
  }, true);
}

/** Borrows the existing U-campus context and owns only its study tabs. */
export class StudyTimeBrowser {
  constructor(_directory, { getContext, existingContext = () => null, canOperatePage = () => true, canConfirmSessionNotice = () => false, isIdle = () => true, runShared = work => work(), onLost = () => {}, pollMs = 300 } = {}) {
    this.getContext = getContext; this.existingContext = existingContext; this.runShared = runShared; this.onLost = onLost; this.pollMs = pollMs;
    this.canOperatePage = canOperatePage;
    this.canConfirmSessionNotice = canConfirmSessionNotice; this.backgroundRecoveries = 0;
    this.isIdle = isIdle;
    this.context = null; this.launching = null; this.management = null; this.catalog = null; this.binding = null;
    this.nativeRecoveries = 0; this.nativeDialog = null; this.hooked = new WeakSet(); this.reads = new WeakMap(); this.closing = false;
    this.ownedPages = new Set(); this.contextClosed = null;
  }
  get windowOpen() { return !!(this.existingContext() || this.context); }
  get progressAvailable() { return this.windowOpen && this.isIdle(); }
  owns(page) { return this.ownedPages.has(page) && this.canOperatePage(page); }
  attach(page) {
    if (!this.ownedPages.has(page)) return;
    if (this.hooked.has(page)) return; this.hooked.add(page);
    page.on('dialog', dialog => {
      if (['alert', 'confirm'].includes(dialog.type()) && isStudyIdleNotice(dialog.message())) {
        void dialog.accept().then(() => { this.nativeRecoveries++; }).catch(() => {});
      } else this.nativeDialog = { page, message: dialog.message().slice(0, 300) };
    });
  }
  async ensure() {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    this.closing = false;
    this.launching = (async () => {
      if (typeof this.getContext !== 'function') throw review('学习功能尚未连接现有 U校园窗口。');
      const context = await this.getContext();
      if (!context) throw review('请先连接 U校园窗口。');
      this.context = context;
      this.contextClosed = () => {
        const hadBinding = !!this.binding;
        this.context = null; this.management = null; this.catalog = null; this.binding = null; this.nativeDialog = null;
        this.ownedPages.clear();
        if (!this.closing && hadBinding) this.onLost();
      };
      context.on('close', this.contextClosed);
      return context;
    })();
    try { return await this.launching; } finally { this.launching = null; }
  }
  async show() {
    const context = await this.ensure();
    const page = !closed(this.binding?.page) ? this.binding.page : !closed(this.catalog?.page) ? this.catalog.page : context.pages().find(page => !closed(page)) || await context.newPage();
    if (page.url() === 'about:blank') await this.runShared(() => page.goto(STUDY_TIME_HOME, { waitUntil: 'domcontentloaded', timeout: 25000 }));
    if (page.url() === STUDY_TIME_HOME && this.ownedPages.has(page)) this.management = page;
    let session;
    try {
      session = await context.newCDPSession(page);
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
      if (bounds?.windowState === 'minimized') await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    } catch {} finally { await session?.detach().catch(() => {}); }
    await page.bringToFront(); return { windowOpen: true };
  }
  async newStudyPage(context) {
    const page = await createBackgroundPage(context);
    this.ownedPages.add(page); this.attach(page);
    page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(25000);
    await page.addInitScript(keepStudyNavigationInTab); await page.evaluate(keepStudyNavigationInTab);
    page.once('close', () => { this.ownedPages.delete(page); });
    return page;
  }
  async frames(page) {
    if (closed(page)) throw review('学习窗口已关闭，请重新打开学习窗口。');
    const frames = [];
    for (const frame of page.frames()) {
      if (!isStudyTimeURL(frame.url())) continue;
      if (frame !== page.mainFrame()) {
        const element = await frame.frameElement().catch(() => null);
        if (!element) continue;
        try { if (!await element.isVisible() || await element.evaluate(el => !!el.closest('[hidden],[aria-hidden="true"],[inert]'))) continue; }
        finally { await element.dispose(); }
      }
      frames.push(frame);
    }
    return frames;
  }
  async evaluate(frame, reader, signal, args) {
    check(signal);
    let readers = this.reads.get(frame);
    if (!readers) { readers = new Map(); this.reads.set(frame, readers); }
    let entries = readers.get(reader);
    if (!(entries instanceof Map)) { entries = new Map(); readers.set(reader, entries); }
    const key = JSON.stringify(args ?? null); let pending = entries.get(key);
    if (!pending) {
      pending = frame.evaluate(reader, args); entries.set(key, pending);
      pending.finally(() => { if (entries.get(key) === pending) entries.delete(key); }).catch(() => {});
    }
    return withDeadline(pending, 6000, signal);
  }
  async readFrames(page, reader, signal, args) {
    const found = [];
    for (const frame of await this.frames(page)) {
      check(signal);
      try { found.push({ ...await this.evaluate(frame, reader, signal, args), frame }); }
      catch (error) { check(signal); if (closed(page)) throw review('学习窗口已关闭。'); if (!/context.*destroyed|detached|navigation/i.test(error.message)) throw error; }
    }
    return found;
  }
  async navigate(page, url, signal) {
    if (!this.owns(page)) throw review('当前标签页已由自动答题接管，学习操作已停止。');
    check(signal); if (!isStudyTimeURL(url)) throw new Error('学习页面必须是 U校园的 HTTPS 地址。');
    await withDeadline(page.goto(url, { waitUntil: 'domcontentloaded' }), 26000, signal); check(signal);
    if (!isStudyTimeURL(page.url())) throw review('学习窗口跳转到了其他网站，请核对登录状态。');
  }
  async clickNavigation(page, frame, selector, signal, { activity = false } = {}) {
    if (!this.owns(page)) throw review('学习功能只能操作自己的学习标签页。');
    await frame.evaluate(keepStudyNavigationInTab);
    const before = page.url(); let popup;
    const onPopup = value => { popup = value; this.ownedPages.add(value); this.attach(value); }; page.on('popup', onPopup);
    try {
      check(signal); await frame.locator(selector).click({ timeout: 5000, noWaitAfter: true });
      const deadline = Date.now() + 20000;
      do {
        check(signal); const target = popup || page;
        if (closed(target)) throw review('学习窗口已关闭。');
        if (isStudyTimeURL(target.url()) && (popup || target.url() !== before)) {
          await withDeadline(target.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}), 6000, signal); return target;
        }
        const reports = await this.readFrames(target, collectStudyTimeDirectoryFromDOM, signal);
        if (!activity && reports.some(report => report.units.length)) return target;
        const content = await this.readFrames(target, readStudyTimePageFromDOM, signal);
        if (content.some(report => report.ready)) return target;
        await sleep(this.pollMs, undefined, { signal });
      } while (Date.now() < deadline);
      throw review('点击后尚未进入学习内容，请核对学习窗口。');
    } catch (error) {
      if (signal?.aborted && activity) {
        const target = popup || (page.url() !== before ? page : null);
        if (!closed(target)) await target.close({ runBeforeUnload: false }).catch(() => {});
      }
      throw error;
    } finally { page.off('popup', onPopup); }
  }
  async courseList(page, course, signal, { previous } = {}) {
    const deadline = Date.now() + 20000;
    do {
      await this.clearIdleNotice(page, signal);
      for (const report of await this.readFrames(page, collectStudyTimeCoursesFromDOM, signal)) {
        if (report.login) throw review('请在当前 U校园窗口完成登录后，再读取单元。');
        if (!report.entries.length || report.fingerprint === previous) continue;
        if (!course) return report;
        const sourceId = course.id.startsWith('course-') ? course.id.slice(7) : course.id.startsWith('group:') ? course.id.split('|').at(-1) : '';
        const matches = report.entries.filter(entry => (!sourceId || entry.sourceId === sourceId) && studyText(entry.title) === studyText(course.entry?.title || course.title) &&
          (!course.group || ['name', 'className', 'period'].every(key => studyText(entry.group?.[key]) === studyText(course.group[key]))));
        if (matches.length > 1) throw review('学习窗口中存在同班级、同记分周期的重名课程，请核对课程。');
        if (matches.length === 1) return { ...report, entry: matches[0] };
      }
      await sleep(this.pollMs, undefined, { signal });
    } while (Date.now() < deadline);
    throw review(course ? 'U校园窗口未找到所选课程，请核对当前账号和课程列表。' : '课程列表尚未载入，请核对网络和登录。');
  }
  async openCourse(course, signal) {
    if (this.catalog?.courseId === course.id && !closed(this.catalog.page) && this.catalog.page.url() === this.catalog.url) return this.catalog.page;
    const context = await this.ensure(); check(signal);
    let page;
    if (course.entry) {
      page = closed(this.management) ? await this.newStudyPage(context) : this.management; this.management = page;
      await this.navigate(page, course.url, signal);
      for (let index = 0; index < course.entry.pageIndex; index++) {
        const report = await this.courseList(page, null, signal);
        if (!report.nextSelector) throw review('学习窗口没有找到课程所在分页，请重新同步课程。');
        check(signal); await report.frame.locator(report.nextSelector).click({ noWaitAfter: true });
        await this.courseList(page, null, signal, { previous: report.fingerprint });
      }
      const report = await this.courseList(page, course, signal);
      page = await this.clickNavigation(page, report.frame, report.entry.selector, signal);
      if (page === this.management) this.management = null;
    } else {
      page = await this.newStudyPage(context); await this.navigate(page, course.url, signal);
    }
    this.catalog = { courseId: course.id, page, url: page.url() }; return page;
  }
  async loadCatalog(course, unitId, signal) {
    return this.runShared(sharedSignal => this.readCatalog(course, unitId, signal && sharedSignal ? AbortSignal.any([signal, sharedSignal]) : signal || sharedSignal));
  }
  async readCatalog(course, unitId, signal) {
    const page = await this.openCourse(course, signal), deadline = Date.now() + 25000;
    let switched = false, previousHeading = '', stable = '', expansions = 0;
    do {
      const directories = await this.readFrames(page, collectStudyTimeDirectoryFromDOM, signal);
      const report = directories.find(report => report.units.length);
      if (report) {
        const selected = unitId || report.unitId || report.units[0]?.id;
        const unit = report.units.find(unit => unit.id === selected);
        if (!unit) throw review('学习目录中没有所选单元，请重新读取单元。');
        if (report.unitId !== selected) {
          if (!switched) { previousHeading = report.heading; check(signal); await report.frame.locator(unit.selector).click({ noWaitAfter: true }); switched = true; }
        } else if (!report.loading && (!switched || !previousHeading || report.heading && report.heading !== previousHeading)) {
          if (report.collapsed.length) {
            if (++expansions > 100) throw review('学习目录尚未完整展开，请核对窗口。');
            check(signal); await report.frame.locator(report.collapsed[0]).click({ noWaitAfter: true });
          } else if (report.entries.length && !report.entries.every(entry => entry.locked)) {
            const key = JSON.stringify([report.unitId, report.heading, report.entries.map(entry => [entry.key, entry.locked])]);
            if (stable === key) {
              const entries = report.entries.filter(entry => !entry.locked && (entry.preferred || !/exercise|quiz|assessment|口语|练习|测验|测试/i.test(entry.title)));
              if (!entries.length) throw review('所选单元没有可驻留的学习页面，请在学习窗口打开学习目标页后重试。');
              return { courseId: course.id, units: report.units.map(({ id, label }) => ({ id, label })), unitId: selected,
                entries: entries.map(({ key, title, path, preferred }) => ({ key, title, path, preferred })), report, page };
            }
            stable = key;
          }
        }
      } else {
        const reports = await this.readFrames(page, readStudyTimePageFromDOM, signal);
        if (reports.some(report => report.login)) throw review('请在当前 U校园窗口完成登录后，再读取单元。');
        const current = reports.find(report => report.ready && /learning objectives|学习目标/i.test([report.title, ...report.crumbs].join(' ')));
        if (current) return { courseId: course.id, unitId: 'current', units: [{ id: 'current', label: current.crumbs.at(-2) || '当前学习页' }],
          entries: [{ key: 'current', title: current.title || 'Learning objectives', path: [], preferred: true }], page, current: true };
      }
      await sleep(this.pollMs, undefined, { signal });
    } while (Date.now() < deadline);
    throw review('学习目录仍在加载，请核对学习窗口后重新读取。');
  }
  async openActivity(course, task, signal) {
    this.nativeDialog = null;
    const catalog = await this.loadCatalog(course, task.unitId, signal);
    let page = catalog.page;
    if (!catalog.current) {
      const target = catalog.report.entries.filter(entry => entry.key === task.entryKey && !entry.locked);
      if (target.length !== 1) throw review('所选学习页面已变化，请重新读取单元。');
      page = await this.clickNavigation(page, catalog.report.frame, target[0].selector, signal, { activity: true });
      if (page === catalog.page) this.catalog = null;
    } else if (task.entryKey !== 'current') throw review('学习页面与原任务不一致，请重新选择。');
    this.binding = { page, url: page.url(), frameURL: '', identity: '', expectedTitle: task.entryTitle, pending: true, suspended: false };
    return this.waitForActivity(page, task, signal);
  }
  async waitForActivity(page, task, signal) {
    const deadline = Date.now() + 20000; let stable = '';
    do {
      check(signal);
      if (closed(page) || !this.owns(page)) throw review('学习标签页已关闭或被其他任务接管，请核对后继续。');
      const report = await this.inspect(page, signal);
      if (report.notices.some(notice => notice.kind !== 'unknown' && notice.selector)) {
        stable = ''; await this.dismissNotice(page, report, signal); await sleep(this.pollMs, undefined, { signal }); continue;
      }
      if (report.ready && !report.notices.length) {
        if (!studyEntryMatches(task.entryTitle, report)) throw review('打开的学习内容与所选页面不一致，请重新选择。');
        const routeUnit = page.url().match(/\/courseware\/([^/?#]+)/)?.[1];
        if (task.unitId !== 'current' && routeUnit && routeUnit !== task.unitId.replace(/^id-/, '').replace(/-tab$/, '')) throw review('学习页面进入了其他单元，请重新选择。');
        const identity = JSON.stringify([report.title, report.crumbs]), key = JSON.stringify([studyTimePageAddress(page.url()), studyTimePageAddress(report.frame.url()), identity]);
        if (stable === key) {
          this.binding = { page, url: page.url(), frameURL: report.frame.url(), identity, suspended: false };
          return report;
        }
        stable = key;
      } else stable = '';
      if (report.hasAnswerControls || report.login || report.notices.length) throw review(report.issue || '学习页面存在需要人工核对的提示。');
      await sleep(this.pollMs, undefined, { signal });
    } while (Date.now() < deadline);
    throw review('学习页面尚未就绪，请在学习窗口选择学习目标等阅读页面。');
  }
  async inspect(page, signal) {
    if (closed(page)) throw review('学习页面已关闭，请重新打开 U校园窗口后继续。');
    if (page.url() === 'about:blank' || page.url().startsWith('about:blank#ustudy-background-')) return waitingForContent();
    if (!isStudyTimeURL(page?.url())) throw review('当前窗口不在所选学习页面，请核对后继续。');
    if (this.nativeDialog?.page === page) return { ready: false, issue: `学习窗口有待核对提示：${this.nativeDialog.message}`, notices: [{ kind: 'unknown', selector: null }], nativeRecoveries: this.nativeRecoveries + this.backgroundRecoveries };
    const reports = await this.readFrames(page, readStudyTimePageFromDOM, signal);
    const main = reports.filter(report => report.ready || report.contentPresent);
    if (main.filter(report => report.ready).length > 1) throw review('多个框架同时显示学习内容，请核对当前学习页。');
    const selected = main.find(report => report.ready) || main[0] || reports[0];
    // A redirect can destroy every execution context while readFrames is in
    // flight. This is a loading sample, not evidence of a failed login.
    if (!selected) return { ...waitingForContent(), nativeRecoveries: this.nativeRecoveries + this.backgroundRecoveries };
    const notices = reports.flatMap(report => report.notices.map(notice => ({ ...notice, frame: report.frame })));
    const blocking = reports.find(report => report.login || report.networkIssue || report.hasAnswerControls);
    return { ...selected, ready: selected.ready && !blocking, hasAnswerControls: reports.some(report => report.hasAnswerControls), issue: blocking?.issue || selected.issue,
      login: reports.some(report => report.login), networkIssue: reports.some(report => report.networkIssue), notices,
      credit: studyCredit(selected.statistics), nativeRecoveries: this.nativeRecoveries + this.backgroundRecoveries };
  }
  async diagnostics() {
    const address = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.origin + url.pathname : url.protocol; } catch { return ''; } };
    const pages = [];
    for (const page of this.ownedPages) {
      if (!this.owns(page) || closed(page)) continue;
      const frames = await this.readFrames(page, readStudyTimePageFromDOM).catch(error => [{ issue: error.message }]);
      pages.push({ address: address(page.url()), bound: this.binding?.page === page, pending: !!this.binding?.pending,
        sameBoundAddress: this.binding?.page === page ? studyTimePageAddress(page.url()) === studyTimePageAddress(this.binding.url) : null,
        frames: frames.map(({ frame, ready, loading, login, networkIssue, contentPresent, hasAnswerControls, title, crumbs, issue, notices }) => ({
          address: address(frame?.url()), ready, loading, login, networkIssue, contentPresent, hasAnswerControls, title, crumbs, issue, notices: notices?.map(({ kind, text }) => ({ kind, text })) })) });
    }
    return { windowOpen: this.windowOpen, pages };
  }
  assertBinding() {
    if (closed(this.binding?.page)) throw review('学习页面已关闭，请重新打开学习窗口后继续。');
    if (!this.owns(this.binding.page)) throw review('当前标签页不属于学习时长任务或已由自动答题接管，已停止操作。');
    if (studyTimePageAddress(this.binding.page.url()) !== studyTimePageAddress(this.binding.url)) throw review('学习页面地址已变化，请核对后继续。');
    if (this.binding.suspended) throw review('学习页面已暂停。');
  }
  async read(signal) {
    this.assertBinding(); const report = await this.inspect(this.binding.page, signal); check(signal); this.assertBinding();
    if (report.ready && this.binding.pending) {
      if (!studyEntryMatches(this.binding.expectedTitle, report)) throw review('当前学习内容与所选页面不一致，请重新选择。');
      this.binding.frameURL = report.frame.url(); this.binding.identity = JSON.stringify([report.title, report.crumbs]); this.binding.pending = false;
    }
    if (report.ready && (studyTimePageAddress(report.frame.url()) !== studyTimePageAddress(this.binding.frameURL) || JSON.stringify([report.title, report.crumbs]) !== this.binding.identity)) throw review('学习内容已切换，请核对所选课程和单元。');
    return report;
  }
  async dismissNotice(page, report, signal) {
    if (!this.owns(page)) throw review('当前标签页不属于学习时长任务，已保留页面提示。');
    const known = report.notices.filter(notice => ['idle', 'unit'].includes(notice.kind) && notice.selector);
    if (report.notices.length !== 1 || known.length !== 1) throw review('学习窗口存在无法确认的提示，请手动处理后继续。');
    const target = known[0]; check(signal);
    await target.frame.locator(target.selector).click({ timeout: 4000, noWaitAfter: true });
    const deadline = Date.now() + 6000;
    do {
      check(signal); const fresh = await this.inspect(page, signal);
      if (!fresh.notices.length) return { report: fresh, recovered: target.kind === 'idle' ? 1 : 0 };
      await sleep(200, undefined, { signal });
    } while (Date.now() < deadline);
    throw review('学习提示尚未确认关闭，请核对学习窗口。');
  }
  async recover(report, signal) {
    this.assertBinding(); return this.dismissNotice(this.binding.page, report, signal);
  }
  async confirmExactNotice(page, signal, permitted) {
    if (closed(page) || !permitted(page) || !isStudyTimeURL(page.url())) return 0;
    const args = { noticeOnly: true, exactIdleOnly: true }, frame = page.mainFrame();
    const report = await this.evaluate(frame, readStudyTimePageFromDOM, signal, args);
    if (!report.notices.length) return 0;
    if (report.notices.length !== 1 || !report.notices[0].selector) throw review('长时间未操作提示的确定按钮不唯一，请手动核对。');
    const before = studyTimePageAddress(page.url()); check(signal);
    if (!permitted(page) || before !== studyTimePageAddress(page.url())) return 0;
    await frame.locator(report.notices[0].selector).click({ timeout: 2000, noWaitAfter: true });
    const deadline = Date.now() + 4000;
    do {
      check(signal);
      const fresh = await this.evaluate(frame, readStudyTimePageFromDOM, signal, args);
      if (!fresh.notices.length) return 1;
      await sleep(150, undefined, { signal });
    } while (Date.now() < deadline);
    throw review('长时间未操作提示尚未关闭，请手动确认后继续。');
  }
  async clearIdleNotice(page, signal) {
    const recovered = await this.confirmExactNotice(page, signal, page => this.owns(page));
    this.backgroundRecoveries += recovered; return recovered;
  }
  async recoverSessionNotice(signal) {
    const context = this.context || this.existingContext(); if (!context) return 0;
    let recovered = 0;
    for (const page of context.pages()) {
      if (this.ownedPages.has(page) || !this.canConfirmSessionNotice(page)) continue;
      recovered += await this.confirmExactNotice(page, signal, page => this.canConfirmSessionNotice(page));
    }
    return recovered;
  }
  async keepAlive(signal) {
    const report = await this.read(signal);
    if (!report.ready || report.notices.length) return false;
    const page = this.binding.page;
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    check(signal); this.assertBinding();
    const x = Math.max(1, Math.min(viewport.width - 2, Math.round(viewport.width * .38))), y = Math.max(1, Math.min(viewport.height - 2, Math.round(viewport.height * .48)));
    await page.mouse.move(x, y); check(signal); await page.mouse.move(x + 1, y + 1);
    return true;
  }
  async suspend() {
    const binding = this.binding;
    if (closed(binding?.page) || binding.suspended) return;
    if (!this.owns(binding.page)) throw review('当前标签页不属于学习时长任务。');
    if (studyTimePageAddress(binding.page.url()) !== studyTimePageAddress(binding.url)) return; // Preserve any manually opened page.
    await withDeadline(binding.page.goto('about:blank#ustudy-study-time-paused'), 6000);
    binding.suspended = true;
  }
  async resume(course, task, signal) {
    this.nativeDialog = null;
    if (this.binding?.suspended && !closed(this.binding.page)) {
      await this.navigate(this.binding.page, this.binding.url, signal); this.binding.suspended = false;
      if (this.binding.pending) return this.waitForActivity(this.binding.page, task, signal);
      const report = await this.read(signal);
      if (report.ready && !report.notices.length) return report;
      if (report.notices.length) { const result = await this.recover(report, signal); if (result.report.ready) return result.report; }
      throw review(report.issue || '学习页面未恢复，请核对后继续。');
    }
    if (this.binding && !closed(this.binding.page)) {
      if (this.binding.pending) return this.waitForActivity(this.binding.page, task, signal);
      const report = await this.read(signal);
      if (report.ready && !report.notices.length) return report;
      if (report.notices.length) { const result = await this.recover(report, signal); if (result.report.ready) return result.report; }
      throw review(report.issue || '学习页面未恢复，请核对后继续。');
    }
    return this.openActivity(course, task, signal);
  }
  async stop() {
    const binding = this.binding; this.binding = null; this.nativeDialog = null;
    if (closed(binding?.page)) return;
    if (this.owns(binding.page) && (binding.suspended || studyTimePageAddress(binding.page.url()) === studyTimePageAddress(binding.url))) await binding.page.close({ runBeforeUnload: false });
  }
  async close() {
    this.closing = true;
    if (this.context && this.contextClosed) this.context.off('close', this.contextClosed);
    this.binding = null;
    for (const page of this.ownedPages) if (this.owns(page) && !closed(page)) await page.close({ runBeforeUnload: false }).catch(() => {});
    this.ownedPages.clear(); this.context = null; this.management = null; this.catalog = null; this.nativeDialog = null;
  }
}
