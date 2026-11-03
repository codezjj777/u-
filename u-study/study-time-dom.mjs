// Independent, read-only page adapters for the study-time feature.
// The only markers written here belong to this feature's notice/page adapters.
export function isStudyTimeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'unipus.cn' || url.hostname.endsWith('.unipus.cn'));
  } catch { return false; }
}

export const studyText = value => String(value || '').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]+/g, '').toLowerCase();
export const studyCourseLabel = course => [course.title, course.group?.name, course.group?.className, course.group?.period].filter(Boolean).join(' · ');
export const studyEntryMatches = (title, report) => !!title && [report.title, ...(report.crumbs || [])].some(value => studyText(value) === studyText(title));

export function isStudyIdleNotice(text) {
  const value = String(text || '').replace(/\s+/g, ' ');
  return /(?:长时间|较长时间|超过\s*\d+\s*分).{0,35}(?:未|没有|无).{0,12}(?:操作|活动|学习|互动)/.test(value) ||
    /(?:未|没有).{0,10}(?:操作|活动).{0,35}(?:暂停|停止).{0,15}(?:学习|计时|时长)/.test(value) ||
    /(?:inactive|inactivity|idle|no activity).{0,100}(?:study|learning|session|time|continue)/i.test(value);
}

export function parseStudyDuration(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text || text.length > 100) return null;
  const clock = text.match(/^(\d{1,5}):(\d{2}):(\d{2})$/);
  if (clock) {
    if (+clock[2] >= 60 || clock[3] !== undefined && +clock[3] >= 60) return null;
    return +clock[1] * 3600 + +clock[2] * 60 + +clock[3];
  }
  const match = text.match(/^(?:(\d+(?:\.\d+)?)\s*(?:小时|时|hours?|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分|minutes?|mins?|m))?\s*(?:(\d+(?:\.\d+)?)\s*(?:秒钟|秒|seconds?|secs?|s))?$/i);
  if (!match || match.slice(1).every(part => part === undefined)) return null;
  const seconds = (+match[1] || 0) * 3600 + (+match[2] || 0) * 60 + (+match[3] || 0);
  return Number.isFinite(seconds) && seconds <= 365 * 86400 ? Math.floor(seconds) : null;
}

export function studyCredit(statistics = []) {
  const found = statistics.map(item => ({ ...item, seconds: parseStudyDuration(item.value) })).filter(item => item.seconds !== null);
  if (!found.length || new Set(found.map(item => JSON.stringify([item.scope, item.seconds]))).size !== 1) return null;
  const { label, scope, seconds } = found[0];
  return { label, scope, seconds, key: JSON.stringify([scope, label]) };
}

