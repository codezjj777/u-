import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { studyText, parseStudyDuration } from './study-time-dom.mjs';

const review = message => Object.assign(new Error(message), { code: 'STUDY_TIME_REVIEW' });
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;
export const studyTimeGroupKey = course => course.group && ['name', 'className', 'period'].every(key => validText(course.group[key]))
  ? JSON.stringify(['group', ...['name', 'className', 'period'].map(key => studyText(course.group[key]))]) : JSON.stringify(['course', course.id]);

/** A task measures its selected textbook, never the sum of the other books. */
export function studyTimeGradeCredit(course, report) {
  if (report?.key !== studyTimeGroupKey(course)) throw review('综合成绩的班级或记分周期与所选课程不一致，未用于任务计时。');
  const matches = report.books?.filter(book => studyText(book.title) === studyText(course.title)) || [];
  if (matches.length !== 1 || !Number.isFinite(matches[0].seconds) || matches[0].seconds < 0 || !Number.isFinite(report.checkedAt)) throw review('综合成绩未找到所选教材的完整学习时长，请核对教材名称后继续。');
  const key = 'grades:' + createHash('sha256').update(JSON.stringify([report.key, studyText(course.title)])).digest('hex');
  return { key, seconds: matches[0].seconds, label: '综合成绩 · 本记分周期本教材必修学习时长', source: 'grades' };
}

