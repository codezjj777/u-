const book=(id,title,progress)=>`<article class="course-card" data-course-id="${id}"><div class="course-cover"><svg aria-label="教材封面"></svg></div><h3>${title}</h3>${progress}</article>`;
const group=(period,books)=>`<section><header><p>课程名称：大学英语（三）B班</p><p>班级名称：离线测试班</p><p>记分周期：${period}</p></header><p>在学教程：${books.length}</p><div class="books">${books.join('')}</div></section>`;
export const courseProgressHTML=`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px Arial}.course-card{display:inline-block;width:240px;padding:16px;border:1px solid #ddd}.book-progress{height:5px;background:#2366ff}</style></head><body>${group('2026/08/03-2027/02/03',[
  book('book2','新标准大学英语（第三版）综合教程2','<p>已学任务：<span id="book2-done">94</span>/94</p><p>学习进度：<svg aria-label="check-circle"></svg></p><div class="book-progress" style="width:100%"></div>'),
  '<div aria-hidden="true" inert>'+book('book3','新标准大学英语（第三版）综合教程3','<p>已学任务：55/55</p><p>学习进度：✅</p><div class="book-progress" style="width:100%"></div><div hidden>已学任务：0/55</div>')+'</div>',
  book('partial','部分完成的教材','<p>已学任务：15/60</p>'),
  book('unknown','未提供进度的教材','<p>已学任务：0/0</p>')
])}${group('2026/02/27-2026/08/27',[
  book('book2-old','新标准大学英语（第三版）综合教程2','<p>已学任务：5/94</p>')
])}</body></html>`;
