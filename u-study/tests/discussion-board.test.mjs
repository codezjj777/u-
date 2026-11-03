import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {readDiscussionBoardFromDOM} from '../discussion-board.mjs';
import {collectQuestionsFromDOM,readLearningStateFromDOM} from '../platform-dom.mjs';
import {discussionBoardHTML} from './fixtures/discussion-board.mjs';

function dom(options){const {window,document}=parseHTML(discussionBoardHTML(options));globalThis.document=document;globalThis.getComputedStyle=el=>({visibility:el.closest('[hidden]')?'hidden':'visible'});window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}]};return document;}
test('a discussion board exposes only its primary composer, not replies, notes or ordinary exercise fields',()=>{
  const document=dom();const board=readDiscussionBoardFromDOM();assert.equal(board.ready,true);assert.equal(document.querySelector(board.editor).id,'comment');assert.equal(document.querySelector(board.publish).id,'publish');assert.equal(board.count,1);assert.equal(readLearningStateFromDOM().contentReady,true);assert.deepEqual(collectQuestionsFromDOM(),[]);assert.match(board.prompt,/share your answers/);assert.doesNotMatch(board.prompt,/different learner|private note/);
  assert.ok(document.querySelector(board.editor).closest('.question-common-abs-reply'));assert.ok(document.querySelector(board.editor).closest('.ds-discussion-reply'));
});
test('discussion composer supports rich text and retains an existing draft',()=>{
  dom({editable:true});document.querySelector('#comment').textContent='My unfinished comment.';const board=readDiscussionBoardFromDOM();assert.equal(board.ready,true);assert.equal(board.value,'My unfinished comment.');
});
test('ambiguous or hidden discussion composers never yield a publishing target',()=>{
  dom({duplicates:true});assert.equal(readDiscussionBoardFromDOM().ready,false);
  dom();document.querySelector('.discussion-course-page-sdk').hidden=true;assert.equal(readDiscussionBoardFromDOM().loading,true);
  dom();document.querySelector('#comment').remove();assert.equal(readDiscussionBoardFromDOM().ready,false);
});
test('a not-yet-mounted textbook discussion is recognized as loading rather than an empty manual lesson',()=>{
  dom();document.querySelector('.discussion-course-page-sdk').remove();const board=readDiscussionBoardFromDOM();assert.equal(board.recognized,true);assert.equal(board.loading,true);assert.equal(board.ready,false);
});