/** Evaluated only inside a temporary, study-owned tab. Never reads answer pages. */
export function readStudyTimeGradesFromDOM() {
  const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (!el || ![...el.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
    for (let node = el; node; node = node.parentElement) { const css = getComputedStyle(node); if (node.hidden || node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false; }
    return true;
  };
  const text = el => clean(el?.textContent);
  const fullText = el => clean(el?.getAttribute('title') || el?.querySelector('[title]')?.getAttribute('title') || el?.getAttribute('aria-label') || el?.textContent);
  const cellList = row => {
    const cells = [...row.children].filter(el => visible(el) && !el.matches('script,style'));
    return cells.length >= 2 ? cells : [];
  };
  const tables = root => {
    const found = [];
    for (const table of root.querySelectorAll('table,[role="table"],[class*="table"],[class*="Table"]')) {
      if (!visible(table)) continue;
      const rows = [...table.querySelectorAll('tr,[role="row"],[class*="row"],[class*="Row"]')].filter(visible).map(cellList).filter(cells => cells.length >= 2);
      if (!rows.length) continue;
      found.push(rows);
    }
    return found;
  };
  const actions = (root, label) => [...(root?.querySelectorAll('button,a,[role="tab"],[role="button"],li,div,span') || [])]
    .filter(el => visible(el) && text(el) === label && !el.matches(':disabled,[aria-disabled="true"]'))
    .filter((el, _, all) => !all.some(child => child !== el && el.contains(child)));
  const mark = (elements, key) => {
    if (elements.length !== 1) return null;
    elements[0].setAttribute('data-study-time-grade', key); return `[data-study-time-grade="${key}"]`;
  };
  document.querySelectorAll('[data-study-time-grade]').forEach(el => el.removeAttribute('data-study-time-grade'));
  const result = { login: [...document.querySelectorAll('input[type="password"]')].some(visible), loading: [...document.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible), tabSelector: null, detailSelector: null, summaryValue: null, books: [], detailOpen: false, incomplete: false, ambiguous: false };
  const dialogs = [...document.querySelectorAll('[role="dialog"],.ant-modal,[class*="dialog"][class*="content"],[class*="Dialog"][class*="content"],[class*="modal"][class*="content"]')].filter(visible);
  // Some textbook editions expose a custom popup without a dialog role.
  // Locate its own heading and table rather than broadening to the page body.
  if (!dialogs.length) for (const heading of document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="Title"]')) {
    if (!visible(heading) || text(heading) !== '必修学习时长') continue;
    for (let root = heading.parentElement, depth = 0; root && root !== document.body && depth < 6; root = root.parentElement, depth++) {
      if (['教程名称', '百分制得分', '权重占比'].every(label => text(root).includes(label))) { dialogs.push(root); break; }
    }
  }
  const roots = [...new Set(dialogs)].filter(el => !dialogs.some(parent => parent !== el && parent.contains(el)));
  const details = roots.filter(root => /必修学习时长/.test(text(root)) && /教程名称/.test(text(root)) && /百分制得分/.test(text(root)));
  if (details.length > 1) { result.ambiguous = true; return result; }
  if (details.length === 1) {
    const root = details[0], candidates = [];
    result.detailOpen = true;
    for (const rows of tables(root)) {
      const headers = rows.find(cells => ['教程名称', '必修学习时长', '百分制得分', '权重占比'].every(label => cells.some(cell => text(cell) === label)));
      if (!headers) continue;
      const index = label => headers.findIndex(cell => text(cell) === label);
      const books = rows.filter(cells => cells !== headers && cells.length >= headers.length).map(cells => ({ title: fullText(cells[index('教程名称')]), value: text(cells[index('必修学习时长')]), score: text(cells[index('百分制得分')]), weight: text(cells[index('权重占比')]) })).filter(row => row.title && !['教程名称', '合计', '总计'].includes(row.title));
      if (books.length) candidates.push(books);
    }
    const unique = [...new Map(candidates.map(rows => [JSON.stringify(rows), rows])).values()];
    if (unique.length !== 1) { result.ambiguous = true; return result; }
    result.books = unique[0];
    const count = text(root).match(/共\s*(\d+)\s*条(?:数据|记录)?/);
    result.incomplete = !!count && +count[1] !== result.books.length;
    const next = [...root.querySelectorAll('button,a,li')].some(el => visible(el) && /下一页|next/i.test([el.getAttribute('aria-label'), el.getAttribute('title'), el.className].join(' ')) && !el.matches(':disabled,[aria-disabled="true"],[class*="disabled"]') && !el.closest('[aria-disabled="true"],[class*="disabled"]'));
    result.incomplete ||= next;
    return result;
  }
  const summaries = [];
  for (const rows of tables(document)) {
    const headers = rows.find(cells => ['考核项', '完成情况', '操作'].every(label => cells.some(cell => text(cell) === label)));
    if (!headers) continue;
    const item = headers.findIndex(cell => text(cell) === '考核项'), value = headers.findIndex(cell => text(cell) === '完成情况'), operation = headers.findIndex(cell => text(cell) === '操作');
    for (const cells of rows) if (cells !== headers && text(cells[item]) === '必修学习时长') summaries.push({ value: text(cells[value]), actions: actions(cells[operation], '查看详情') });
  }
  const unique = [...new Map(summaries.map(row => [row.value + '|' + row.actions.map(el => el.outerHTML).join(''), row])).values()];
  if (unique.length > 1) { result.ambiguous = true; return result; }
  if (unique.length === 1) { result.summaryValue = unique[0].value; result.detailSelector = mark(unique[0].actions, 'detail'); }
  result.tabSelector = mark(actions(document, '综合成绩'), 'tab');
  return result;
}

export function normalizeStudyTimeGrades(course, report, checkedAt = Date.now()) {
  if (report.ambiguous || report.incomplete || !report.detailOpen || !Array.isArray(report.books) || !report.books.length || report.books.length > 200) throw review('学习时长明细不完整，请核对「必修学习时长」详情后重试。');
  const numeric = (value, percent = false) => {
    if (value === null || value === undefined || /^\s*(?:-|—|--|暂无)?\s*$/.test(String(value))) return null;
    const raw = String(value).normalize('NFKC').trim();
    const match = raw.match(percent ? /^(\d+(?:\.\d+)?)\s*%$/ : /^(\d+(?:\.\d+)?)(?:\s*分)?$/);
    if (!match || +match[1] > 100) throw review('平台学习时长得分或权重格式异常，未更新记录。');
    return +match[1];
  };
  const books = report.books.map(row => {
    const title = clean(row.title), seconds = parseStudyDuration(row.value);
    if (!validText(title) || /(?:\.{3}|…)$/.test(title) || seconds === null) throw review('教材名称或学习时长未完整读取，未更新记录。');
    return { title, seconds, percent: numeric(row.score), weight: numeric(row.weight, true) };
  });
  if (new Set(books.map(book => studyText(book.title))).size !== books.length) throw review('学习时长明细包含重名教材，未按顺序猜测教材对应关系。');
  const totalSeconds = books.reduce((sum, book) => sum + book.seconds, 0), summarySeconds = parseStudyDuration(report.summaryValue);
  if (summarySeconds !== null && Math.abs(totalSeconds - summarySeconds) > 2) throw review('学期合计与教材明细尚未一致，请稍后刷新学习时长。');
  return { key: studyTimeGroupKey(course), group: course.group ? { name: course.group.name, className: course.group.className, period: course.group.period } : null, courseId: course.id, checkedAt, totalSeconds, books };
}

/** One temporary tab in the existing window; the current lesson stays untouched. */
export async function readStudyTimeGrades(browser, course, signal) {
  if (!browser.windowOpen) throw Object.assign(new Error('请先在现有 U校园窗口登录，再读取学习时长。'), { status: 409 });
  return browser.runShared(async sharedSignal => {
    const combined = signal && sharedSignal ? AbortSignal.any([signal, sharedSignal]) : signal || sharedSignal;
    const before = new Set(browser.ownedPages);
    try {
      const context = await browser.ensure(); combined?.throwIfAborted();
      let page = await browser.newStudyPage(context);
      await browser.navigate(page, course.url, combined);
      if (course.entry) {
        for (let index = 0; index < course.entry.pageIndex; index++) {
          const report = await browser.courseList(page, null, combined);
          if (!report.nextSelector) throw review('没有找到该学期的课程分页，请重新同步课程。');
          combined?.throwIfAborted(); await report.frame.locator(report.nextSelector).click({ noWaitAfter: true });
          await browser.courseList(page, null, combined, { previous: report.fingerprint });
        }
        const report = await browser.courseList(page, course, combined);
        page = await browser.clickNavigation(page, report.frame, report.entry.selector, combined);
      }
      const deadline = Date.now() + 25000; let clickedTab = false, clickedDetail = false, summaryValue = null, stable = '';
      do {
        combined?.throwIfAborted();
        if (!browser.owns(page) || page.isClosed()) throw review('学习时长读取标签页已关闭或被其他任务接管。');
        await browser.clearIdleNotice?.(page, combined);
        const reports = await browser.readFrames(page, readStudyTimeGradesFromDOM, combined);
        if (reports.some(report => report.login)) throw review('登录已失效，请在当前 U校园窗口登录后刷新学习时长。');
        if (reports.some(report => report.ambiguous)) throw review('综合成绩中存在多组时长明细，请人工核对后重试。');
        const detail = reports.find(report => report.detailOpen && !report.loading && report.books.length);
        if (detail) {
          const key = JSON.stringify([detail.books, detail.incomplete]);
          if (stable === key) return normalizeStudyTimeGrades(course, { ...detail, summaryValue });
          stable = key;
        } else {
          const summary = reports.find(report => report.detailSelector && !report.loading);
          if (summary && !clickedDetail) {
            summaryValue = summary.summaryValue; clickedDetail = true;
            combined?.throwIfAborted(); await summary.frame.locator(summary.detailSelector).click({ noWaitAfter: true });
          } else if (!clickedTab && !clickedDetail) {
            const tab = reports.find(report => report.tabSelector && !report.loading);
            if (tab) { clickedTab = true; combined?.throwIfAborted(); await tab.frame.locator(tab.tabSelector).click({ noWaitAfter: true }); }
          }
        }
        await sleep(browser.pollMs, undefined, { signal: combined });
      } while (Date.now() < deadline);
      throw review('未读到「综合成绩 → 必修学习时长 → 查看详情」，请确认该课程已发布综合成绩。');
    } finally {
      for (const page of browser.ownedPages) if (!before.has(page) && browser.owns(page) && !page.isClosed()) await page.close({ runBeforeUnload: false }).catch(() => {});
    }
  });
}

export class StudyTimeProgressStore {
  constructor(directory) { this.directory = directory; this.reports = []; this.warning = ''; this.queue = Promise.resolve(); }
  async load() {
    try {
      const raw = JSON.parse(await readFile(path.join(this.directory, 'progress.json'), 'utf8'));
      if (raw.version !== 1 || !Array.isArray(raw.reports) || raw.reports.length > 50) throw new Error('invalid');
      this.reports = raw.reports.map(report => {
        if (typeof report.courseId !== 'string' || !report.courseId || report.courseId.length > 2000 || !Number.isFinite(report.checkedAt) || report.checkedAt < 0 || !Array.isArray(report.books)) throw new Error('invalid');
        const course = { id: report.courseId, group: report.group };
        const normalized = normalizeStudyTimeGrades(course, { detailOpen: true, books: report.books.map(book => ({ title: book.title, value: `${book.seconds}秒`, score: book.percent, weight: book.weight === null ? null : `${book.weight}%` })) }, report.checkedAt);
        if (normalized.key !== report.key || normalized.totalSeconds !== report.totalSeconds) throw new Error('invalid');
        return normalized;
      });
    } catch (error) {
      this.reports = [];
      if (error.code !== 'ENOENT') this.warning = '学习时长缓存未能读取，请重新刷新；原文件已保留。';
    }
  }
  async put(report) {
    const next = [report, ...this.reports.filter(item => item.key !== report.key)].slice(0, 50);
    const data = JSON.stringify({ version: 1, reports: next }, null, 2);
    const pending = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, 'progress.tmp'), data, 'utf8');
      await rename(path.join(this.directory, 'progress.tmp'), path.join(this.directory, 'progress.json'));
      this.reports = next; this.warning = '';
    }).catch(() => { throw new Error('学习时长未能保存，请检查磁盘和目录权限。'); });
    this.queue = pending.catch(() => {}); return pending;
  }
  snapshot(courses, now = Date.now()) {
    const groups = [], byCourse = {}, day = new Date(now + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '/');
    for (const course of courses) {
      const key = studyTimeGroupKey(course);
      let group = groups.find(group => group.key === key);
      if (!group) {
        const period = clean(course.group?.period).match(/(\d{4}\/\d{2}\/\d{2})\s*[-~～至]\s*(\d{4}\/\d{2}\/\d{2})/);
        const report = this.reports.find(report => report.key === key);
        group = { key, group: course.group || null, courseId: course.id, courseIds: [], current: !!period && day >= period[1] && day <= period[2], report: report || null };
        groups.push(group);
      }
      group.courseIds.push(course.id);
      const matches = group.report?.books.filter(book => studyText(book.title) === studyText(course.title)) || [];
      if (matches.length === 1) byCourse[course.id] = { ...matches[0], checkedAt: group.report.checkedAt, totalSeconds: group.report.totalSeconds, bookCount: group.report.books.length, groupKey: key };
    }
    return { groups, byCourse, warning: this.warning };
  }
}
