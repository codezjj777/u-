// These functions run inside the application's own login window.
// They use only the visible course/quiz DOM and never call undocumented APIs.
export function collectCoursesFromDOM({ pageIndex = 0 } = {}) {
  // Carousel slides can be aria-hidden/inert while their book metadata is
  // still rendered. Those accessibility flags must not hide books from sync.
  const visible = el => {if(!el?.getClientRects().length)return false;for(let node=el;node;node=node.parentElement){const css=getComputedStyle(node);if(node.matches('[hidden]')||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return false;}return true;};
  const clean = x => String(x || '').replace(/\s+/g,' ').trim();
  const visibleText = node => node.nodeType===3?node.textContent:node.nodeType!==1||node.matches('script,style,noscript,svg,img,canvas')||!visible(node)?'':[...node.childNodes].map(visibleText).join(' ');
  const readProgress = el => {
    const text=clean(visibleText(el)).normalize('NFKC');
    // Whole-book task counts remain visible when a finished progress bar
    // replaces its percentage text with a check icon. Never use unit counts.
    if(/已(?:学|完成)任务/.test(text)){
      const counts=[...text.matchAll(/已(?:学|完成)任务(?:数)?\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/g)].map(match=>[Number(match[1]),Number(match[2])]);
      if(!counts.length||counts.some(([done,total])=>!Number.isSafeInteger(done)||!Number.isSafeInteger(total)||total<=0||done>total)||new Set(counts.map(value=>JSON.stringify(value))).size!==1)return null;
      const [done,total]=counts[0];return done===total?100:Math.min(99.99,Math.round(done/total*10000)/100);
    }
    const percentage=text.match(/(?:学习|课程)?(?:进度|完成率|完成度)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/)||text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if(percentage)return Math.min(100,Number(percentage[1]));
    const bars=[...el.querySelectorAll('[role=progressbar][aria-valuenow]')].filter(visible).map(bar=>{
      if(!bar.getAttribute('aria-valuenow').trim())return null;
      const current=Number(bar.getAttribute('aria-valuenow')),min=Number(bar.getAttribute('aria-valuemin')||0),max=Number(bar.getAttribute('aria-valuemax')||100);
      return Number.isFinite(current)&&Number.isFinite(min)&&Number.isFinite(max)&&max>min&&current>=min&&current<=max?(current===max?100:Math.min(99.99,Math.round((current-min)/(max-min)*10000)/100)):null;
    });
    return bars.length&&bars.every(value=>value!==null)&&new Set(bars).size===1?bars[0]:null;
  };
  const normalize = x => clean(x).normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').toLocaleLowerCase();
  const groupKey = group => JSON.stringify([group.name,group.className,group.period].map(normalize));
  const groupCache = new WeakMap();
  const findGroup = el => {
    for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      if(!groupCache.has(parent)){
        const text=clean(parent.innerText||parent.textContent);let group=null;
        if((text.match(/课程名称\s*[：:]/g)||[]).length===1&&/班级名称\s*[：:]/.test(text)&&/记分周期\s*[：:]/.test(text)){
          const field=label=>clean(text.match(new RegExp(label+'\\s*[：:]\\s*(.*?)(?=\\s*(?:课程名称|班级名称|记分周期|在学教程)\\s*[：:]|$)'))?.[1]);
          const name=field('课程名称').slice(0,200),className=field('班级名称').slice(0,200);
          const period=field('记分周期').match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*[-~～至]\s*\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/)?.[0]?.replace(/\s+/g,'');
          if(name&&className&&period)group={name,className,period};
        }
        groupCache.set(parent,group);
      }
      const group=groupCache.get(parent);if(group)return group;
    }
    return undefined;
  };
  const allowed = value => { try {const u=new URL(value,location.href);return u.protocol==='https:'&&(u.hostname==='unipus.cn'||u.hostname.endsWith('.unipus.cn'))?u.href:null;}catch{return null;} };
  const tileSelector = '[data-course-id],[data-courseid],[class*="course-card"],[class*="courseCard"],[class*="course-item"],[class*="courseItem"],[class*="course-box"],[class*="courseBox"],[class*="course-list"]>li,[class*="courseList"]>li';
  let tiles=[...document.querySelectorAll(tileSelector)].filter(visible);
  tiles=tiles.filter(el=>!tiles.some(child=>child!==el&&el.contains(child)));
  if(!tiles.length)tiles=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/course|learning|study|rsrc/i.test(el.getAttribute('href'))&&!/course-management|javascript:|^#$/i.test(el.getAttribute('href')));
  document.querySelectorAll('[data-ustudy-course-entry]').forEach(el=>el.removeAttribute('data-ustudy-course-entry'));
  const output=[],entries=[],seen=new Set();
  for(const el of tiles){
    const titleEl=el.querySelector('[class*="course-name"],[class*="courseName"],[class*="course-title"],[class*="courseTitle"],h2,h3,h4,[title]');
    const title=clean(titleEl?.getAttribute('title')||titleEl?.textContent||el.getAttribute('title')||el.querySelector('img')?.getAttribute('alt')||el.innerText?.split('\n').find(x=>clean(x).length>2));
    if(!title||title.length>200||/^(全部课程|我的课程|课程管理|查看更多|首页|下一页|上一页)$/.test(title))continue;
    const group=findGroup(el);
    const link=el.matches('a[href]')?el:el.querySelector('a[href]');
    const direct=link&&allowed(link.getAttribute('href'));
    const url=group?allowed(location.href):direct||allowed(location.href);if(!url)continue;
    const text=clean(visibleText(el));
    const idData=el.getAttribute('data-course-id')||el.getAttribute('data-courseid');
    const baseId=idData?'course-'+idData:direct?'url-'+direct:'title-'+title;
    const id=group?`group:${groupKey(group)}|book:${normalize(title)}|${(idData||'').slice(0,200)}`:baseId.slice(0,1200);
    const target=visible(titleEl)?titleEl:el;
    const marker=String(entries.length);target.setAttribute('data-ustudy-course-entry',marker);
    entries.push({id,title,...(group?{group}:{}),selector:`[data-ustudy-course-entry="${marker}"]`});
    if(seen.has(id))continue;seen.add(id);
    const subtitle=clean(el.querySelector('[class*="teacher"],[class*="subtitle"],[class*="description"],[class*="school"]')?.textContent);
    const progress=readProgress(el);
    const requiresActivation=[...el.querySelectorAll('button,a,[role=button]')].some(button=>visible(button)&&/^激活教程$/.test(clean(button.innerText||button.textContent)));
    output.push({id,title,subtitle,url,progress,requiresActivation,...(group?{group}:{}),status:progress===100||progress===null&&!/已(?:学|完成)任务/.test(text)&&/(?:^|\s)已完成(?:\s|$)/.test(text)?'completed':'active',...(!direct||group?{entry:{title,pageIndex}}:{})});
  }
  const body=document.body?.innerText||'';
  const countHint=output.some(course=>course.group)?0:Number(body.match(/共\s*(\d+)\s*(?:门(?:课程)?|个课程)/)?.[1]||0);
  const login=[...document.querySelectorAll('input[type=password]')].some(visible)||/登录|login|sso/i.test(location.pathname)&&output.length===0;
  const pagination=[...document.querySelectorAll('[class*="pagination"] button,[class*="pagination"] a,[class*="pagination"] li,[class*="Pagination"] button,[class*="pagination-next"],[aria-label="Next Page"],[aria-label="下一页"]')];
  const next=pagination.find(el=>visible(el)&&!el.matches(':disabled,[aria-disabled="true"],[class*="disabled"]')&&(/下一页|next/i.test(el.getAttribute('aria-label')||el.textContent)||/pagination-next/.test(el.className)));
  if(next)next.setAttribute('data-ustudy-next-courses','true');
  return {courses:output,entries,countHint,login,hasNext:!!next};
}

