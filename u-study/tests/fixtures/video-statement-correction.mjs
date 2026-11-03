export const correctionDirections='Read the following statements again. Correct the false ones. Write "Correct" if the statement is true.';
export const correctionStatements=[
  'You may neglect ethical issues if you focus too much on pleasing others.',
  '"Ethical fading" is a situation in which people make an unethical decision.',
  'It is more effective to make a moral decision by weighing both sides of the issue.',
  'It would be foolish to ignore our instinct, though it is not always right.',
  'Your moral awareness comes into play when you listen to your inner voice.'
];
// Synthetic test material. These are fixture answers, not a transcript or
// verified answer key from the user's course video.
export const correctionTranscript='Focusing too much on pleasing others may cause you to neglect ethical issues. Ethical fading happens when we fail to notice the ethical aspects of a situation. Following our moral intuition is often more effective than weighing both sides of an issue. It would be foolish to ignore our instinct, although it is not always right. Listening to your inner voice brings moral awareness into play.';
export const correctionAnswers=['Correct','Ethical fading happens when we fail to notice the ethical aspects of a situation.','It is more effective to make a moral decision by following our moral intuition.','Correct','Correct'];
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function videoCorrectionHTML({kind='video',embedded=false,firstPage=false}={}){
  return `<!doctype html><html><body><style>.question-inputbox{margin:14px 0}textarea{width:85%;height:65px}.videoPlayer-shell{width:320px}video{width:320px;height:180px}</style>
    <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Complete English Book</span><span class="pc-break-crumb-text">Unit 4</span><span class="pc-break-crumb-text">Viewing and understanding</span></nav><div class="pc-header-tab-activity">Viewing and understanding</div><div class="pc-task pc-header-task-activity">Exercise 2</div></header>
    <main class="layout-container"><div class="abs-direction">${escape(firstPage?'Watch the video and decide whether the statements are true or false.':correctionDirections)}</div>
    <div class="layout-material-container"><div class="videoPlayer-shell"><${kind} controls src="https://media.example.test/ethics.mp4?signature=fixture-private-token"></${kind}><span class="playback-time">00:00 / 03:09</span></div>${embedded?'<div class="transcript">'+escape(correctionTranscript)+'</div>':''}</div>
    <div class="question-common-abs-reply">${correctionStatements.map((statement,i)=>`<div class="question-inputbox"><div class="question-inputbox-header">${i+1}. ${escape(statement)}</div><div class="question-inputbox-body"><textarea id="correction-${i}" placeholder="请输入答案..."></textarea><span class="text-area-hide">0/1000</span></div></div>`).join('')}</div></main>
    <button id="submit" onclick="window.submitted=true">提交</button><script>window.submitted=false;</script></body></html>`;
}
