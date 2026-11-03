import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const studyLiveStatuses = new Set(['waiting', 'running', 'paused', 'review', 'interrupted']);
const statuses = new Set([...studyLiveStatuses, 'stopped', 'completed', 'failed']);
const modes = new Set(['session', 'platform-add', 'platform-total']);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const number = value => Number.isFinite(value) && value >= 0;

export function validateStudyTimeTask(task) {
  if (!task || !text(task.id, 100) || !/^[\w-]+$/.test(task.id) || !statuses.has(task.status) || !text(task.courseId, 2000) || !text(task.courseTitle, 1000) || !text(task.unitId, 200) || !text(task.unitLabel, 500) || !text(task.entryKey, 5000) || !text(task.entryTitle, 500) || !modes.has(task.mode) || !Number.isInteger(task.targetMinutes) || task.targetMinutes < 1 || task.targetMinutes > 1440) throw new Error('学习时长任务数据格式异常。');
  for (const key of ['createdAt', 'updatedAt', 'elapsedMs', 'interruptedMs', 'recoveries', 'lastCheckedAt']) if (!number(task[key])) throw new Error('学习时长进度格式异常。');
  for (const key of ['baselineSeconds', 'platformSeconds', 'platformCheckedAt']) if (task[key] !== null && !number(task[key])) throw new Error('平台时长数据格式异常。');
  if (typeof task.keepAlive !== 'boolean' || !text(task.pageTitle, 500) || !Array.isArray(task.logs) || task.logs.length > 120 || task.logs.some(log => !text(log.message, 1000) || !number(log.timestamp) || !['info', 'warning', 'error'].includes(log.level))) throw new Error('学习时长日志格式异常。');
  const { id, status, courseId, courseTitle, unitId, unitLabel, entryKey, entryTitle, mode, targetMinutes, keepAlive, createdAt, updatedAt, elapsedMs, interruptedMs, recoveries, lastCheckedAt, baselineSeconds, platformSeconds, platformCheckedAt, pageTitle, logs } = task;
  return { id, status, courseId, courseTitle, unitId, unitLabel, entryKey, entryTitle, mode, targetMinutes, keepAlive, createdAt, updatedAt, elapsedMs, interruptedMs, recoveries, lastCheckedAt, baselineSeconds, platformSeconds, platformCheckedAt, pageTitle,
    creditKey: text(task.creditKey, 300) ? task.creditKey : '',
    creditSource: ['page', 'grades'].includes(task.creditSource) ? task.creditSource : task.creditKey?.startsWith('grades:') ? 'grades' : task.creditKey ? 'page' : '',
    creditLabel: text(task.creditLabel, 1000) ? task.creditLabel : '', creditNote: text(task.creditNote, 1000) ? task.creditNote : '', logs: logs.map(log => ({ ...log })) };
}

export class StudyTimeStore {
  constructor(directory) { this.directory = directory; this.tasks = []; this.queue = Promise.resolve(); this.error = ''; }
  async load() {
    let raw;
    try { raw = await readFile(path.join(this.directory, 'state.json'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取学习时长记录，请检查目录权限。'); return; }
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 30) throw new Error('invalid');
      this.tasks = data.tasks.map(validateStudyTimeTask);
      for (const task of this.tasks) if (studyLiveStatuses.has(task.status)) {
        task.status = 'interrupted';
        this.log(task, '服务已重新启动，任务等待继续；退出期间的时间未计入。', 'warning');
      }
    } catch {
      this.tasks = []; this.error = '学习时长记录格式异常，已保留原文件。';
      throw new Error(this.error);
    }
  }
  log(task, message, level = 'info') {
    const now = Date.now(); task.updatedAt = now;
    task.logs.push({ message: String(message).slice(0, 1000), timestamp: now, level });
    task.logs = task.logs.slice(-120);
  }
  save() {
    const data = JSON.stringify({ version: 1, tasks: this.tasks.map(validateStudyTimeTask) }, null, 2);
    const pending = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, 'state.tmp'), data, 'utf8');
      await rename(path.join(this.directory, 'state.tmp'), path.join(this.directory, 'state.json'));
      this.error = '';
    }).catch(() => { this.error = '学习时长记录未能保存，请检查磁盘和目录权限。'; throw new Error(this.error); });
    this.queue = pending.catch(() => {}); return pending;
  }
}
