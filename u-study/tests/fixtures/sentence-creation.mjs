export const sentenceCreationDirections='Directions: Make sentences by using the structure "It is expected / believed / thought, etc. that ...". You can refer to the Notes.';
export const sentenceCreationNotes=[
  'It is expected that ...',
  'It is expected that by implementing these strategies in the action plan, SmartWays4U will be able to ...',
  'By saying "It is expected that ..." instead of "We expect that ...", the sentence implies that the expectation is more generally held, rather than being held by only a small group of people. We can replace "expect" with other words like "believe" or "think".'
];
export const sentenceCreationAnswers=[
  'It is expected that the new policy will create more job opportunities.',
  "It is believed that regular exercise can improve people's health.",
  'It is thought that teamwork helps people solve problems more effectively.'
];
export function sentenceCreationHTML(){
  return `<!doctype html><html><body><style>body{font:16px Arial;margin:20px}.layoutBody-container{display:grid;grid-template-columns:48% 48%;gap:2%}.layout-material-container{border:1px solid #ddd;padding:12px}.layout-material-container p{margin:15px 0}.question-common-abs-reply{max-height:470px;overflow:auto}.question-inputbox{margin:15px 0}textarea{width:90%;height:100px}.text-area-hide{display:none}</style>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">English Book</span><span class="pc-break-crumb-text">Changing with the times</span><span class="pc-break-crumb-text">Episode 2</span></nav><div class="pc-header-tab-activity">Language in focus</div><div class="pc-task pc-header-task-activity">Structure</div></header>
  <main class="layout-container"><div class="abs-direction">${sentenceCreationDirections}</div><div class="layoutBody-container"><section class="layout-material-container"><h3>Notes:</h3>${sentenceCreationNotes.map(note=>'<p>'+note+'</p>').join('')}</section><section class="question-common-abs-reply">${sentenceCreationAnswers.map((_,index)=>`<div class="question-inputbox"><div class="question-inputbox-header">${index+1}.</div><textarea id="sentence-${index+1}" maxlength="1000" placeholder="请输入答案..."></textarea><div class="text-area-hide">0/1000</div></div>`).join('')}</section></div></main>
  <footer><button id="submit">提交</button></footer><script>window.submissions=0;document.querySelector('#submit').onclick=()=>window.submissions++;</script></body></html>`;
}
