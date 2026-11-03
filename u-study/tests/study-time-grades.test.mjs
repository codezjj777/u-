import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeStudyTimeGrades, studyTimeGroupKey, studyTimeGradeCredit, StudyTimeProgressStore, readStudyTimeGrades } from '../study-time-grades.mjs';

const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true });
const group = { name: '大学英语（三）B班', className: '25级人工智能B1班', period: '2026/08/03-2027/02/03' };
const titles = ['视听说教程2', '视听说教程3', '综合教程2', '综合教程3'].map(title => `新标准大学英语（第三版）${title}`);
const courses = titles.map((title, index) => ({ id: `book-${index}`, title, group }));
const raw = () => ({ detailOpen: true, summaryValue: '14:53:39', books: titles.map((title, index) => ({ title, value: ['03:24:17', '02:46:18', '07:55:04', '00:48:00'][index], score: ['22.6', '27.7', '52.7', '8'][index], weight: ['30%', '20%', '30%', '20%'][index] })) });

test('grade details retain each book, exact platform time and percentage score without inferring a target', () => {
  const report = normalizeStudyTimeGrades(courses[0], raw(), 1000);
  assert.equal(report.totalSeconds, 53619); assert.equal(report.books.length, 4);
  assert.deepEqual(report.books[0], { title: titles[0], seconds: 12257, percent: 22.6, weight: 30 });
  assert.equal('targetSeconds' in report.books[0], false);
});
test('zero seconds and zero scores remain real values; missing scores do not become zero', () => {
  const report = normalizeStudyTimeGrades(courses[0], { detailOpen: true, books: [{ title: titles[0], value: '00:00:00', score: '0', weight: '0%' }, { title: titles[1], value: '0秒', score: '—', weight: '—' }] });
  assert.equal(report.totalSeconds, 0); assert.equal(report.books[0].percent, 0); assert.equal(report.books[1].percent, null);
});
test('partial, contradictory, duplicate and truncated details never overwrite cached platform data', () => {
  for (const patch of [{ incomplete: true }, { ambiguous: true }, { detailOpen: false }, { books: [] }, { summaryValue: '00:00:01' }]) assert.throws(() => normalizeStudyTimeGrades(courses[0], { ...raw(), ...patch }));
  for (const patch of [{ title: '新标准大学英...' }, { value: '01:30' }, { score: '101' }, { score: '-1' }, { weight: '30' }]) { const report = raw(); Object.assign(report.books[0], patch); assert.throws(() => normalizeStudyTimeGrades(courses[0], report)); }
  const duplicate = raw(); duplicate.books[1].title = duplicate.books[0].title; assert.throws(() => normalizeStudyTimeGrades(courses[0], duplicate));
});
test('course identity includes the exact class and grading period, including NFKC variants', () => {
  assert.equal(studyTimeGroupKey(courses[0]), studyTimeGroupKey({ ...courses[0], group: { ...group, name: '大学英语(三) B班' } }));
  assert.notEqual(studyTimeGroupKey(courses[0]), studyTimeGroupKey({ ...courses[0], group: { ...group, period: '2026/02/27-2026/08/27' } }));
  assert.notEqual(studyTimeGroupKey(courses[0]), studyTimeGroupKey({ ...courses[0], group: { ...group, className: '另一个班' } }));
});

test('task credit selects the exact book and grading period and uses a bounded stable scope key', () => {
  const report = normalizeStudyTimeGrades(courses[0], raw());
  const credit = studyTimeGradeCredit(courses[0], report);
  assert.equal(credit.seconds, 12257); assert.equal(credit.source, 'grades'); assert.equal(credit.key.length, 71);
  assert.notEqual(credit.key, studyTimeGradeCredit(courses[1], report).key);
  assert.throws(() => studyTimeGradeCredit({ ...courses[0], group: { ...group, period: '2025/09/01-2026/03/01' } }, report));
  assert.throws(() => studyTimeGradeCredit({ ...courses[0], title: '没有这本教材' }, report));
  assert.throws(() => studyTimeGradeCredit(courses[0], { ...report, books: [report.books[0], report.books[0]] }));
});
test('one term report maps four books once and never leaks into the same book from a different semester', () => {
  const store = new StudyTimeProgressStore(cache); store.reports = [normalizeStudyTimeGrades(courses[0], raw(), 1000)];
  const prior = { ...courses[0], id: 'previous-book', group: { ...group, period: '2026/02/27-2026/08/27' } };
  const snapshot = store.snapshot([...courses, prior], Date.parse('2026-11-01T14:00:00Z'));
  assert.equal(snapshot.groups.length, 2); assert.equal(snapshot.groups[0].current, true); assert.equal(snapshot.groups[1].current, false);
  assert.equal(snapshot.groups[0].report.totalSeconds, 53619); assert.equal(Object.keys(snapshot.byCourse).length, 4); assert.equal(snapshot.byCourse[prior.id], undefined);
  assert.equal(snapshot.byCourse['book-3'].seconds, 2880); assert.equal(snapshot.byCourse['book-0'].totalSeconds, 53619);
  const reordered = store.snapshot([...courses].reverse()); assert.equal(reordered.byCourse['book-0'].percent, 22.6);
});
test('platform progress persists independently and malformed cache leaves the original file intact', async t => {
  const directory = await mkdtemp(path.join(cache, 'study-grades-store-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(cache + path.sep)); await rm(directory, { recursive: true, force: true }); });
  const store = new StudyTimeProgressStore(directory); await store.load(); assert.deepEqual(store.reports, []);
  const report = normalizeStudyTimeGrades(courses[0], raw(), 1000); await store.put(report);
  const restored = new StudyTimeProgressStore(directory); await restored.load(); assert.deepEqual(restored.reports, [report]);
  const file = path.join(directory, 'progress.json'); await writeFile(file, '{invalid'); await restored.load();
  assert.deepEqual(restored.reports, []); assert.match(restored.warning, /缓存/); assert.equal(await readFile(file, 'utf8'), '{invalid');
});
test('reading progress never opens a browser when the existing shared window is closed', async () => {
  let called = false;
  await assert.rejects(readStudyTimeGrades({ windowOpen: false, runShared: () => { called = true; } }, courses[0]), /现有 U校园窗口/);
  assert.equal(called, false);
});
