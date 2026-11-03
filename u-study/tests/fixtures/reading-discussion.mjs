export const readingQuestions=[
  'What does "specialist magazine" mean? What specialist magazines, printed or digital, have you read?',
  'How many kinds of clues for crossword puzzles are mentioned? What are they?',
  'How much English do you need to know to enjoy word games?',
  'Are word games as popular in China as they are in the U.K.? What might be the cause?'
];
export const readingParagraphs=[
  'Newspaper readers sometimes miss the familiar papers and puzzles they enjoy at home.',
  'A specialist magazine focuses on a particular subject or hobby, such as walking or birdwatching.',
  'Crossword clues may be straightforward definitions or cryptic wordplay. Different types test different skills.',
  'People can enjoy many simple word games without knowing a large amount of English.',
  'The final reading clue: a little reading and writing is enough to join in.'
];
export const readingAnswers=[
  'A specialist magazine covers one particular subject or hobby. One example a learner could choose is a birdwatching magazine.',
  'Two types are mentioned in this passage: straightforward definitions and cryptic wordplay.',
  'You only need a little reading and writing to enjoy many simple word games.',
  'Without comparative data, I would be cautious about saying which country enjoys word games more. Both have traditions of wordplay. Differences in writing systems, newspapers and leisure habits may help explain the different forms these games take.'
];
export function readingDiscussionHTML(){
  return `<!doctype html><html><body><style>body{font:15px Arial}.layoutBody-container{display:grid;grid-template-columns:48% 48%;gap:2%}.layout-material-container,.question-common-abs-reply{max-height:230px;overflow:auto}.layout-material-container p{min-height:75px}.question-inputbox{margin:20px 0}textarea{width:85%;height:90px}</style>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">English Book</span><span class="pc-break-crumb-text">Time off</span><span class="pc-break-crumb-text">Reading in detail</span></nav><div class="pc-header-tab-activity">Exercises</div><div class="pc-task pc-header-task-activity">Exercise 3</div></header>
  <main class="layout-container"><div class="abs-direction">Directions: Answer the following questions.</div><div class="layoutBody-container"><div class="layout-material-container"><h3>A love of words</h3>${readingParagraphs.map((paragraph,index)=>`<p>${index+1} ${paragraph}</p>`).join('')}</div><div class="question-common-abs-reply">${readingQuestions.map((question,index)=>`<div class="question-inputbox"><div class="question-inputbox-header">${index+1}. ${question}</div><textarea maxlength="1000"></textarea></div>`).join('')}</div></div></main>
  <aside><div class="passage">Sidebar material must not become exercise context.</div></aside><button onclick="window.submitted=true">提交</button><script>window.submitted=false;</script></body></html>`;
}