/** The active task tab identifies a directory leaf; the progress bar is only a hint. */
export function readExerciseNavigationFromDOM(){
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden="true"],[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const texts=selector=>[...document.querySelectorAll(selector)].filter(visible).map(el=>clean(el.getAttribute('title')||el.textContent)).filter(Boolean);
  const breadcrumbs=texts('.pc-break-crumb .pc-break-crumb-text');
  const chapters=texts('.pc-header-tab-activity');
  const leaves=texts('.pc-task.pc-header-task-activity');
  const progress=[...document.querySelectorAll('.layout-progress-container .comp-question-progress')].find(visible);
  const width=progress?.style.width||'',percent=/^\d+(?:\.\d+)?%$/.test(width)?Number(width.slice(0,-1)):null;
  const known=breadcrumbs.length>=2&&chapters.length===1&&leaves.length===1;
  return {known,key:known?JSON.stringify([breadcrumbs,chapters[0],leaves[0]]):'',title:leaves.length===1?leaves[0]:'',breadcrumbs,chapter:chapters.length===1?chapters[0]:'',progress:percent};
}

export const QUESTION_CONTROLS_HANDLER='question-controls-v4';
export function collectQuestionsFromDOM({ questionSelector = '', includeDiagnostics = false, mediaTranscripts = {}, imageDigests = {} } = {}) {
  // This function is serialized into each frame: keep all helpers inside it.
  const clean=value=>String(value??'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden="true"],[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const all=(scope,selector)=>[...scope.querySelectorAll(selector)];
  const outermost=nodes=>nodes.filter(el=>!nodes.some(parent=>parent!==el&&parent.contains(el)));
  const ignored='aside,[role=search],.pc-slider-content,.v3notes,.mark-edit-in,.show-mark-in,.discussion-course-page-sdk,.ds-discussion-bottom-textArea-container,.text-area-hide,[data-option-value],.option-wrapper,.banked-options';
  const explanation='[class*="shortAnswerWrap"],[class*="explanation"]';
  const textGroups='[data-ipublish-question-group-type="short_answer_group"],[data-ipublish-question-group-type="translation_group"],[data-ipublish-question-group-type="writing_group"]';
  const fieldCSS='input[type=text],input:not([type]),textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],.scoop-select-wrapper';
  const dropdownCSS='.scoop-select-wrapper,[class*="digEmptySelectView_selectTrigger"],[role=combobox],.ant-select-selector';
  const nativeCSS='input[type=radio],input[type=checkbox]';
  const customCSS='[role=radio],[role=checkbox],.ant-radio-wrapper,.ant-checkbox-wrapper,.el-radio,.el-checkbox';
  const controlCSS=`${fieldCSS},${nativeCSS},${customCSS},${dropdownCSS},.option-wrap>.option.isNotReview`;
  const enabled=el=>!el.disabled&&!el.readOnly&&!el.matches('[disabled],[readonly],[aria-disabled="true"],.disabled')&&!el.closest('fieldset[disabled]')&&!el.closest(ignored)&&(!el.closest(explanation)||el.closest(textGroups))&&!/(?:搜索|笔记|\bsearch\b|\bnotes?\b)/i.test([el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('name')].join(' '));
  const writable=el=>enabled(el)&&(visible(el)||el.matches(nativeCSS)&&visible(el.closest('label')));
  const issues=[],manualIssues=new Set(),items=[],covered=new Set(),mediaRequests=new Map(),scopeMedia=new WeakMap(),mediaRecords=new WeakMap(),videoRequests=new Map(),imageRequests=new Map(),imageRecords=new Map(),scopeImages=new WeakMap();
  const mediaIssue='听力 / 视频题缺少可读取的转写材料，需要先人工核对音视频内容。';
  const videoIssue='本题涉及眼神、表情或动作，需要先读取视频画面，不能仅凭音频转写作答。';
  const imageIssue='看图题的图片材料尚未读取，需要先取得完整图片。';
  const issue=message=>{if(!issues.includes(message))issues.push(message);};
  document.querySelectorAll('[data-ustudy-control]').forEach(el=>el.removeAttribute('data-ustudy-control'));
  document.querySelectorAll('[data-ustudy-sort-item],[data-ustudy-sort-key]').forEach(el=>{el.removeAttribute('data-ustudy-sort-item');el.removeAttribute('data-ustudy-sort-key');});

  // Walk the live DOM so paragraphs do not run together and typed values,
  // hidden review answers and measurement text never become question text.
  const text=(node,{fields=[],skip=[],choices=false}={})=>{
    const markers=new Map(fields.filter(el=>!el.matches('textarea,[contenteditable]')).map((el,i)=>[el,` ____ (${i+1}) `]));
    // Inline inputs render a sibling copy of their value to measure its width.
    // Replace the whole known blank wrapper, including that copy, in both the
    // question and any material block that contains the same editable sentence.
    const blankCSS='.comp-abs-input,[data-dig-empty-id]';
    const wrappers=node?outermost([...(node.matches?.(blankCSS)?[node]:[]),...all(node,blankCSS)].filter(el=>{
      const controls=all(el,fieldCSS);return visible(el)&&controls.length===1&&controls[0].matches('input[type=text],input:not([type])');
    })):[];
    for(const wrapper of wrappers){
      const field=wrapper.querySelector(fieldCSS);
      markers.set(wrapper,markers.get(field)||' ____ ');
    }
    const walk=el=>{
      if(el.nodeType===3)return el.textContent;
      if(el.nodeType!==1)return '';
      if(markers.has(el))return markers.get(el);
      if(el.matches('.scoop-select-wrapper'))return ' ____ ';
      if(skip.includes(el)||el.matches('script,style,noscript,[hidden],[aria-hidden="true"],[data-ustudy-video-frames],input,textarea,select,button,audio,video,.question-number,.text-area-hide,[contenteditable="true"],[contenteditable="plaintext-only"],[class*="shortAnswerWrap"],[class*="explanation"],[class*="answerPreview"],[data-ipublish-event-type]'))return '';
      if(choices&&el.matches('.sequence-reply-view,.sortable-list-wrapper,.sequence-reply-view-item-text'))return '';
      // Player clocks, speed menus and tooltips are live UI, not lesson text.
      // Some players replace the media element while keeping their outer shell.
      if(el.matches('.video-js,.prism-player,.dplayer,.plyr,.xgplayer,.mejs-container,.vjs-control-bar,.prism-controlbar,.dplayer-controller,.plyr__controls,[class*="control-bar"],[class*="controlbar"],[class*="time-display"],[class*="timeDisplay"],[role="slider"],[role="progressbar"]')||/player/i.test(el.className||'')&&el.querySelector('audio,video'))return '';
      const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return '';
      if(choices&&el.matches('label,[role=radio],[role=checkbox],.option-wrap,.option-wrapper,.banked-options,[data-option-value],[class*="strongListView"],[class*="answer_option"],.ant-radio-wrapper,.ant-checkbox-wrapper,.el-radio,.el-checkbox'))return '';
      if(el.tagName==='BR')return ' ';
      const value=[...el.childNodes].map(walk).join('');
      return /^(P|DIV|SECTION|H[1-6]|LEGEND|LI|TR|TD|TH|TABLE|UL|OL|BLOCKQUOTE)$/.test(el.tagName)?` ${value} `:value;
    };
    return node?clean(walk(node)):'';
  };
  const directionCSS='.abs-direction,.layout-direction-container,[data-question-direction]';
  const transcriptCSS='.transcript,.audio-transcript,.video-transcript,.audio-script,.video-script,[data-transcript]';
  const passageCSS=`.passage,[class*="reading-passage"],[class*="readingPassage"],[class*="material-content"],.question-common-abs-material,.layout-material-container,[data-ipublish-question-group-type="rich_text_read_group"],${transcriptCSS}`;
  const scopeFor=root=>root.closest('.layout-container,[data-exercise-id],.question-common-abs-question-container,main')||document.body;
  const blockTexts=(scope,selector)=>outermost(all(scope,selector).filter(visible)).map(el=>text(el,{choices:true})).filter(Boolean);
  const mediaURL=value=>{try{return new URL(value,document.baseURI||globalThis.location?.href||'https://ucontent.unipus.cn/').href;}catch{return '';}};
  const activeMedia=el=>{
    if(el.closest(ignored)||el.closest('.word-tips,.word-tip,[class*="pronunciation"]'))return false;
    for(let parent=el.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.matches('[hidden],[aria-hidden="true"],[inert]')||style.display==='none'||style.visibility==='hidden')return false;}
    return el.tagName==='AUDIO'||visible(el);
  };
  const documentMedia=all(document,'audio,video');
  const mediaRecord=el=>{
    if(mediaRecords.has(el))return mediaRecords.get(el);
    const declared=[...new Set([el.getAttribute('src'),...all(el,'source').map(source=>source.getAttribute('src'))].filter(Boolean).map(mediaURL).filter(Boolean))];
    const sources=[...new Set([el.currentSrc?mediaURL(el.currentSrc):'',...declared].filter(Boolean))];
    const tracks=all(el,'track[kind="subtitles"],track[kind="captions"],track:not([kind])').filter(track=>track.getAttribute('src')).map(track=>({url:mediaURL(track.getAttribute('src')),language:track.getAttribute('srclang')||'',label:track.getAttribute('label')||''})).filter(track=>track.url);
    const cues=[];try{for(const track of Array.from(el.textTracks||[]))if(['subtitles','captions'].includes(track.kind))for(const cue of Array.from(track.cues||[]))if(cue.text)cues.push(clean(cue.text));}catch{/* Cross-origin tracks may only be readable by their resource URL. */}
    // Loading currentSrc or unrelated pronunciation clips must not invalidate
    // a transcript for an unchanged declared resource. Identical assets share it.
    const identitySources=declared.length?declared:sources;
    const identity=JSON.stringify([el.tagName,identitySources.slice().sort(),tracks.map(track=>track.url).sort(),identitySources.length?'':el.id||documentMedia.indexOf(el)]);let hash=2166136261;for(const c of identity)hash=Math.imul(hash^c.charCodeAt(0),16777619);
    const record={key:'media-'+(hash>>>0).toString(36),sources,tracks,cueText:cues.join(' '),duration:Number.isFinite(el.duration)?el.duration:0,kind:el.tagName.toLowerCase()};
    if(record.kind==='video'){const marker=record.key+'-'+documentMedia.indexOf(el);el.setAttribute('data-ustudy-media-key',record.key);el.setAttribute('data-ustudy-media-instance',marker);record.selector='[data-ustudy-media-instance="'+marker+'"]';}
    mediaRecords.set(el,record);return record;
  };
  const contextFor=(root,extra=[])=>{
    const scope=scopeFor(root),directions=blockTexts(scope,directionCSS);
    if(!directions.length&&scope!==document.body)directions.push(...all(document,directionCSS).filter(el=>visible(el)&&!el.closest('.layout-container,[data-exercise-id],.question-common-abs-question-container,main')).map(el=>text(el)));
    // Follow-up exercises often say "Read ... again" or "Correct the false
    // ones" while keeping the video beside the answer fields. The authored
    // media in this exercise scope is material even without watch/listen verbs.
    const elements=all(scope,'audio,video').filter(activeMedia),videos=elements.filter(el=>el.tagName==='VIDEO');
    // Pronunciation clips in Words & tips are supplementary to a visible video.
    const media=(videos.length?videos:elements).map(mediaRecord);
    const embedded=blockTexts(scope,transcriptCSS),transcripts=[];
    scopeMedia.set(scope,media.map(record=>record.key));
    for(const record of media){
      const cached=typeof mediaTranscripts[record.key]==='string'?clean(mediaTranscripts[record.key]):'';
      const transcript=cached||record.cueText;
      if(transcript)transcripts.push(`音视频原文：${transcript}`);
      else if(!embedded.length){mediaRequests.set(record.key,record);issue(mediaIssue);}
    }
    const materials=blockTexts(scope,passageCSS);
    const imageHint=/\b(?:look at|describe|compare|observe|study)\b[^.]{0,100}\b(?:photos?|pictures?|images?|illustrations?)\b|看图|描述.*图|根据.*图片/i.test(directions.join(' '));
    const imageRoots=[root,...all(scope,passageCSS),...(imageHint?[scope]:[])];
    const materialImage=el=>visible(el)&&(!el.closest('[data-ustudy-video-frames]')||media.some(record=>record.key===el.closest('[data-ustudy-video-frames]').getAttribute('data-ustudy-video-frames')))&&!el.closest(ignored)&&!el.closest('header,nav,button,[class*="avatar"],[class*="logo"],.word-tips,.word-tip,[contenteditable="true"],[contenteditable="plaintext-only"]')&&!(el.naturalWidth>0&&el.naturalWidth<48&&el.naturalHeight<48);
    const sourceIdentity=el=>el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('srcset')||el.getAttribute('src')||el.currentSrc||'';
    const pictures=[...new Set(imageRoots.flatMap(node=>all(node,'img')))].filter(materialImage),eligible=all(document,'img').filter(materialImage);
    if(imageHint&&!pictures.length)issue('看图题尚未显示完整图片，不能仅凭文字作答。');
    if(pictures.length>12)issue('当前题组超过 12 张图片，尚未确认完整图片材料。');
    const refs=pictures.map(el=>{
      const caption=el.closest('figure')?.querySelector('figcaption');let near='';
      for(let parent=el.parentElement,depth=0;parent&&depth<3;parent=parent.parentElement,depth++){const value=text(parent,{choices:true});if(value&&value.length<=120){near=value;break;}if(parent===scope)break;}
      const label=clean(text(caption)||(near&&near.length<=120?near:'')||el.getAttribute('alt')||el.getAttribute('aria-label')||'图片').slice(0,200);
      const identity=sourceIdentity(el),ordinal=eligible.filter(image=>sourceIdentity(image)===identity).indexOf(el);
      // Page chrome can insert images while the exercise is being captured.
      // Unrelated global IMG indexes are not authored material identity.
      let hash=2166136261;for(const char of JSON.stringify([identity,ordinal]))hash=Math.imul(hash^char.charCodeAt(0),16777619);
      const key='image-'+(hash>>>0).toString(36),marker=key;el.setAttribute('data-ustudy-material-image',marker);
      const record={key,label,selector:`[data-ustudy-material-image="${marker}"]`,url:el.currentSrc||el.getAttribute('data-src')||el.getAttribute('src')||'',width:el.naturalWidth||0,height:el.naturalHeight||0};imageRecords.set(key,record);
      if(!imageDigests[key]){imageRequests.set(key,record);issue(imageIssue);}
      return {key,label};
    });scopeImages.set(scope,refs);
    const embeddedMaterial=embedded.filter(value=>!materials.some(material=>material.includes(value)));
    const context=[...new Set([...directions,...materials,...embeddedMaterial,...extra,...transcripts].filter(Boolean))].join(' ');
    if(context.length>60000)issue('阅读材料超过 60,000 字符，无法完整识别，请缩小本次题目范围。');
    return {context:context.slice(0,60000),directions:directions.join(' ')};
  };
  const add=(root,{fields=[],choices=[],options=[],kind='native',type='text',question='',context='',wordBank=[],blankOptions=[],questionType='',prompts=[],promptEmphasis=[],sortItems=[]}={})=>{
    if(!question||question.length>20000){issue('有作答控件缺少完整题干，无法确认题目与答案的对应关系。');return;}
    if(choices.length&&(options.length!==choices.length||options.some(value=>!value))){issue('选择题的选项文字或控件未完整识别。');return;}
    const elements=choices.length?choices:fields;
    if(!elements.length)return;
    if(elements.some(el=>covered.has(el))){issue('题目容器重叠，无法唯一定位作答控件。');return;}
    elements.forEach(el=>covered.add(el));
    items.push({root,elements,question,options,type,context,wordBank,blankOptions,kind,id:root.getAttribute('data-question-id')||root.id||'',fields,questionType,prompts,promptEmphasis,sortItems,mediaKeys:scopeMedia.get(scopeFor(root))||[],images:scopeImages.get(scopeFor(root))||[]});
  };
  const fieldOptions=fields=>fields.map(el=>{
    if(el.matches('.scoop-select-wrapper')){
      // These direct children measure the public menu options, not review keys.
      const measurements=[...el.children].filter(node=>node.tagName==='DIV'&&node.style.visibility==='hidden'&&node.style.position==='absolute');
      const triggers=all(el,'.ant-dropdown-trigger.user-answer');
      const values=measurements.length===1?[...measurements[0].children].filter(node=>node.tagName==='I').map(node=>clean(node.textContent)):[];
      if(triggers.length!==1||values.length<2||values.length>100||values.some(value=>!value)||new Set(values.map(value=>value.normalize('NFKC'))).size!==values.length)return [];
      return values.map(value=>({text:value,value}));
    }
    return el.tagName==='SELECT'?all(el,'option').filter(option=>!option.disabled&&!option.hidden&&!/^(?:请选择|选择答案|please select|select(?: an? (?:option|answer))?|choose(?: an? (?:option|answer))?|[-—]+)$/i.test(clean(option.textContent))&&(option.getAttribute('value')!==''||clean(option.textContent)==='0')).map(option=>({text:clean(option.textContent),value:option.getAttribute('value')??option.textContent})):[];
  });
  const bankFor=root=>[...new Set(all(root,'[data-option-value],.option-wrapper .option,.banked-options .option').filter(visible).map(el=>clean(el.getAttribute('data-option-value')||text(el))).filter(Boolean))];

  // Fixed prompts can be sentence halves or text-part/paragraph references.
  // Their sortable answer order is a value, never part of the question stem.
  const matchedSortables=new Set();
  const sequenceRoots=outermost(all(document,'.sequence-view,.sortable-list-wrapper').filter(visible));
  for(const candidate of sequenceRoots){
    const root=candidate.matches('.sequence-view')?candidate:candidate.closest('.question-common-abs-reply,.layout-reply-container,.layoutBody-container')||candidate.parentElement;
    if(!root||root.closest(ignored)||questionSelector&&!root.matches(questionSelector)&&!root.closest(questionSelector)&&!root.querySelector(questionSelector))continue;
    const lists=all(root,'.sortable-list-wrapper').filter(visible);if(root.matches('.sortable-list-wrapper'))lists.unshift(root);
    if(lists.length!==1)continue;
    const list=lists[0],scope=scopeFor(root),material=blockTexts(scope,passageCSS),extra=blockTexts(scope,'.question-rich-text-read .textContainer').filter(value=>!material.some(part=>part.includes(value))),{context,directions}=contextFor(root,extra);
    const mainIdea=/\bmatch\b.*\b(?:parts?|paragraphs?|sections?)\b.*\b(?:main\s+ideas?|headings?)\b|段落.*(?:主旨|大意).*配对|匹配.*段落.*(?:主旨|大意)/i.test(directions);
    const functions=/\bmatch\b[^.]*\bnumbers?\b[^.]*\bfunctions?\b|(?:交际|交际用语|表达).*(?:功能|作用).*(?:匹配|配对)/i.test(directions);
    const responses=/\bmatch\b[^.]*\bquestions?\b[^.]*\b(?:expressions?|responses?|replies|answers?)\b|(?:问句|问题).*(?:回应|回答|答语).*(?:匹配|配对)|(?:匹配|配对).*(?:问句|问题).*(?:回应|回答|答语)/i.test(directions);
    if(!mainIdea&&!functions&&!responses&&!/\bmatch\b.*\b(?:sentence|halves|parts)\b|匹配.*句|句.*配对/i.test(directions))continue;
    if(mainIdea&&![...material,...extra].some(value=>value.length>=80)){issue('段落主旨配对题缺少完整阅读原文，尚未填写。');continue;}
    const cards=all(list,'.sequence-reply-view-item-text').filter(el=>visible(el)&&!el.closest('.sortable-helper,.ui-sortable-helper')&&el.closest('.sortable-list-wrapper')===list);
    if(cards.length<2||cards.length>100){issue('句子配对题的右侧选项尚未完整载入。');continue;}
    const unnumber=value=>clean(value).replace(/^\d+\s*(?:[.、)）．:]|\s)\s*/,'').trim();
    let left=[];
    for(const selector of ['.sequence-question-view-item-text','.sequence-question-view-item','.sequence-question-view > .item','.sequence-question-view > p','.sequence-question-view > div','.sortable-list-question-no']){
      const found=outermost(all(root,selector).filter(el=>visible(el)&&!el.contains(list)&&!el.closest('.sequence-reply-view-item-text')&&unnumber(text(el)).length>1));
      if(found.length===cards.length){left=found;break;}
    }
    if(!left.length){
      const found=all(root,'div,p,li').filter(el=>visible(el)&&!list.contains(el)&&!el.contains(list)&&!el.closest(directionCSS)&&/^\d+\s*[.、)）．:]/.test(text(el))&&unnumber(text(el)).length>1);
      const leaves=found.filter(el=>!found.some(child=>child!==el&&el.contains(child)));if(leaves.length===cards.length)left=leaves;
    }
    if(left.length!==cards.length){issue('句子配对题的左侧句子与右侧选项数量不一致，尚未填写。');continue;}
    const prompts=left.map(el=>unnumber(text(el)));
    let functionMaterial='';
    if(functions){
      const groups=prompts.map(prompt=>/^(?:\d+\s*[,，、]\s*)*\d+$/.test(prompt)?prompt.split(/[,，、]/).map(Number):[]);
      const nodes=all(scope,'.question-common-abs-material p,.question-common-abs-material li,.question-common-abs-material div,.layout-material-container p,.layout-material-container li,.sequence-question-view-item-text').filter(el=>visible(el)&&!list.contains(el)&&/^\d+\s*[.、)）．:]\s*\S/.test(text(el))&&unnumber(text(el)).length>1);
      const leaves=nodes.filter(el=>!nodes.some(child=>child!==el&&el.contains(child)));
      const expressions=leaves.map(el=>({number:Number(text(el).match(/^\d+/)[0]),body:unnumber(text(el)),emphasis:[...new Set(all(el,'b,strong,u,em').filter(visible).map(el=>text(el)).filter(Boolean))]})).sort((a,b)=>a.number-b.number);
      const numbers=groups.flat(),source=expressions.map(item=>item.number);
      if(groups.some(group=>!group.length)||!source.length||new Set(source).size!==source.length||new Set(numbers).size!==numbers.length||JSON.stringify([...numbers].sort((a,b)=>a-b))!==JSON.stringify(source)){
        issue('交际功能配对题的表达原文或编号分组不完整、重复或无法对应，尚未填写。');continue;
      }
      functionMaterial='Numbered expressions:\n'+expressions.map(item=>`${item.number}. ${item.body}${item.emphasis.length?' [Emphasized: '+item.emphasis.join(' / ')+']':''}`).join('\n');
      if(context.length+functionMaterial.length>60000){issue('交际功能配对题材料过长，尚未完整识别。');continue;}
    }
    const promptEmphasis=left.map(el=>[...new Set(all(el,'u,span,em,strong').filter(node=>visible(node)&&(node.tagName==='U'||/underline/.test(node.getAttribute('style')||'')||/underline/.test(getComputedStyle(node).textDecorationLine||getComputedStyle(node).textDecoration||''))).map(node=>text(node)).filter(Boolean))]);
    const parsed=cards.map(el=>{
      const first=el.firstElementChild,labelText=first?.tagName==='SPAN'?text(first):'',label=labelText.match(/^([A-Z])[.、)）:]?$/i);
      if(label){const body=clean([...el.childNodes].filter(node=>node!==first).map(node=>node.nodeType===3?node.textContent:text(node)).join(' '));if(body)return {el,text:body,originalLabel:label[1].toUpperCase()};}
      const raw=text(el),match=raw.match(/^([A-Z])[.、)）:]\s*(.+)$/i);return {el,text:match?match[2]:raw,...(match?{originalLabel:match[1].toUpperCase()}:{})};
    });
    if(new Set(parsed.map(item=>clean(item.text).toLocaleLowerCase())).size!==cards.length||parsed.some(item=>!item.text)||new Set(prompts.map((prompt,index)=>JSON.stringify([prompt,promptEmphasis[index]]))).size!==prompts.length){issue('句子配对题有重复或缺失的句子，无法唯一对应全部配对。');continue;}
    parsed.sort((a,b)=>a.text.toLocaleLowerCase()<b.text.toLocaleLowerCase()?-1:a.text.toLocaleLowerCase()>b.text.toLocaleLowerCase()?1:0);
    const sortItems=parsed.map((item,index)=>({...item,key:'match-'+index}));
    add(root,{fields:[list],kind:'sortable',type:'matching',question:directions,context:context+(functionMaterial?'\n\n'+functionMaterial:''),options:sortItems.map(item=>item.text),prompts,promptEmphasis,sortItems,questionType:mainIdea?'main_idea_matching':functions?'communicative_function_matching':responses?'question_response_matching':'sentence_matching'});
    matchedSortables.add(list);matchedSortables.add(candidate);
  }

  // The published player declares its question types. Option nodes also carry
  // data-question-id, so only outer question nodes are allowed to be roots.
  const groups=all(document,'[data-ipublish-question-group-type]').filter(visible);
  for(const group of groups){
    if(questionSelector&&!group.matches(questionSelector)&&!group.closest(questionSelector)&&!group.querySelector(questionSelector))continue;
    const groupType=group.getAttribute('data-ipublish-question-group-type')||'';
    if(groupType==='rich_text_read_group')continue;
    const submit=all(group,'[data-ipublish-event-type="question-submit"]').find(visible);
    if(submit&&/重新作答|已提交|查看答案|已批改/.test(clean(submit.textContent)))continue;
    const known=/^(?:single_choice|multiple_choice|multi_choice|true_false|fill_blanks|fill_blanks_choice|short_answer|translation|writing)_group$/;
    if(!known.test(groupType)){
      const message=`暂不支持题型 ${groupType||'未知 ipublish 题型'}，需要手动处理。`;issue(message);
      if(/^oral_[a-z_]+_group$/.test(groupType))manualIssues.add(message);
      continue;
    }
    const nodes=outermost(all(group,'[data-question-id]').filter(el=>!el.hasAttribute('data-option-value')&&!el.closest('[data-option-value]')&&el.closest('[data-ipublish-question-group-type]')===group));
    const extras=outermost(all(group,'.editor-content').filter(el=>!nodes.some(node=>node.contains(el))&&!el.closest('[data-option-value]'))).map(el=>text(el,{choices:true}));
    const block=group.closest('[data-lexical-node-type="question-block"]');
    for(let el=block?.previousElementSibling,n=0;el&&n<12;el=el.previousElementSibling,n++){
      if(!el.matches('p,table,ul,ol,blockquote,[data-lexical-node-type="base-paragraph"],[data-lexical-node-type="paragraph"],[data-lexical-node-type="highlight-block"],[data-lexical-node-type="table"],[data-lexical-node-type="list"]')||el.querySelector('[data-ipublish-question-group-type]'))break;
      if(visible(el))extras.unshift(text(el,{choices:true}));
    }
    const {context}=contextFor(group,extras);
    for(const root of nodes.length?nodes:[group]){
      if(!visible(root))continue;
      if(/^(?:single_choice|multiple_choice|multi_choice|true_false)_group$/.test(groupType)){
        const tf=groupType==='true_false_group';
        const rows=outermost(all(root,tf?'[class*="answer_option"]':'[class*="strongListView"]').filter(visible));
        const choices=rows.map(row=>tf?row:row.querySelector('[class*="strongItem"]')||row);
        const options=rows.map(row=>tf?({T:'True',TRUE:'True','正确':'True',F:'False',FALSE:'False','错误':'False'}[clean(row.textContent).toUpperCase()]||''):text(row.querySelector('.editor-content')||row));
        if(choices.length<2||choices.some(el=>!enabled(el))){issue('ipublish 选择题的选项尚未完整载入。');continue;}
        add(root,{choices,options,kind:'ipublish-choice',type:/multiple|multi_choice/.test(groupType)?'multiple':'single',question:text(root,{choices:true}),context,questionType:groupType});
      }else{
        const blanks=all(root,'[data-dig-empty-id]').filter(visible);
        let fields=all(root,fieldCSS).filter(writable);
        if(/^fill_blanks/.test(groupType)){
          fields=fields.filter(el=>el.matches('input')&&(el.closest('[data-dig-empty-id]')||/answerInput/.test(el.className)));
          if(!fields.length||blanks.length&&blanks.length!==fields.length){issue('填空题的空位与输入框数量不一致，题目尚未完整载入。');continue;}
        }else{
          fields=fields.filter(el=>el.matches('textarea,[contenteditable]'));
          const answers=fields.filter(el=>clean(el.getAttribute('placeholder'))!=='请输入');if(answers.length)fields=answers;
        }
        if(!fields.length){issue('ipublish 文本题没有可确认的答案输入框。');continue;}
        const wordBank=[...new Set([...bankFor(group),...bankFor(root)])];
        add(root,{fields,question:text(root,{fields,choices:true}),context,wordBank,questionType:groupType});
      }
    }
  }

  const defaultRoots='[data-question-id],fieldset,.question-item,.questionItem,.test-question,.topic-item,.question-box,.question,.single-choice,.multiple-choice,[class*="question-container"],[class*="questionContainer"],.question-common-abs-choice,.question-common-abs-reply,.question-common-abs-reply .question-inputbox,.question-common-abs-scoop>.item,.question-common-abs-scoop';
  let roots=all(document,questionSelector||defaultRoots).filter(el=>visible(el)&&!el.matches('.question-common-abs-question-container')&&!el.closest('[data-ipublish-question-group-type]')&&!el.closest(ignored)&&all(el,controlCSS).some(writable));
  if(!questionSelector){
    // Add layout fallbacks even when another question on this page was found.
    for(const root of all(document,'.layoutBody-container,.layout-reply-container,.reply-wrap,.layout-container').filter(visible)){
      if(root.closest('[data-ipublish-question-group-type]'))continue;
      if(all(root,controlCSS).some(el=>writable(el)&&!el.closest('[data-ipublish-question-group-type]')&&!roots.some(candidate=>candidate.contains(el))))roots.push(root);
    }
    const nativeGroups=new Map();
    for(const el of all(document,nativeCSS).filter(writable)){
      if(el.closest('[data-ipublish-question-group-type]')||roots.some(root=>root.contains(el)))continue;
      const owner=el.closest('form,[role=radiogroup]')||document.body,key=el.name||el.closest('fieldset')||el.parentElement?.parentElement;
      if(!nativeGroups.has(owner))nativeGroups.set(owner,new Map());const map=nativeGroups.get(owner);
      if(!map.has(key))map.set(key,[]);map.get(key).push(el);
    }
    for(const map of nativeGroups.values())for(const inputs of map.values()){
      if(inputs.length<2)continue;let root=inputs[0].parentElement;
      while(root&&root!==document.body&&!inputs.every(el=>root.contains(el)))root=root.parentElement;
      for(let n=0;n<4&&root&&root!==document.body;n++,root=root.parentElement){
        if(root.querySelector('legend,h2,h3,h4,[class*="stem"],[class*="title"],[class*="topic"]')){roots.push(root);break;}
      }
    }
  }
  roots=[...new Set(roots)];
  for(const root of roots){
    const children=roots.filter(child=>child!==root&&root.contains(child));
    const own=el=>!el.closest('[data-ipublish-question-group-type]')&&!children.some(child=>child.contains(el));
    const native=all(root,nativeCSS).filter(el=>own(el)&&writable(el));
    const unipus=root.matches('.question-common-abs-choice');
    const custom=native.length?[]:outermost(all(root,unipus?'.option-wrap>.option.isNotReview':customCSS).filter(el=>own(el)&&writable(el)));
    const choices=native.length?native:custom;
    const fields=all(root,fieldCSS).filter(el=>own(el)&&writable(el));
    if(!choices.length&&!fields.length)continue;
    if(choices.length&&fields.length){issue('同一题目混有选择与文本控件，尚不能确认各小题边界。');continue;}
    if(new Set(native.filter(el=>el.type==='radio').map(el=>el.name||'')).size>1){issue('同一容器含多组单选题，无法确认每组题干。');continue;}
    const {context,directions}=contextFor(root);
    const header=all(root,'.ques-title,.question-inputbox-header,legend,[class*="question-title"],[class*="questionTitle"],[class*="question-stem"],[class*="questionStem"],[class*="stem"],.topic,h2,h3,h4').find(el=>own(el)&&visible(el));
    let question=choices.length?text(header):'';
    if(!question){
      const plain=text(root,{skip:children,choices:true});
      question=header&&plain===text(header)?plain:text(root,{fields,skip:children,choices:true});
    }
    if(fields.length&&!header&&/^(?:\(?\s*\d+\s*\/\s*\d+\s*\)?(?:\s*(?:words?|字|字符))?|请输入答案[.。…]*)$/i.test(question))question='';
    if(!question&&root.closest('.layout-container,.question-common-abs-reply,.question-common-abs-scoop'))question=directions;
    if(choices.length){
      const options=choices.map(el=>{
        const label=(unipus&&el.querySelector('.content'))||el.labels?.[0]||el.closest('label')||el.closest('.ant-radio-wrapper,.ant-checkbox-wrapper,.el-radio,.el-checkbox')||el;
        return text(label)||clean(el.getAttribute('aria-label'));
      });
      if(choices.length<2){issue('选择题选项不足两个，可能尚未完整载入。');continue;}
      const multiple=choices.some(el=>el.type==='checkbox'||el.getAttribute('role')==='checkbox'||/checkbox/i.test(el.className))||/multiple[-_]?choice|multi[-_]?choice/i.test(root.className)||/多选|多项|\b(?:choose|select|check|tick|mark)\s+(?:all|two|three|four|five|six|seven|eight|nine|ten|[2-9]|multiple|more than one)\b/i.test(`${directions} ${question}`);
      if(unipus&&!multiple&&choices.filter(el=>el.classList.contains('selected')).length>1){issue('单选题已有多个选中项，题型或页面状态存在冲突。');continue;}
      add(root,{choices,options,type:multiple?'multiple':'single',kind:native.length?'native':unipus?'unipus-choice':'custom',question,context});
    }else{
      const choices=fieldOptions(fields);
      if(fields.some((el,i)=>(el.tagName==='SELECT'||el.matches('.scoop-select-wrapper'))&&(el.multiple||!choices[i].length))){issue('下拉填空选项为空、不唯一或尚未完整载入。');continue;}
      const bankScope=root.closest('.layoutBody-container')||root;
      add(root,{fields,question,context,wordBank:bankFor(bankScope),blankOptions:choices});
    }
  }

  // A partial match must never look like a complete exercise to the submitter.
  const coverageScope=questionSelector?all(document,questionSelector):all(document,`${defaultRoots},.layoutBody-container,.layout-reply-container`);
  for(const root of coverageScope.filter(visible))for(const el of all(root,controlCSS).filter(writable)){
    if(el.closest('[data-ipublish-question-group-type]'))continue;
    if(covered.has(el)||[...covered].some(target=>target.contains(el)||el.contains(target)))continue;
    issue('页面存在未归属到题目的可作答控件，已阻止漏题后自动提交。');
  }
  for(const el of all(document,`.sequence-view,.sortable-list-wrapper,${dropdownCSS}`))if(writable(el)&&!matchedSortables.has(el)&&!covered.has(el)&&![...covered].some(target=>target.contains(el)))issue('检测到尚未适配的排序或自定义下拉控件，需要手动处理。');
  const order=new Map(all(document,'*').map((el,i)=>[el,i]));
  items.sort((a,b)=>order.get(a.root)-order.get(b.root));
  const questions=items.map((item,r)=>{
    if(item.type==='matching'){
      const marker=`q${r}-sort`;item.elements[0].setAttribute('data-ustudy-control',marker);
      // React can replace this entire subtree on mouse-down. Keep a selector
      // for the authored component as well as our temporary diagnostic marks.
      const path=[];for(let node=item.root;node&&node!==document.body;node=node.parentElement){const tag=node.tagName.toLowerCase(),siblings=[...node.parentElement.children].filter(el=>el.tagName===node.tagName);path.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');}
      const rootSelector=item.root.matches('.sequence-view')?'.sequence-view':item.root===document.body?'body':'body > '+path.join(' > ');
      const selector=`[data-ustudy-control="${marker}"]`,sortItems=item.sortItems.map((choice,index)=>{const id=`q${r}-i${index}`;choice.el.setAttribute('data-ustudy-sort-item',id);choice.el.setAttribute('data-ustudy-sort-key',choice.key);return {key:choice.key,text:choice.text,...(choice.originalLabel?{originalLabel:choice.originalLabel}:{}),selector:`${selector} [data-ustudy-sort-item="${id}"]`};});
      return {question:item.question,type:item.type,questionType:item.questionType,context:item.context,options:item.options,prompts:item.prompts,promptEmphasis:item.promptEmphasis,targets:[{selector,rootSelector,kind:'sortable',key:'matching-'+r,itemSelector:'.sequence-reply-view-item-text[data-ustudy-sort-key]',items:sortItems}],...(item.id?{id:item.id}:{})};
    }
    const targets=item.elements.map((el,i)=>{
      const marker=`q${r}-${item.type==='text'?'t':'o'}${i}`;el.setAttribute('data-ustudy-control',marker);
      const kind=item.type!=='text'?item.kind:el.matches('.scoop-select-wrapper')?'unipus-select':el.tagName==='SELECT'?'select':el.hasAttribute('contenteditable')?'editable':'text';
      let selector=`[data-ustudy-control="${marker}"]`;
      if(kind==='unipus-select'){
        // The component may rerender when the menu opens or a value commits.
        const path=[];for(let node=el;node&&node!==document.body;node=node.parentElement){const tag=node.tagName.toLowerCase(),siblings=[...node.parentElement.children].filter(sibling=>sibling.tagName===node.tagName);path.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');}
        selector='body > '+path.join(' > ')+'.scoop-select-wrapper';
      }
      return {selector,kind,key:el.closest('[data-dig-empty-id]')?.getAttribute('data-dig-empty-id')||el.closest('[data-scoop-index]')?.getAttribute('data-scoop-index')||el.id||el.getAttribute('name')||String(i),...(item.blankOptions[i]?.length?{choices:item.blankOptions[i]}:{}),...(kind==='text'&&el.closest('[data-ipublish-question-group-type]')?{inputMode:'keyboard'}:{})};
    });
    return {question:item.question,options:item.options,type:item.type,targets,context:item.context,...(item.questionType?{questionType:item.questionType}:{}),...(item.id?{id:item.id}:{}),...(item.mediaKeys.length?{mediaKeys:item.mediaKeys}:{}),...(item.wordBank.length?{wordBank:item.wordBank}:{}),...(item.blankOptions.some(options=>options.length)?{blankOptions:item.blankOptions.map(options=>options.map(option=>option.text))}:{})};
  });
  questions.forEach((question,index)=>{if(items[index].images.length){question.images=items[index].images;question.imageKeys=items[index].images.map(image=>image.key);}});
  for(const [index,question] of questions.entries()){
    if(!/\beye\s+contact\b|\bfacial\s+expressions?\b|\bbody\s+language\b|\bnon[- ]?verbal\b|\bgestures?\b|\bpostures?\b|眼神|目光|肢体语言|表情|手势|动作/i.test(question.question))continue;
    const scope=scopeFor(items[index].root);
    for(const video of all(scope,'video').filter(activeMedia)){
      const record=mediaRecord(video);if([...scope.querySelectorAll('[data-ustudy-video-frames]')].some(el=>el.getAttribute('data-ustudy-video-frames')===record.key&&el.querySelector('img')))continue;
      videoRequests.set(record.selector,record);issue(videoIssue);
    }
  }
  const hasAnswerControls=all(document,controlCSS).some(writable)||questions.some(question=>question.type==='matching');
  if(hasAnswerControls&&!questions.length&&!issues.length)issue('页面存在可作答控件，但尚未识别到完整题目，需要手动核对。');
  const manualOnly=!questions.length&&!hasAnswerControls&&issues.length>0&&issues.every(message=>manualIssues.has(message));
  return includeDiagnostics?{questions,issues,manualOnly,hasAnswerControls,mediaIssues:[mediaIssue,videoIssue].filter(value=>issues.includes(value)),mediaRequests:[...mediaRequests.values()],videoRequests:[...videoRequests.values()],imageIssues:issues.includes(imageIssue)?[imageIssue]:[],imageRequests:[...imageRequests.values()],imageRecords:[...imageRecords.values()]}:questions;
}

// One serialized reader owns both notice detection and action selection. A
// retained portal outside the viewport cannot be the prompt covering a lesson.
export function readStudyNoticesFromDOM({kind='',includeDiagnostics=false}={}){
  const visible=el=>{
    if(!el?.getClientRects().length)return false;
    const box=el.getBoundingClientRect();if(box.width<=0||box.height<=0)return false;
    for(let node=el;node;node=node.parentElement){const css=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||Number(css.opacity)===0)return false;}
    return true;
  };
  const renderedText=node=>{
    if(node.nodeType===3)return node.textContent||'';
    if(node.nodeType!==1||!visible(node)||node.matches('script,style,noscript'))return '';
    return [...node.childNodes].map(renderedText).join(' ');
  };
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const roots=[...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog,.ant-modal,.el-message-box')];
  const known=roots.filter(el=>{const text=clean(renderedText(el));return /本单元学习时间/.test(text)&&/是否必修/.test(text);});
  const leaves=known.filter(el=>!known.some(child=>child!==el&&el.contains(child)));
  const reports=[],candidates=[];let offscreen=0;
  for(const dialog of leaves){
    if(!visible(dialog))continue;const rect=dialog.getBoundingClientRect();
    const onScreen=rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight;
    const buttons=[...dialog.querySelectorAll('button,a,[role=button],input[type=button]')].filter(el=>visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled=true],[class*="disabled"]')&&clean(el.textContent||el.value||el.getAttribute('aria-label')).replace(/\s+/g,'')==='我知道了');
    if(!onScreen){offscreen++;continue;}if(!buttons.length)continue;
    let closing=false;for(let node=dialog;node;node=node.parentElement){if(/(?:^|[\s-])(?:leave|exit)(?:[\s-]|$)/.test(String(node.className)))closing=true;if(node.matches('.ant-modal-wrap'))break;}
    for(const button of buttons){
      const box=button.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,(box.left+box.right)/2)),y=Math.max(0,Math.min(innerHeight-1,(box.top+box.bottom)/2));
      const inViewport=box.right>0&&box.bottom>0&&box.left<innerWidth&&box.top<innerHeight;
      const hit=inViewport?document.elementFromPoint(x,y):null,front=!!hit&&(hit===button||button.contains(hit));
      candidates.push({button,front,closing});
    }
    const css=getComputedStyle(dialog);
    reports.push({className:String(dialog.className).slice(0,160),closing,buttons:buttons.length,frontButtons:candidates.filter(item=>dialog.contains(item.button)&&item.front).length,bounds:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},...(includeDiagnostics?{opacity:css.opacity,pointerEvents:css.pointerEvents,transform:css.transform}:{} )});
  }
  if(kind==='notice'){
    for(const old of document.querySelectorAll('[data-ustudy-study-notice-action]'))old.removeAttribute('data-ustudy-study-notice-action');
    // Hit testing chooses the top notice when identical portals coexist. A
    // single covered target still goes through the normal blocker inspection.
    const target=candidates.filter(item=>item.front).at(-1)||((candidates.length===1)?candidates[0]:null);
    if(!target)return includeDiagnostics?{selector:null,count:candidates.length}:null;
    target.button.setAttribute('data-ustudy-study-notice-action','current');const selector='[data-ustudy-study-notice-action="current"]';
    return includeDiagnostics?{selector,count:1}:selector;
  }
  return {present:reports.length>0,count:reports.length,frontButtons:candidates.filter(item=>item.front).length,offscreen,...(includeDiagnostics?{dialogs:reports,viewport:{width:innerWidth,height:innerHeight,visibility:document.visibilityState}}:{} )};
}