/** Full reads run on study tabs; notice-only reads are limited to the course home. */
export function readStudyTimePageFromDOM({ noticeOnly = false, exactIdleOnly = false } = {}) {
  const visible = el => {
    const rects = el?.getClientRects();
    if (!rects?.length || ![...rects].some(rect => rect.width > 0 && rect.height > 0)) return false;
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (node.matches('[hidden],[aria-hidden="true"],[inert]') || css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') return false;
    }
    return true;
  };
  const clean = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const mark = (el, name, value) => { el.setAttribute(name, value); return `[${name}="${value}"]`; };
  const bodyText = clean(document.body);
  const hasExactIdleText = /长时间未操作/.test(bodyText) && /确定继续使用/.test(bodyText);
  if (noticeOnly && exactIdleOnly && !hasExactIdleText) return { notices: [] };
  const loading = document.readyState === 'loading' || [...document.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible);
  const login = [...document.querySelectorAll('input[type="password"]')].some(visible) || /\/(?:login|sso|signin)(?:[/?#]|$)/i.test(location.pathname);
  const networkIssue = /(?:当前网络不给力|网络连接失败|网络异常|服务器连接失败)/.test(bodyText);
  const crumbs = [...document.querySelectorAll('.pc-break-crumb-text,.pc-header-tab-activity,.pc-header-task-activity,[data-study-time-breadcrumb]')].filter(visible).map(clean).filter(Boolean);
  const root = [...document.querySelectorAll('[data-study-time-content],.pc-main-container,.layout-container,main')].find(visible);
  const title = clean(document.querySelector('.pc-header-task-activity,.pc-header-tab-activity')) || clean(root?.querySelector('h1,h2,h3')) || document.title;
  const controls = root ? [...root.querySelectorAll('textarea,input:not([type="hidden"]):not([type="button"]):not([type="range"]),select,[contenteditable="true"],[role="radio"],[role="checkbox"],.option-wrap,.ucomp-recorder')].filter(el => visible(el) && !el.closest('aside,.pc-slider-content,.v3notes,[data-study-time-ignore]')) : [];
  const content = clean(root);
  const learningPage = root?.matches('[data-study-time-content],.pc-main-container,.layout-container') || crumbs.length > 0;
  const ready = !!learningPage && !loading && !login && !networkIssue && !controls.length &&
    (content.length >= 20 || !root && crumbs.length > 0 && /learning objectives|学习目标/i.test(crumbs.join(' ')) && bodyText.length >= 40);
  const exactMessage = text => /^(?:由于)?(?:你|您)长时间未操作[，,]请(?:点|点击)确定继续使用[。.!！]?$/.test(text.replace(/\s+/g, ''));
  const exactPanel = text => /^(?:提示)?(?:由于)?(?:你|您)长时间未操作[，,]请(?:点|点击)确定继续使用[。.!！]?(?:确定)*$/.test(text.replace(/\s+/g, ''));
  const buttonText = el => clean(el) || String(el.value || '').trim();
  const buttonsFor = panel => {
    const controls = [...panel.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex],[class*="button"],[class*="Button"],[class*="btn"],[class*="Btn"]')]
      .filter(el => visible(el) && !el.matches(':disabled,[disabled],[aria-disabled="true"],.disabled'))
      .filter(el => el.matches('button,a,[role="button"],input') || /^(?:确定|确认|继续|继续学习|我知道了|关闭|×)$/.test(buttonText(el)));
    return controls.filter(el => !controls.some(child => child !== el && el.contains(child) && buttonText(child) === buttonText(el)));
  };
  const positioned = panel => {
    for (let el = panel, depth = 0; el && el !== document.body && depth < 3; el = el.parentElement, depth++) if (['fixed', 'absolute'].includes(getComputedStyle(el).position)) return true;
    return false;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog,.ant-modal-content,.ant-modal,.el-message-box,.layui-layer,.modal,.ui-dialog,.swal2-popup,[class*="dialog-content"],[class*="modal-content"],[data-study-time-session-popup]')].filter(visible);
  // The real U-campus idle prompt is a legacy overlay with no dialog role or
  // standard modal class. Require its complete known message, positioned panel
  // and actual confirm control; identical text in ordinary course content is not enough.
  if (hasExactIdleText) for (const message of document.querySelectorAll('p,div,span,td')) {
    if (!visible(message) || !exactMessage(clean(message)) && !exactPanel(clean(message))) continue;
    for (let panel = message, depth = 0; panel && panel !== document.body && depth < 8; panel = panel.parentElement, depth++) {
      const text = clean(panel); if (text.length > 250) break;
      const rect = panel.getBoundingClientRect();
      if (exactPanel(text) && positioned(panel) && rect.width >= 200 && rect.height >= 100 && buttonsFor(panel).some(button => buttonText(button) === '确定')) {
        panel.setAttribute('data-study-time-session-popup', 'true'); dialogs.push(panel); break;
      }
    }
  }
  const unique = [...new Set(dialogs)], leaves = unique.filter(el => !unique.some(child => child !== el && el.contains(child)));
  document.querySelectorAll('[data-study-time-notice]').forEach(el => el.removeAttribute('data-study-time-notice'));
  const notices = leaves.map((dialog, index) => {
    const text = clean(dialog);
    const idle = /(?:长时间|较长时间|超过\s*\d+\s*分).{0,35}(?:未|没有|无).{0,12}(?:操作|活动|学习|互动)/.test(text) ||
      /(?:未|没有).{0,10}(?:操作|活动).{0,35}(?:暂停|停止).{0,15}(?:学习|计时|时长)/.test(text) ||
      /(?:inactive|inactivity|idle|no activity).{0,100}(?:study|learning|session|time|continue)/i.test(text);
    const unit = /本单元学习时间/.test(text) && /是否必修/.test(text);
    const buttons = buttonsFor(dialog);
    const allowed = buttons.filter(el => {
      const label = buttonText(el);
      return unit ? /^我知道了$/.test(label) : idle && /^(?:继续学习|恢复学习|继续计时|继续|我在学习|我知道了|知道了|确定|确认|OK|continue(?: learning| studying)?|resume(?: learning| studying)?)$/i.test(label);
    });
    return { kind: idle ? 'idle' : unit ? 'unit' : 'unknown', exactSession: idle && exactPanel(text), text: text.slice(0, 500),
      selector: allowed.length === 1 ? mark(allowed[0], 'data-study-time-notice', String(index)) : null,
      button: allowed.length === 1 ? clean(allowed[0]) || allowed[0].value : '', ambiguous: allowed.length > 1 };
  });
  if (noticeOnly) return { notices: exactIdleOnly ? notices.filter(notice => notice.exactSession) : notices };
  // Read only explicit "already learned" statistics. Required/recommended time
  // in the unit notice is deliberately not interpreted as credited time.
  const statistics = [];
  if (root) for (const el of root.querySelectorAll('[data-study-time-stat],p,span,div,dd')) {
    if (!visible(el) || el.closest('[role="dialog"],.ant-modal,.modal')) continue;
    const text = clean(el);
    if (text.length > 120 || /要求|至少|建议|应学|需学|目标|预计/.test(text)) continue;
    const match = text.match(/^(本单元已学时长|本单元已学习时长|本课程累计学习时长|本课程已学时长|累计学习时长|已学习时长|已学时长|有效学习时长|已学时间)\s*[:：]?\s*(\d[^，。;；]*?)$/);
    if (match) statistics.push({ label: match[1], value: match[2].trim(), scope: /单元/.test(match[1]) ? 'unit' : /课程/.test(match[1]) ? 'course' : 'page' });
  }
  return { ready, loading, login, networkIssue, title: title.slice(0, 300), crumbs: crumbs.slice(0, 12), hasAnswerControls: controls.length > 0,
    notices, statistics, visibility: document.visibilityState, contentPresent: !!root,
    issue: login ? '请在学习窗口完成登录。' : networkIssue ? '学习页面提示网络异常。' : controls.length ? '当前页面包含作答控件，请选择学习目标等阅读页面。' : !ready ? '学习内容尚未就绪，请在学习窗口核对页面。' : '' };
}

export function collectStudyTimeCoursesFromDOM() {
  const visible = el => { if (!el?.getClientRects().length) return false; for (let node = el; node; node = node.parentElement) { const css = getComputedStyle(node); if (node.hidden || css.display === 'none' || css.visibility === 'hidden') return false; } return true; };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  let tiles = [...document.querySelectorAll('[data-course-id],[data-courseid],[class*="course-card"],[class*="courseCard"],[class*="course-item"],[class*="courseItem"],[class*="course-box"],[class*="courseBox"],[class*="course-list"]>li,[class*="courseList"]>li')].filter(visible);
  tiles = tiles.filter(el => !tiles.some(child => child !== el && el.contains(child)));
  if (!tiles.length) tiles = [...document.querySelectorAll('a[href]')].filter(el => visible(el) && /course|learning|study|rsrc/i.test(el.getAttribute('href')) && !/course-management|javascript:|^#$/i.test(el.getAttribute('href')));
  document.querySelectorAll('[data-study-time-course],[data-study-time-next]').forEach(el => { el.removeAttribute('data-study-time-course'); el.removeAttribute('data-study-time-next'); });
  const entries = tiles.map((el, index) => {
    const titleEl = el.querySelector('[class*="course-name"],[class*="courseName"],[class*="course-title"],[class*="courseTitle"],h2,h3,h4,[title]');
    const title = clean(titleEl?.getAttribute('title') || titleEl?.textContent || el.getAttribute('title') || el.querySelector('img')?.alt || el.textContent);
    let group = null;
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const text = clean(parent.innerText || parent.textContent);
      if ((text.match(/课程名称\s*[:：]/g) || []).length !== 1 || !/班级名称\s*[:：]/.test(text) || !/记分周期\s*[:：]/.test(text)) continue;
      const field = label => clean(text.match(new RegExp(label + '\\s*[:：]\\s*(.*?)(?=\\s*(?:课程名称|班级名称|记分周期|在学教程)\\s*[:：]|$)'))?.[1]);
      const period = field('记分周期').match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*[-~～至]\s*\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/)?.[0]?.replace(/\s+/g, '');
      if (period) group = { name: field('课程名称'), className: field('班级名称'), period };
      break;
    }
    const target = visible(titleEl) ? titleEl : el;
    target.setAttribute('data-study-time-course', String(index));
    return { title, group, sourceId: el.getAttribute('data-course-id') || el.getAttribute('data-courseid') || '', selector: `[data-study-time-course="${index}"]` };
  }).filter(entry => entry.title);
  const next = [...document.querySelectorAll('[class*="pagination"] button,[class*="pagination"] a,[class*="pagination"] li,[class*="Pagination"] button,[class*="pagination-next"],[aria-label="Next Page"],[aria-label="下一页"]')].find(el => visible(el) && !el.matches(':disabled,[aria-disabled="true"],[class*="disabled"]') && /下一页|next/i.test([el.getAttribute('aria-label'), el.textContent, el.className].join(' ')));
  if (next) next.setAttribute('data-study-time-next', 'true');
  return { entries, nextSelector: next ? '[data-study-time-next="true"]' : null, login: [...document.querySelectorAll('input[type="password"]')].some(visible), fingerprint: JSON.stringify(entries.map(({ title, group }) => [title, group])) };
}

export function collectStudyTimeDirectoryFromDOM() {
  const visible = el => !!(el?.getClientRects().length && !el.closest('[hidden],[class*="unipus-tabs_itemHidden"],.ant-collapse-content-hidden') && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const units = [...document.querySelectorAll('[class*="courses-unit_unitTabBody"] [class*="unipus-tabs_tabItemContainer"]')].filter(visible).map(el => ({ id: el.id, label: clean(el.querySelector('[title]')?.title || el.textContent), selector: `[id=${JSON.stringify(el.id)}]`, active: el.className.includes('unipus-tabs_tabActive') })).filter(unit => unit.id && unit.label);
  const active = units.filter(unit => unit.active), bodies = [...document.querySelectorAll('#tab-unit-body-container > [class*="unipus-tabs_itemActive"]')].filter(visible);
  const result = { units, unitId: active.length === 1 ? active[0].id : '', entries: [], collapsed: [], loading: [...document.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible), heading: '' };
  if (active.length !== 1 || bodies.length !== 1) return result;
  const body = bodies[0];
  result.heading = clean(body.querySelector('[class*="courses-unit_unitNameLabel"]')?.textContent);
  document.querySelectorAll('[data-study-time-entry],[data-study-time-expand]').forEach(el => { el.removeAttribute('data-study-time-entry'); el.removeAttribute('data-study-time-expand'); });
  for (const header of body.querySelectorAll('.ant-collapse-header[aria-expanded="false"]')) if (visible(header)) {
    header.setAttribute('data-study-time-expand', String(result.collapsed.length));
    result.collapsed.push(`[data-study-time-expand="${result.collapsed.length}"]`);
  }
  for (const row of body.querySelectorAll('[class*="courses-unit_taskItemContainer"]')) {
    if (!visible(row)) continue;
    const name = row.querySelector('[class*="courses-unit_taskTypeName"]'), title = clean(name?.textContent);
    if (!title) continue;
    const path = [];
    for (let parent = row.parentElement; parent && parent !== body; parent = parent.parentElement) if (parent.classList.contains('ant-collapse-item')) {
      const header = [...parent.children].find(el => el.classList.contains('ant-collapse-header')); if (header) path.unshift(clean(header.textContent));
    }
    const dot = row.querySelector('[class*="courses-unit_taskDian"]'), state = row.querySelector('[class*="courses-unit_taskStateContainer"]');
    const clearDot = visible(dot) && (!state || dot.getBoundingClientRect().right <= state.getBoundingClientRect().left);
    const target = clearDot ? dot : name;
    if (!target) continue;
    target.setAttribute('data-study-time-entry', String(result.entries.length));
    const status = clean(row.querySelector('[class*="courses-unit_nodePassStateTip"]')?.textContent);
    result.entries.push({ key: JSON.stringify([result.unitId, path, title]), title, path, selector: `[data-study-time-entry="${result.entries.length}"]`, status,
      preferred: /^(?:learning objectives?|学习目标)$/i.test(title), locked: status === '已锁定' });
  }
  return result;
}
