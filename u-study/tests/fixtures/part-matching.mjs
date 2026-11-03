export const partMatchingDirections='Match each part of the text with its main idea.';
export const partMatchingPrompts=['Part I (Paras. 1–3)','Part II (Paras. 4–7)','Part III (Para. 8)'];
export const partMatchingOptions=[
  'The author reflects on the value of a supportive community and enjoying ordinary life.',
  'The author explains her choice to live in a lane house rather than a modern flat.',
  'The author describes daily activities and encounters in the lane.'
];
export const partMatchingMap=[1,2,0];
export const partMatchingAnswers=partMatchingMap.map(index=>partMatchingOptions[index]);
export const partMatchingParagraphs=[
  'A writer arriving in a large city could rent a modern flat or find a room in an older lane house. She wanted a home where she could learn about ordinary people rather than see only the city skyline.',
  'The older houses stood close together beside narrow lanes. Their shared entrances and small courtyards suggested a way of life very different from the tall new buildings she had visited.',
  'After considering several places, the writer chose a lane house because it was quiet and connected her to the local community. These reasons explain the decision described in the opening part of the text.',
  'Each morning she saw neighbours hanging laundry and washing vegetables outside their doors. People greeted one another and exchanged small pieces of news while going about their work.',
  'At lunchtime, the smell of cooking filled the lane. One neighbour offered the writer some soup, and another explained how her family prepared a favourite dish for special occasions.',
  'Children returned from school in the afternoon and played beside the houses. Older residents watched them, helped them with homework and reminded them to keep the entrance clear.',
  'In the evening, families brought chairs outside and talked about their day. The writer listened to their stories and gradually became a familiar participant in the life of the lane.',
  'Looking back, the writer realized that these everyday encounters had changed her idea of a good home. The final reflection is that close human connections can bring lasting pleasure to ordinary life.'
];
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

// Fixed labels and sortable right options are interleaved siblings, as in the
// platform's renderer. The passage is synthetic and contains all eight parts.
export function partMatchingHTML({missing=false,duplicate=false,noMaterial=false,fallbackMaterial=false,reverse=false,rollback='none',grading='correct'}={}){
  const indices=[0,1,2];if(reverse)indices.reverse();
  const prompts=indices.map(index=>partMatchingPrompts[duplicate?0:index]),order=[0,1,2].slice(0,missing?2:3),expected=indices.map(index=>partMatchingMap[index]);
  const left=prompts.map(value=>{const at=value.indexOf(' (');return '<strong>'+escape(value.slice(0,at))+'</strong><p>'+escape(value.slice(at+1))+'</p>';});
  const card=id=>'<div class="sequence-reply-view-item-text" data-option-id="'+id+'"><span>'+String.fromCharCode(97+id)+'.</span><span>'+escape(partMatchingOptions[id])+'</span></div>';
  return `<!doctype html><html><body><style>
    body{font:16px Arial;margin:18px}header{padding-bottom:14px}.reading-layout{display:grid;grid-template-columns:49% 49%;gap:2%}.material,.reply{max-height:530px;overflow:auto;padding:12px}.textContainer p{line-height:24px;margin:0 0 18px}.sortable-list-wrapper{display:flex;flex-wrap:wrap;align-items:stretch;gap:0}.sortable-list-question-no{box-sizing:border-box;width:22%;padding:12px 8px 14px 0}.sortable-list-question-no p{font-size:13px;line-height:20px;margin:5px 0}.sequence-reply-view-item-text{box-sizing:border-box;width:78%;border:1px solid #9cf;border-radius:4px;background:#fafafa;line-height:24px;padding:12px;margin-bottom:15px;display:flex;gap:8px;cursor:move;user-select:none}.sequence-reply-view-item-text span:first-child{flex:none}.sortable-helper{pointer-events:none}footer{padding-top:15px}
    </style><header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">Offline Reading Book</span><span class="pc-break-crumb-text">A city community</span><span class="pc-break-crumb-text">Getting the idea</span></nav><div class="pc-header-tab-activity">Getting the idea</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header>
    <main id="exercise" class="layout-container"><div class="abs-direction">Directions: ${partMatchingDirections}</div><div class="reading-layout">${noMaterial?'<section class="material"></section>':'<section class="material '+(fallbackMaterial?'':'layout-material-container')+'"><div class="question-rich-text-read"><div class="textContainer"><h3>A home in the lanes</h3>'+partMatchingParagraphs.map((value,index)=>'<p><span class="paragraph-number">'+(index+1)+'</span> '+escape(value)+'</p>').join('')+'</div></div></section>'}<section class="reply"><div class="sequence-view"><div class="sortable-list-wrapper">${left.map((value,index)=>'<div class="sortable-list-question-no">'+value+'</div>'+(order[index]!==undefined?card(order[index]):'')).join('')}</div></div></section></div></main><footer><button id="submit">提交</button></footer>
    <script>
      window.answerOrder=${JSON.stringify(order)};window.dragEvents=0;window.submitted=false;window.moves=[];window.rollbackEvents=0;
      window.mountMatching=()=>{
        const texts=${JSON.stringify(partMatchingOptions)},labels=${JSON.stringify(left)},expected=${JSON.stringify(expected)};
        const Card=SortableHOC.SortableElement(({id})=>React.createElement('div',{className:'sequence-reply-view-item-text','data-option-id':id},React.createElement('span',null,String.fromCharCode(97+id)+'.'),React.createElement('span',null,texts[id])));
        const List=SortableHOC.SortableContainer(({items})=>React.createElement('div',{className:'sortable-list-wrapper'},labels.map((html,index)=>React.createElement(React.Fragment,{key:'row-'+index},React.createElement('div',{className:'sortable-list-question-no',dangerouslySetInnerHTML:{__html:html}}),items[index]!==undefined?React.createElement(Card,{key:items[index],id:items[index],index}):null))));
        class Matching extends React.Component{
          constructor(props){super(props);this.state={items:[...window.answerOrder]};}
          render(){return React.createElement(List,{items:this.state.items,axis:'y',lockAxis:'y',pressDelay:150,transitionDuration:300,helperClass:'sortable-helper',onSortEnd:({oldIndex,newIndex})=>{const previous=[...this.state.items],items=[...previous];items.splice(newIndex,0,...items.splice(oldIndex,1));window.moves.push({oldIndex,newIndex});window.dragEvents++;window.answerOrder=items;this.setState({items});if(${JSON.stringify(rollback)}==='always'||${JSON.stringify(rollback)}==='once'&&window.dragEvents===1)setTimeout(()=>{window.rollbackEvents++;window.answerOrder=previous;this.setState({items:previous});},650);}});}
        }
        ReactDOM.render(React.createElement(Matching),document.querySelector('.sequence-view'));
        document.getElementById('submit').onclick=()=>{window.submitted=true;window.submittedOrder=[...window.answerOrder];const correct=${JSON.stringify(grading)}==='incorrect'?2:JSON.stringify(window.answerOrder)===JSON.stringify(expected)?3:0;document.getElementById('exercise').innerHTML='<h2>答题小结</h2><p>共3道题，客观题3道，主观题0道</p><p>正确 ('+correct+'/3)</p><p>错误 ('+(3-correct)+'/3)</p><p>未作答0</p>';document.querySelector('footer').innerHTML='';};
      };
    </script></body></html>`;
}
