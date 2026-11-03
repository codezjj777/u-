export const responseDirections='Watch Conversation 1 again and match the questions with the expressions used by Janet or Tony in their responses.';
export const responsePrompts=['And which is better?','Are you up for this?','Janet, are you ready with the sound this time?','Do you live here as well?','And in comparison with Chinatown in, say, San Francisco or Sydney, is it larger or smaller?','And the business here, is it mostly the restaurant trade?'];
export const responseOptions=['OK.','No, in fact, ...',"I'd say ...",'Yes, as well as ...','OK, fire away!','Er, well, in my opinion, I think ...'];
// Synthetic alignment and transcript for offline tests, not a course answer key.
export const responseOrder=[5,0,4,1,2,3];
export const responseAnswers=responseOrder.map(i=>responseOptions[i]);
export const responseTranscript='Offline conversation fixture. '+responsePrompts.map((q,i)=>q+' Reply: '+responseAnswers[i]).join(' ');
export function questionResponseHTML({transcript=false,missing=false,duplicate=false,directions=responseDirections}={}){
  const prompts=[...responsePrompts];if(missing)prompts.pop();if(duplicate)prompts[1]=prompts[0];
  const left=prompts.map((text,i)=>'<div class="sequence-question-view-item-text">'+(i+1)+'. '+text+'</div>').join('');
  const cards=responseOptions.map((text,i)=>'<div class="sequence-reply-view-item-text"><span>'+String.fromCharCode(65+i)+'.</span><span>'+text+'</span></div>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px Arial;margin:20px}.sequence-view{display:grid;grid-template-columns:48% 48%;gap:4%}.sequence-question-view-item-text{min-height:65px;padding:6px}.sequence-reply-view-item-text{display:flex;gap:8px;padding:12px;margin:0 0 14px;border:1px solid #acf;background:#fafafa;cursor:move}.sortable-helper{pointer-events:none}video{width:320px;height:180px}</style></head><body>
  <header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Offline listening book</span><span class="pc-break-crumb-text">Beyond the horizon</span><span class="pc-break-crumb-text">Conversation</span></nav><div class="pc-header-tab-activity">Conversation 1</div><div class="pc-task pc-header-task-activity">Exercise 2</div></header>
  <main id="exercise" class="layout-container"><div class="abs-direction">${directions}</div><div class="layout-material-container"><video src="https://ucontent.unipus.cn/offline-recognition/response.mp4"></video>${transcript?'<div class="transcript">'+responseTranscript+'</div>':''}</div><div class="sequence-view"><div class="sequence-question-view">${left}</div><div class="sequence-reply-view"><div class="sortable-list-wrapper">${cards}</div></div></div></main><footer><button id="submit">提交</button></footer>
  <script>window.submitted=false;window.dragEvents=0;window.answerOrder=[0,1,2,3,4,5];window.mountMatching=()=>{
    const texts=${JSON.stringify(responseOptions)},expected=${JSON.stringify(responseOrder)};
    const Card=SortableHOC.SortableElement(({id})=>React.createElement('div',{className:'sequence-reply-view-item-text'},React.createElement('span',null,String.fromCharCode(65+id)+'.'),React.createElement('span',null,texts[id])));
    const List=SortableHOC.SortableContainer(({items})=>React.createElement('div',{className:'sortable-list-wrapper'},items.map((id,index)=>React.createElement(Card,{key:id,id,index}))));
    class Matching extends React.Component{constructor(props){super(props);this.state={items:[...window.answerOrder]};}render(){return React.createElement(List,{items:this.state.items,axis:'y',pressDelay:150,transitionDuration:300,helperClass:'sortable-helper',onSortEnd:({oldIndex,newIndex})=>{const items=[...this.state.items];items.splice(newIndex,0,...items.splice(oldIndex,1));window.dragEvents++;window.answerOrder=items;this.setState({items});}});}}
    ReactDOM.render(React.createElement(Matching),document.querySelector('.sequence-reply-view'));
    document.getElementById('submit').onclick=()=>{window.submitted=true;const good=JSON.stringify(window.answerOrder)===JSON.stringify(expected),n=good?6:0;document.querySelector('main').innerHTML='<h2>答题小结</h2><p>共6道题，客观题6道，主观题0道</p><p>正确 ('+n+'/6)</p><p>错误 ('+(6-n)+'/6)</p><p>未作答0</p>';document.querySelector('footer').innerHTML='';};
  };</script></body></html>`;
}
