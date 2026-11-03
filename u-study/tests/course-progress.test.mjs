import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectCoursesFromDOM} from '../platform-dom.mjs';
import {mergeCourses} from '../shared/core.mjs';

function read(cards){
  const {window,document}=parseHTML('<html><body>'+cards+'</body></html>');globalThis.document=document;globalThis.location={href:'https://ucloud.unipus.cn/app/cmgt/course-management',pathname:'/app/cmgt/course-management'};
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
  globalThis.getComputedStyle=el=>({display:el.style.display||'block',visibility:el.style.visibility||'visible'});
  return collectCoursesFromDOM().courses;
}
const card=(id,content)=>`<article class="course-card" data-course-id="${id}"><h3>教程 ${id}</h3>${content}</article>`;

test('whole-book completed task counts yield 100 percent even when a check icon replaces percentage text',()=>{
  const courses=read(card('two','<p>已学任务：<span>94</span>/<span>94</span></p><p>学习进度：<svg aria-label="完成"></svg></p>')+card('three','<p>已学任务：55/55</p><p>学习进度：✅</p>'));
  assert.deepEqual(courses.map(c=>[c.progress,c.status]),[[100,'completed'],[100,'completed']]);
});

test('partial task counts become bounded percentages and do not round incomplete books up to completed',()=>{
  const courses=read(card('a','<p>已学任务：15/60</p>')+card('b','<p>已学任务：１ ／ ３</p>')+card('c','<p>已学任务：99999/100000</p><span>已完成</span>'));
  assert.deepEqual(courses.map(c=>[c.progress,c.status]),[[25,'active'],[33.33,'active'],[99.99,'active']]);
});

test('zero totals, impossible or conflicting book counts remain unknown rather than displaying completion',()=>{
  for(const content of ['<p>已学任务：0/0</p>','<p>已学任务：56/55</p>','<p>已学任务：—/—</p>','<p>已学任务：2/4</p><p>已学任务：4/4</p>']){
    const [course]=read(card('a',content+'<p>学习进度：100%</p><span>已完成</span>'));assert.equal(course.progress,null);assert.equal(course.status,'active');
  }
  assert.equal(read(card('a','<p>单元任务：4/4</p>'))[0].progress,null);
});

test('progress stays scoped to its own visible book card and supports existing percentage and accessible progress values',()=>{
  const courses=read(card('a','<p>已学任务：94/94</p><div hidden>已学任务：0/94</div>')+card('b','<p>学习进度：61.7%</p>')+card('c','<div role="progressbar" aria-valuenow="100"></div>')+card('d','<p>尚无进度数据</p>')+'<div hidden>'+card('hidden','<p>已学任务：1/1</p>')+'</div>');
  assert.deepEqual(courses.map(c=>c.progress),[100,61.7,100,null]);assert.equal(courses.length,4);
});

test('inactive carousel books retain readable progress even when the carousel marks their accessibility subtree hidden',()=>{
  const courses=read(card('two','<p>已学任务：94/94</p>')+'<div aria-hidden="true" inert>'+card('three','<p>已学任务：55/55</p>')+'</div>');
  assert.equal(courses.length,2);assert.deepEqual(courses.map(c=>c.progress),[100,100]);
});

test('course normalization keeps completion and percentage consistent and accepts a later reset from the platform',()=>{
  const course={id:'book',title:'教程',url:'https://ucloud.unipus.cn/app/cmgt/course-management'};
  assert.equal(mergeCourses([],[{...course,progress:null,status:'completed'}])[0].progress,100);
  assert.equal(mergeCourses([],[{...course,progress:100,status:'active'}])[0].status,'completed');
  const reset=mergeCourses([{...course,progress:100,status:'completed'}],[{...course,progress:25,status:'completed'}])[0];assert.equal(reset.progress,25);assert.equal(reset.status,'active');
  assert.equal(mergeCourses([],[{...course,progress:null,status:'active'}])[0].progress,null);
});
