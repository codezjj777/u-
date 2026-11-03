export const realMatchingPrompts=[
  'Since there were no intermediate level courses available for this particular subject,',
  'Reading has always been a beloved pastime for Susan,',
  'She became fluent in English',
  'The plot of land was approximately five acres, perfect for the new park,',
  'Tom is a specialist in this particular field,',
  'Compared with contemporary jazz,',
  'I heard that the department is hiring new faculty',
  'Undoubtedly, continuous deforestation has led to a significant decrease in global forest coverage,',
  'They are unable to participate in sports and recreational events,',
  'Because of his expert command of multiple languages,'
];
export const realMatchingWords=['intermediate','pastime','fluent','approximately','specialist','contemporary','faculty','Undoubtedly','recreational','command'];
export const realMatchingOptions=[
  "according to the surveyor's estimation after some calculations.",
  'the diplomat was able to successfully negotiate peace treaties in various countries.',
  'I chose to take the introductory course.',
  'Steve is more interested in classical music.',
  'after years of dedicated study and cultural immersion.',
  'exacerbating the risk of climate change.',
  'to teach some of the new courses.',
  'so if you want any help, he can point you in the right direction.',
  'for they have much homework to complete.',
  'allowing her to explore different cultures and eras from her armchair.'
];
export const realMatchingInitial=[4,2,9,0,1,3,5,6,7,8];
export const realMatchingMap=[2,9,4,0,7,3,6,5,8,1];
export const realMatchingAnswers=realMatchingMap.map(index=>realMatchingOptions[index]);

export function realMatchingHTML({nestedScroll=true,rollback='none'}={}){
  return `<!doctype html><html><body><style>
    body{font:16px Arial;margin:20px}header{height:80px}.abs-direction{margin-bottom:25px}.panel{height:${nestedScroll?'430px':'auto'};overflow-y:${nestedScroll?'auto':'visible'};padding:25px 16px 20px}.sequence-view{display:grid;grid-template-columns:47% 50%;gap:3%}.sequence-question-view-item-text{min-height:62px;line-height:25px}.sequence-reply-view-item-text{box-sizing:border-box;margin-bottom:15px;border:1px solid #9cf;border-radius:4px;background:#fafafa;padding:10px;line-height:24px;display:flex;gap:10px;cursor:move;user-select:none}.sequence-reply-view-item-text span:first-child{flex:none}.sortable-helper{pointer-events:none}footer{padding-top:16px}
    </style><header><nav class="pc-break-crumb"><span class="pc-break-crumb-text">English Book</span><span class="pc-break-crumb-text">Time off</span><span class="pc-break-crumb-text">Language focus</span></nav><div class="pc-header-tab-activity">Language focus</div><div class="pc-task pc-header-task-activity">Exercise 1</div></header>
    <main id="exercise" class="layout-container"><div class="abs-direction">Directions: Match the sentence halves. Pay special attention to the meanings of the underlined words.</div><div class="panel"><div class="sequence-view"><div class="sequence-question-view">${realMatchingPrompts.map((prompt,index)=>`<div class="sequence-question-view-item-text">${index+1}. ${prompt.replace(realMatchingWords[index],'<u>'+realMatchingWords[index]+'</u>')}</div>`).join('')}</div><div class="sequence-reply-view" id="react-matching"></div></div></div></main><footer><button id="submit">提交</button></footer>
    <script>
      window.answerOrder=${JSON.stringify(realMatchingInitial)};window.dragEvents=0;window.submitted=false;window.moves=[];window.rollbackEvents=0;
      window.mountMatching=()=>{
        const texts=${JSON.stringify(realMatchingOptions)},expected=${JSON.stringify(realMatchingMap)};
        const Card=SortableHOC.SortableElement(({id})=>React.createElement('div',{className:'sequence-reply-view-item-text','data-option-id':id},React.createElement('span',null,String.fromCharCode(65+id)+'.'),React.createElement('span',null,texts[id])));
        const List=SortableHOC.SortableContainer(({items})=>React.createElement('div',{className:'sortable-list-wrapper'},items.map((id,index)=>React.createElement(Card,{key:id,id,index}))));
        class Matching extends React.Component{
          constructor(props){super(props);this.state={items:[...window.answerOrder]};}
          render(){return React.createElement(List,{items:this.state.items,axis:'y',lockAxis:'y',pressDelay:150,transitionDuration:300,helperClass:'sortable-helper',onSortEnd:({oldIndex,newIndex})=>{const previous=[...this.state.items],items=[...previous];items.splice(newIndex,0,...items.splice(oldIndex,1));window.moves.push({oldIndex,newIndex});window.dragEvents++;window.answerOrder=items;this.setState({items});if(${JSON.stringify(rollback)}==='always'||${JSON.stringify(rollback)}==='once'&&window.dragEvents===1||${JSON.stringify(rollback)}==='last-once'&&!window.rollbackEvents&&JSON.stringify(items)===JSON.stringify(expected))setTimeout(()=>{window.rollbackEvents++;window.answerOrder=previous;this.setState({items:previous});},650);}});}
        }
        ReactDOM.render(React.createElement(Matching),document.getElementById('react-matching'));
        document.getElementById('submit').onclick=()=>{window.submitted=true;window.submittedOrder=[...window.answerOrder];const correct=JSON.stringify(window.answerOrder)===JSON.stringify(expected)?10:0;document.getElementById('exercise').innerHTML='<h2>答题小结</h2><p>共10道题，客观题10道，主观题0道</p><p>正确 ('+correct+'/10)</p><p>错误 ('+(10-correct)+'/10)</p><p>未作答0</p>';document.querySelector('footer').innerHTML='';};
      };
    </script></body></html>`;
}
