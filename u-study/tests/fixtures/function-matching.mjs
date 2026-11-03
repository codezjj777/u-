export const functionDirections='Now think about the communicative functions of these expressions. Match their numbers with the corresponding functions.';
export const functionExpressions=[
  'Mark: <b>Oh, Kate!</b>',
  'Kate: How could someone have done this! <b>The creep!</b>',
  "Kate: ... <b>it cost a fortune</b> - I do not have the money to buy another one.",
  "Mark: Listen, <b>I will</b> go down the street and <b>see if</b> I can see anyone with it.",
  'Kate: I guess <b>it was a long shot.</b>',
  'Mark: It is not far to college. <b>Come on!</b>'
];
export const functionOptions=['To express frustration and distress','To show support and comfort someone'];
export const functionGroups=['1, 4, 6','2, 3, 5'];
export const functionAnswers=[functionOptions[1],functionOptions[0]];
export function functionMatchingHTML({startFirst=false,reverse=false,missingSource=false,duplicateGroup=false,unknownReference=false,rollback=false,grading='correct'}={}){
  const groups=reverse?[...functionGroups].reverse():[...functionGroups];if(duplicateGroup)groups[1]=groups[0];if(unknownReference)groups[1]='2, 3, 7';
  const expected=reverse?[0,1]:[1,0];
  const rows=groups.map((group,i)=>`<div class="sortable-list-question-no">${i+1}. ${group}</div><div class="sequence-reply-view-item-text"><span>${String.fromCharCode(65+i)}.</span><span>${functionOptions[i]}</span></div>`).join('');
  const second=`<div class="layout-container"><div class="abs-direction">Directions: ${functionDirections}</div><div class="layoutBody-container has-material has-reply"><div class="question-common-abs-material">${functionExpressions.slice(0,missingSource?5:6).map((text,i)=>'<p>'+ (i+1)+'. '+text+'</p>').join('')}</div><div class="question-common-abs-reply"><div class="sequence-view"><div class="sortable-list-wrapper">${rows}</div></div></div></div></div>`;
  return `<!doctype html><html><head><style>body{font:16px Arial;margin:20px}.layoutBody-container{display:grid;grid-template-columns:48% 50%;gap:2%}.question-common-abs-material p{line-height:26px;margin:16px 0}.sortable-list-wrapper{display:flex;flex-wrap:wrap}.sortable-list-question-no{width:19%;box-sizing:border-box;padding:12px 2px}.sequence-reply-view-item-text{width:81%;box-sizing:border-box;border:1px solid #8bf;border-radius:4px;background:#fafafa;padding:12px;display:flex;gap:8px;margin-bottom:16px;cursor:move;user-select:none}.sortable-helper{pointer-events:none}footer{padding-top:20px}textarea{width:500px;height:45px}</style></head><body>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Offline Listening Book</span><span class="pc-break-crumb-text">A difficult day</span><span class="pc-break-crumb-text">Conversation</span></nav><div class="pc-header-tab-activity">Conversation 1</div><div class="pc-task pc-header-task-activity">Exercise 2</div></header>
  <div class="comp-question-progress" style="width:${startFirst?50:100}%"></div><main class="pc-main-container" id="exercise">${second}</main><footer class="question-common-course-page" id="footer"></footer>
  <script>
  window.submitted=false;window.nextClicks=0;window.dragEvents=0;window.answerOrder=[0,1];window.savedExpressions=[];window.stage=${startFirst?1:2};
  const second=${JSON.stringify(second)},groups=${JSON.stringify(groups)},options=${JSON.stringify(functionOptions)},expected=${JSON.stringify(expected)};
  window.showFunctions=()=>{
    window.stage=2;document.querySelector('.comp-question-progress').style.width='100%';document.querySelector('#exercise').innerHTML=second;document.querySelector('#footer').innerHTML='<button>上一题</button><button id="submit">提交</button>';
    const Card=SortableHOC.SortableElement(({id})=>React.createElement('div',{className:'sequence-reply-view-item-text'},React.createElement('span',null,String.fromCharCode(65+id)+'.'),React.createElement('span',null,options[id])));
    const List=SortableHOC.SortableContainer(({items})=>React.createElement('div',{className:'sortable-list-wrapper'},groups.map((group,i)=>React.createElement(React.Fragment,{key:i},React.createElement('div',{className:'sortable-list-question-no'},(i+1)+'. '+group),React.createElement(Card,{key:items[i],id:items[i],index:i})))));
    class Matching extends React.Component{constructor(props){super(props);this.state={items:[0,1]};}render(){return React.createElement(List,{items:this.state.items,axis:'y',pressDelay:150,transitionDuration:300,helperClass:'sortable-helper',onSortEnd:({oldIndex,newIndex})=>{const old=[...this.state.items],items=[...old];items.splice(newIndex,0,...items.splice(oldIndex,1));window.dragEvents++;window.answerOrder=items;this.setState({items});if(${rollback})setTimeout(()=>{window.answerOrder=old;this.setState({items:old});},650);}});}}
    ReactDOM.render(React.createElement(Matching),document.querySelector('.sequence-view'));
    document.querySelector('#submit').onclick=()=>{window.submitted=true;window.submittedOrder=[...window.answerOrder];const total=${startFirst?8:2},good=JSON.stringify(window.answerOrder)===JSON.stringify(expected)&&${JSON.stringify(grading)}==='correct',correct=good?total:0;document.querySelector('#exercise').innerHTML='<h2>答题小结</h2><p>共'+total+'道题，客观题'+total+'道，主观题0道</p><p>正确 ('+correct+'/'+total+')</p><p>错误 ('+(total-correct)+'/'+total+')</p><p>未作答0</p>';document.querySelector('#footer').innerHTML='';};
  };
  window.mountMatching=()=>{
    if(!${startFirst}){window.showFunctions();return;}
    document.querySelector('#exercise').innerHTML='<div class="layout-container"><div class="abs-direction">Explain the meaning of each numbered expression.</div>'+${JSON.stringify(functionExpressions)}.map((text,i)=>'<fieldset><legend>'+(i+1)+'. '+text+'</legend><textarea></textarea></fieldset>').join('')+'</div>';
    document.querySelector('#footer').innerHTML='<button id="next">下一题</button>';document.querySelector('#next').onclick=()=>{window.nextClicks++;window.savedExpressions=[...document.querySelectorAll('textarea')].map(el=>el.value);window.showFunctions();};
  };
  </script></body></html>`;
}