export function readLearningStateFromDOM({notice}={}) {
  // Retained/zoomed-out modal nodes can have a client rect without painted
  // area. Keep this visibility rule aligned with notice action discovery.
  const visible=el=>{const rects=el?.getClientRects();if(!rects?.length||![...rects].some(rect=>rect.width===undefined||rect.width>0&&rect.height>0))return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
  const clean=el=>String(el.innerText||el.textContent||el.value||'').replace(/\s+/g,' ').trim();
  const nodes=[...document.querySelectorAll('button,a,[role=tab],[role=alert],div,span,p,h1,h2')].filter(visible);
  return {
    loading:[...document.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible),
    directory:!![...document.querySelectorAll('[class*="courses-unit_unitTabBody"]')].find(visible),
    networkIssue:nodes.some(el=>/^(当前网络不给力|网络连接失败|网络异常)/.test(clean(el))),
    login:[...document.querySelectorAll('input[type=password]')].some(visible)||nodes.some(el=>/^Login failed\.?$/i.test(clean(el)))&&nodes.some(el=>clean(el)==='Forbidden'),
    studyNotice:typeof notice==='boolean'?notice:[...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog,.ant-modal,.el-message-box')].some(el=>visible(el)&&/本单元学习时间/.test(clean(el))&&/是否必修/.test(clean(el))&&[...el.querySelectorAll('button,a,[role=button],input[type=button]')].some(button=>visible(button)&&!button.matches(':disabled,[disabled],[aria-disabled=true],[class*="disabled"]')&&clean(button).replace(/\s+/g,'')==='我知道了')),
    contentReady:[...document.querySelectorAll('.question-common-abs-material,.question-common-abs-question-container,.abs-direction,[data-ipublish-question-group-type],video,.discussion-course-page-sdk')].some(visible)
  };
}

export function readExerciseFeedbackFromDOM() {
  const visible=el=>!!(el&&!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const excluded='script,style,noscript,aside,[role=search],.pc-slider-content,.v3notes,.mark-edit-in,.show-mark-in,.discussion-course-page-sdk,.abs-direction,.question-common-abs-material,.layout-material-container,.passage,.transcript,[data-transcript],[data-ipublish-question-group-type],.question-common-abs-choice,.question-inputbox,.question-common-abs-scoop,fieldset,.question-item,.questionItem,[data-question-id],[contenteditable]';
  const nodes=[...document.querySelectorAll('h1,h2,h3,h4,div,p,span,[role=alert]')].filter(el=>visible(el)&&!el.closest(excluded));
  const heading=nodes.find(el=>clean(el.innerText||el.textContent)==='答题小结');
  if(!heading)return {summary:false,failed:false};
  const scope=heading.closest('.pc-main-container,main,.question-common-abs-question-container')||document.body;
  // Counts mix direct text with nested numbers/icons. Leaf elements alone drop
  // labels such as "共" and "已作答", so retain every visible text node.
  const visibleText=node=>{
    if(node.nodeType===3)return clean(node.textContent);
    if(node.nodeType!==1||!visible(node)||node.matches(excluded))return '';
    return clean([...node.childNodes].map(visibleText).filter(Boolean).join(' '));
  };
  const text=visibleText(scope).replace(/(已|未)\s*作\s*答/g,'$1作答').replace(/(主|客)\s*观\s*题/g,'$1观题').replace(/道\s*题/g,'道题');
  const failure=nodes.find(el=>scope.contains(el)&&/^(?:你没有达到闯关条件|未达到闯关条件|你未达到闯关条件|未满足闯关条件)(?:[，,。\s]|$)/.test(visibleText(el).replace(/\s+/g,'')));
  const count=pattern=>{const match=text.match(pattern);return match?Number(match[1]):null;};
  const correctRatios=[...text.matchAll(/(?:^|\s)正确\s*[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]/g)].map(match=>({correct:Number(match[1]),total:Number(match[2])}));
  const leaves=[...scope.querySelectorAll('*')].filter(el=>visible(el)&&!el.children.length&&!el.closest(excluded)).map(el=>clean(el.innerText||el.textContent));
  const allCorrect=nodes.some(el=>scope.contains(el)&&(/^(?:(?:本(?:大题|练习|项目)|整(?:道)?题))?(?:全部正确|全部答对|所有题目均正确)[！!。.]*$/.test(visibleText(el).replace(/\s+/g,''))||/^all answers (?:are )?correct[！!。.]*$/i.test(visibleText(el))));
  const scoreLine=leaves.find(line=>!line.includes('客观')&&/^(?:总得分|总分|得分|本题得分|本练习得分)\s*[:：]?\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/.test(line));
  const score=scoreLine?.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)||text.match(/(?:总得分|总分|本题得分|本练习得分)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const points=[...text.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*分(?=\s|$)/g)];
  const total=count(/共\s*(\d+)\s*道题/);let objective=count(/客观题\s*(\d+)\s*道/),subjective=count(/主观题\s*(\d+)\s*道/);
  if(total>0&&subjective===total&&objective===null)objective=0;
  if(total>0&&objective===total&&subjective===null)subjective=0;
  const ratios=label=>[...text.matchAll(new RegExp(label+'\\s*[（(]\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*[)）]','g'))].map(match=>({count:Number(match[1]),total:Number(match[2])}));
  const answered=ratios('已作答'),unanswered=ratios('未作答'),answeredCount=answered.reduce((n,ratio)=>n+ratio.count,0),answerTotal=answered.reduce((n,ratio)=>n+ratio.total,0);
  return {
    summary:true,failed:!!failure,message:failure?visibleText(failure).slice(0,300):'',
    total,objective,subjective,
    correct:count(/(?:^|\s)正确\s*[（(]\s*(\d+)\s*\/\s*\d+\s*[)）]/),
    incorrect:count(/(?:^|\s)错误\s*[（(]\s*(\d+)\s*\/\s*\d+\s*[)）]/),
    partial:count(/部分正确\s*[（(]\s*(\d+)\s*\/\s*\d+\s*[)）]/),
    unanswered:unanswered.length?unanswered.reduce((n,ratio)=>n+ratio.count,0):count(/未作答\s*(\d+)/),
    requirement:clean(text.match(/客观题正确率\s*(?:≥|>=|≧|大于等于)\s*\d+(?:\.\d+)?\s*%?/)?.[0]),
    grading:{correctRatios,allCorrect,pending:/待(?:批改|评分|评阅|审核)|尚未(?:批改|评分)|未评分|未批改|正在(?:评分|批改)/.test(text.replace(/\s+/g,'')),score:score?Number(score[1]):points.length===1?Number(points[0][1]):null,maxScore:score?Number(score[2]):null},
    ...(answered.length?{completion:{answered:answeredCount,answerTotal,allAnswered:total>0&&answerTotal===total&&answeredCount===total&&answered.every(ratio=>ratio.count===ratio.total)&&unanswered.every(ratio=>ratio.count===0)}}:{})
  };
}

export function findActionInDOM({ kind, selector = '', includeDiagnostics = false }) {
  const visible=el=>{const rects=el?.getClientRects();if(!rects?.length||![...rects].some(rect=>rect.width===undefined||rect.width>0&&rect.height>0))return false;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.matches('[hidden],[aria-hidden=true],[inert]')||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return true;};
  for(const el of document.querySelectorAll('[data-ustudy-action]'))if(el.getAttribute('data-ustudy-action')===kind)el.removeAttribute('data-ustudy-action');
  if(!['next','submit','notice','revise','finish','publish','roleplay'].includes(kind))return null;
  if(kind==='finish'){
    // The result footer is a separate action from directory resume shortcuts.
    // Recheck the visible summary here as well as in the task controller.
    const excluded='script,style,noscript,aside,.pc-slider-content,.v3notes,.abs-direction,.question-common-abs-material,.layout-material-container,.passage,.transcript,[data-transcript],[data-ipublish-question-group-type],.question-inputbox,.question-item,fieldset,[contenteditable]';
    const headings=[...document.querySelectorAll('h1,h2,h3,h4,div,p,span')].filter(el=>visible(el)&&!el.closest(excluded)&&(el.innerText||el.textContent||'').replace(/\s+/g,'').trim()==='答题小结');
    const heading=headings.find(el=>!headings.some(child=>child!==el&&el.contains(child)));
    const scope=heading?.closest('.pc-main-container,main,.question-common-abs-question-container');
    const visibleText=node=>{
      if(node.nodeType===3)return (node.textContent||'').replace(/\s+/g,' ').trim();
      if(node.nodeType!==1||!visible(node)||node.matches(excluded))return '';
      return [...node.childNodes].map(visibleText).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    };
    const text=scope?visibleText(scope).replace(/(已|未)\s*作\s*答/g,'$1作答').replace(/(主|客)\s*观\s*题/g,'$1观题').replace(/道\s*题/g,'道题'):'';
    const total=Number(text.match(/共\s*(\d+)\s*道题/)?.[1]||0),answered=[...text.matchAll(/已作答\s*[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]/g)],unanswered=[...text.matchAll(/未作答\s*[（(]?\s*(\d+)/g)];
    const allAnswered=answered.length?answered.every(match=>match[1]===match[2])&&answered.reduce((n,match)=>n+Number(match[2]),0)===total:unanswered.length>0;
    if(!scope||!total||!allAnswered||unanswered.some(match=>Number(match[1])>0)||/(?:你没有|你未|未)达到闯关条件|未满足闯关条件|待(?:批改|评分|评阅|审核)|尚未(?:批改|评分)|未评分|未批改|正在(?:评分|批改)/.test(text.replace(/\s+/g,'')))return includeDiagnostics?{selector:null,count:0}:null;
    const candidates=[...document.querySelectorAll(selector||'button,a,[role=button],input[type=button]')].filter(el=>visible(el)&&!el.closest(excluded)&&!el.matches(':disabled,[aria-disabled="true"],[class*="disabled"]')&&/^(?:继续学习)$/.test((el.innerText||el.value||el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,''))&&(scope.contains(el)||!!el.closest('footer,[class*="footer"],[class*="Footer"],.question-common-course-page')));
    if(candidates.length!==1)return includeDiagnostics?{selector:null,count:candidates.length}:null;
    candidates[0].setAttribute('data-ustudy-action',kind);const target='[data-ustudy-action="finish"]';return includeDiagnostics?{selector:target,count:1}:target;
  }
  const candidates=selector?[...document.querySelectorAll(selector)]:[...document.querySelectorAll('button,a,[role=button],input[type=submit],input[type=button],[data-ipublish-event-type="question-submit"]')];
  const patterns={next:/^(下一题|下一页|下一步|next(?: question| page)?)$/i,submit:/^(提交(?:答案|作业|练习|测试)?|交卷|submit(?: answer| quiz)?)$/i,notice:/^我知道了$/,revise:/^返回修改$/,publish:/^发布$/};
  const matches=candidates.filter(el=>{
    if(!visible(el)||el.matches(':disabled,[aria-disabled="true"],[class*="disabled"]'))return false;
    if(kind!=='notice'&&!selector&&el.closest('[role=dialog],[role=alertdialog],dialog,.ant-modal,.el-message-box'))return false;
    if(kind==='notice'){const dialog=el.closest('[role=dialog],[role=alertdialog],dialog,.ant-modal,.el-message-box');if(!dialog||!visible(dialog)||!/本单元学习时间/.test(dialog.textContent)||!/是否必修/.test(dialog.textContent))return false;}
    // Background layout may not supply innerText while textContent remains
    // available. The state reader uses this same fallback for the known notice.
    const label=(el.innerText||el.value||(kind==='notice'?el.textContent:'')||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    if(/^(继续学习|开始学习|进入学习)$/.test(label.replace(/\s+/g,'')))return false;
    return selector||patterns[kind]?.test(label)||patterns[kind]?.test(label.replace(/\s+/g,''));
  });
  if(matches.length!==1)return includeDiagnostics?{selector:null,count:matches.length}:null;
  const match=matches[0];
  match.setAttribute('data-ustudy-action',kind);
  const target=`[data-ustudy-action="${kind}"]`;
  return includeDiagnostics?{selector:target,count:1}:target;
}

export function confirmCompletionInDOM() {
  const visible=el=>!!(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const explicit=/^(提交成功|已成功提交|答题完成|练习完成|测试已完成|已交卷|作业已提交|submitted successfully|quiz completed)[！!。.]?$/i;
  return [...document.querySelectorAll('[role=alert],.quiz-result,.test-result,.exam-result,[class*="submit-success"],[class*="submitSuccess"],h1,h2,h3,p,span')].some(el=>visible(el)&&explicit.test((el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()));
}
