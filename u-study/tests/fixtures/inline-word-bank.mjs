export const inlineWordBankAnswers=['fill an appointment','a friend of my youth','for show','listened with interest','having a chat with'];

export function inlineWordBankHTML({draft='',material=true}={}){
  const blank=index=>`<span class="comp-abs-input"><input id="blank-${index}" type="text" value="${index===0?draft:''}"><span class="input-value-measure">${index===0?draft:''}</span></span>`;
  const sentences=[
    `Real friends will keep their word and ${blank(0)} no matter how far away they are from each other.`,
    `Li Ping is ${blank(1)}, and we still talk to each other from time to time.`,
    `She puts Shakespeare's works in her living room because she likes them, not just ${blank(2)}.`,
    `The police officer ${blank(3)} to the witnesses, trying to find out which one of them was lying.`,
    `I looked forward to ${blank(4)} my old classmates from university.`
  ];
  return `<!doctype html><html><body>
    <style>.input-value-measure{position:absolute;left:-10000px;white-space:pre}input{width:150px}</style>
    <main class="layout-container">
      <div class="abs-direction">Complete the following sentences with the correct form of the given expressions.</div>
      <div class="layoutBody-container">
        <div class="option-wrapper">${['have a chat with','listen with interest',"a friend of one's youth",'for show','fill an appointment'].map(word=>`<span class="option">${word}</span>`).join('')}</div>
        <div class="${material?'layout-material-container':'sentences'}"><div class="question-common-abs-scoop"><div class="item">${sentences.map((sentence,index)=>`<p data-sentence="${index}">${index+1}. ${sentence}</p>`).join('')}</div></div></div>
      </div>
    </main>
    <button id="submit" onclick="window.submitted=true">提交</button>
    <script>document.querySelectorAll('.comp-abs-input input').forEach(input=>{const mirror=()=>{input.nextElementSibling.textContent=input.value;input.style.width=Math.max(100,input.value.length*8)+'px';};input.addEventListener('input',mirror);input.addEventListener('blur',()=>{mirror();window.commits=(window.commits||0)+1;});});</script>
  </body></html>`;
}
