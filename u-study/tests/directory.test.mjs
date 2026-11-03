import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {collectDirectoryFromDOM,requiredQueue,summarizeDirectory} from '../course-directory.mjs';
function dom(body){
  const {window,document}=parseHTML(`<html><body><div class="courses-unit_unitTabBody__hash"><div id="id-unit4-tab" class="unipus-tabs_tabItemContainer__hash unipus-tabs_tabActive__hash"><div title="Unit 4">Unit 4</div></div><div id="id-unit5-tab" class="unipus-tabs_tabItemContainer__hash"><div title="Unit 5">Unit 5</div></div><div id="tab-unit-body-container">${body}</div></div></body></html>`);
  globalThis.document=document;globalThis.getComputedStyle=()=>({visibility:'visible'});window.HTMLElement.prototype.getClientRects=()=>[{}];return document;
}
const row=(title,required=true,status='未开始')=>`<div class="courses-unit_taskItemContainer__hash"><div class="courses-unit_taskNameContainer__hash"><span class="courses-unit_taskTypeName__hash">${title}</span>${required?'<span class="courses-unit_taskRequireIcon__hash">必修</span>':''}</div><div class="courses-unit_nodePassStateTip__hash">${status}</div></div>`;
const section=(name,content)=>`<div class="ant-collapse-item"><div class="ant-collapse-header" aria-expanded="true">${name}</div><div class="ant-collapse-content">${content}</div></div>`;
const active=content=>`<div class="unipus-tabs_itemActive__hash"><div class="courses-unit_unitNameLabel__hash">Horns of a dilemma</div>${content}</div>`;

test('directory queue includes only required unfinished rows in the selected unit',()=>{
  dom(active(section('Active reading',row('Exercise 1')+row('Exercise 2',true,'已完成')+row('Exercise 3',false)+row('Unknown status',true,'待核对')))+`<div class="unipus-tabs_itemHidden__hash">${row('Other unit')}</div>`);
  const directory=collectDirectoryFromDOM(),queue=requiredQueue(directory,'id-unit4-tab');
  assert.deepEqual(directory.units.map(unit=>unit.label),['Unit 4','Unit 5']);assert.equal(queue.length,1);assert.equal(queue[0].title,'Exercise 1');assert.equal(document.querySelector(queue[0].selector).textContent,'Exercise 1');
  assert.deepEqual(summarizeDirectory(directory),{required:3,completed:1,pending:1,unknown:1});
  assert.throws(()=>requiredQueue(directory,'id-unit5-tab'),/尚未完整载入/);
});
test('same exercise names in different chapters retain separate identities',()=>{
  dom(active(section('Active reading',row('Exercise 1'))+section('Further exploration',row('Exercise 1'))));
  const queue=requiredQueue(collectDirectoryFromDOM(),'id-unit4-tab');assert.equal(queue.length,2);assert.notEqual(queue[0].key,queue[1].key);assert.deepEqual(queue[1].path,['Further exploration']);
});

test('an overlapping progress column uses the same leaf’s clear dot instead of the covered title',()=>{
  dom(active(section('Scenario',row('Video scenario'))));
  const name=document.querySelector('[class*=courses-unit_taskNameContainer]');name.insertAdjacentHTML('afterbegin','<span class="courses-unit_taskDian__hash"></span>');
  const rowElement=name.parentElement;rowElement.insertAdjacentHTML('beforeend','<div class="courses-unit_taskStateContainer__hash"></div>');
  name.querySelector('[class*=taskTypeName]').getBoundingClientRect=()=>({left:312,width:113,right:425});
  name.querySelector('[class*=taskDian]').getBoundingClientRect=()=>({left:295,width:4,right:299});
  rowElement.querySelector('[class*=taskStateContainer]').getBoundingClientRect=()=>({left:329,width:254,right:583});
  const entry=requiredQueue(collectDirectoryFromDOM(),'id-unit4-tab')[0];
  assert.match(entry.selector,/taskDian/);assert.equal(document.querySelector(entry.selector).parentElement,name);
  rowElement.querySelector('[class*=taskStateContainer]').getBoundingClientRect=()=>({left:700,width:254,right:954});
  name.insertAdjacentHTML('beforeend','<div class="courses-unit_tooltipPosition__hash"></div>');
  const tooltipEntry=requiredQueue(collectDirectoryFromDOM(),'id-unit4-tab')[0];assert.match(tooltipEntry.selector,/taskDian/);
});
test('same chapter and title duplicates stop before choosing a required row',()=>{
  dom(active(section('Language focus',row('Exercise 1')+row('Exercise 1'))));assert.throws(()=>requiredQueue(collectDirectoryFromDOM(),'id-unit4-tab'),/无法可靠区分/);
});
test('collapsed chapters are expanded before the directory can be considered complete',()=>{
  dom(active(`<div class="ant-collapse-item"><div class="ant-collapse-header" aria-expanded="false">Active reading</div><div class="ant-collapse-content-hidden">${row('Exercise 1')}</div></div>`));
  const first=collectDirectoryFromDOM();assert.equal(first.ready,false);assert.equal(first.entries.length,0);assert.equal(first.collapsed.length,1);
  document.querySelector(first.collapsed[0].selector).setAttribute('aria-expanded','true');document.querySelector('.ant-collapse-content-hidden').className='ant-collapse-content';
  const next=collectDirectoryFromDOM();assert.equal(next.ready,true);assert.equal(next.entries.length,1);assert.equal(document.querySelector('[data-ustudy-directory-expand]'),null);
});
test('empty, loading and ambiguous active bodies never look like a completed unit',()=>{
  dom(active(''));assert.equal(collectDirectoryFromDOM().ready,false);
  dom(active(row('Exercise 1'))+'<div class="ant-spin-spinning"></div>');assert.equal(collectDirectoryFromDOM().ready,false);
  dom(active(row('Exercise 1'))+active(row('Exercise 2')));assert.equal(collectDirectoryFromDOM().ready,false);
});

test('all-locked placeholders are not a ready zero-required directory',()=>{
  dom(active(section('Reading',row('Exercise 1',false,'已锁定')+row('Exercise 2',false,'已锁定'))));const pending=collectDirectoryFromDOM();assert.equal(pending.allLocked,true);assert.equal(pending.ready,false);assert.throws(()=>requiredQueue(pending,'id-unit4-tab'),/尚未完整载入/);
  document.querySelectorAll('[class*=courses-unit_nodePassStateTip]').forEach(el=>el.textContent='未开始');const ready=collectDirectoryFromDOM();assert.equal(ready.allLocked,false);assert.equal(ready.ready,true);assert.notEqual(ready.fingerprint,pending.fingerprint);
});
