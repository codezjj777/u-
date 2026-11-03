import assert from 'node:assert/strict';
import path from 'node:path';
import {Automation} from '../automation.mjs';
import {Store} from '../store.mjs';
import {askModel} from '../answer-provider.mjs';
import * as Core from '../shared/core.mjs';
import {pictureExerciseHTML,pictureQuestions,pictureAnswers,pictureSources,pictureBytes} from './fixtures/picture-exercise.mjs';

export async function pictureBrowserCases(t,context,root){
  async function setup({store,grade=false,onRequest,verifyBlocks}={}){
    const page=await context.newPage();await page.goto('https://ucontent.unipus.cn/offline-recognition/picture-exercise');await page.setContent(pictureExerciseHTML({grade}));await page.locator('figure img').last().evaluate(el=>el.decode());
    const task={id:'picture-'+Math.random(),status:'running',logs:[],answered:0,pages:0,manualItems:[]},localStore=store||{apiKey:'fixture-key',data:{tasks:[task],bank:[]},changed(){},addLog(task,message,level='info'){task.logs.push({message,level});}},engine=new Automation(localStore),requests=[];
    engine.pages.track(page,'lesson',{taskId:task.id});
    engine.askModel=(question,settings,key,signal,options)=>askModel(question,settings,key||'fixture-key',signal,{...options,retryDelayMs:0,fetchImpl:async(url,options)=>{
      const request=JSON.parse(options.body),blocks=request.messages[1].content;assert.equal(blocks.length,4);const payload=JSON.parse(blocks[0].text),index=pictureQuestions.findIndex(text=>payload.question.includes(text));assert.ok(index>=0);assert.equal(payload.images.length,3);if(verifyBlocks)await verifyBlocks(blocks.slice(1),page);else assert.deepEqual(blocks.slice(1).map(block=>block.image_url.url),pictureSources);assert.equal(payload.blankCount,1);requests.push(index);await onRequest?.(index,page);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answers:[pictureAnswers[index]]})}}]}));
    }});
    return {page,engine,task,store:localStore,requests,settings:{aiEnabled:true,autoSubmit:false,endpoint:'https://vision.example.test/v1/chat/completions',model:'vision-fixture'}};
  }
  async function opaqueMaterial(f){
    const source='https://images.example.test/opaque-material.png';let seed=3;
    await f.page.route(source,route=>route.fulfill({contentType:'image/png',headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:pictureBytes(seed)}));
    f.engine.imageReader.download=async()=>{throw new Error('fixture original unavailable');};
    await f.page.locator('figure img').last().evaluate(async(el,src)=>{el.src=src;await el.decode();},source);
    return {source,replace:async()=>{
      seed=1;const response=f.page.waitForResponse(source);await f.page.locator('figure img').last().evaluate(el=>el.crossOrigin='anonymous');await response;
      await f.page.locator('figure img').last().evaluate(el=>el.decode());
      assert.equal(await f.page.locator('figure img').last().getAttribute('src'),source);
    }};
  }
  async function completeRenderedBlocks(blocks,page){
    assert.deepEqual(blocks.slice(0,2).map(block=>block.image_url.url),pictureSources.slice(0,2));
    const [actual,expected]=await page.evaluate(async sources=>Promise.all(sources.map(async src=>{
      const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const hash=await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data);
      return {width:canvas.width,height:canvas.height,pixels:Array.from(new Uint8Array(hash)).join(',')};
    })),[blocks[2].image_url.url,pictureSources[2]]);
    assert.deepEqual(actual,expected,'the fallback contains every natural-size pixel without the lesson crop or stretch');
    assert.equal(await page.locator('[data-ustudy-image-capture]').count(),0);
  }

  await t.test('look-at-photos sends A, B and the title as real image blocks for all three text answers',async()=>{
    const f=await setup();try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>log.message.includes('已读取 3 张完整图片')));
    }finally{await f.page.close();}
  });

  await t.test('changing an image while AI answers invalidates the page before any field is written',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===0)await page.locator('figure img').first().evaluate(async(el,src)=>{el.src=src;await el.decode();},pictureSources[2]);}});try{
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/题目或阅读材料发生变化/);assert.deepEqual(f.requests,[0]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('unrelated header images appearing during material capture do not stop or retarget picture answers',async()=>{
    const f=await setup();try{
      const capture=f.engine.imageReader.capture.bind(f.engine.imageReader);let added=false;
      f.engine.imageReader.capture=async(...args)=>{const image=await capture(...args);if(!added){added=true;await f.page.locator('header').evaluate((el,src)=>{const image=document.createElement('img');image.src=src;image.alt='Late page cover';el.prepend(image);},pictureSources[2]);}return image;};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(added,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('visual changes at an unchanged image URL are caught by the final image verification',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===2)await page.locator('figure img').first().evaluate(el=>el.style.filter='invert(1)');}});try{
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/图片内容或显示方式发生变化/);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);assert.equal(f.engine.pages.hasDraft(),true);
    }finally{await f.page.close();}
  });

  await t.test('images moving after the last AI response do not require a stable element screenshot before filling',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===2)await page.evaluate(()=>{let frame=0;window.pictureMotion=setInterval(()=>{document.querySelector('figure img').style.transform=`translateX(${++frame%2?7:0}px)`;},16);});}});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('neutral material wrappers and full-image fit changes do not invalidate complete picture answers',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===2)await page.locator('figure img').first().evaluate(el=>{
      const material=el.closest('.layout-material-container'),wrapper=document.createElement('div');material.replaceWith(wrapper);wrapper.append(material);
      Object.assign(el.style,{width:'230px',height:'170px',objectFit:'contain',objectPosition:'75% 100%'});
    });}});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('a temporary material fade can settle before verification without repeating AI requests',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===2)await page.locator('.layout-material-container').evaluate(el=>{
      el.animate([{opacity:.25},{opacity:1}],{duration:1600,fill:'none'});
    });}});try{
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('a persistent ancestor fade still blocks filling and submitting the exercise',async()=>{
    const f=await setup({onRequest:async(index,page)=>{if(index===2)await page.locator('.layout-material-container').evaluate(el=>el.style.opacity='.5');}});try{
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/图片内容或显示方式发生变化/);
      assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('offscreen native lazy images are fully loaded without scrolling or replacing their declared source',async()=>{
    const f=await setup();try{
      const source='https://ucontent.unipus.cn/offline-recognition/lazy-title.png';let loads=0;
      await f.page.route(source,route=>{loads++;return route.fulfill({contentType:'image/png',body:pictureBytes(3)});});
      f.engine.imageReader.download=async url=>{assert.equal(url,source);return pictureBytes(3);};
      await f.page.locator('figure').last().evaluate((figure,src)=>{
        figure.style.marginTop='10000px';figure.innerHTML=`<figcaption>Title:</figcaption><img loading="lazy" src="${src}">`;
      },source);
      assert.equal(await f.page.locator('figure img').last().evaluate(el=>el.complete&&el.naturalWidth>0),false);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.equal(loads,1);assert.deepEqual(f.requests,[0,1,2]);assert.equal(await f.page.locator('figure img').last().getAttribute('src'),source);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('offscreen observer-based material loads through its public viewport observer before AI is asked',async()=>{
    const f=await setup();try{
      const source='https://ucontent.unipus.cn/offline-recognition/observer-title.png';let loads=0;
      await f.page.route(source,route=>{loads++;return route.fulfill({contentType:'image/png',body:pictureBytes(3)});});
      f.engine.imageReader.download=async url=>{assert.equal(url,source);return pictureBytes(3);};
      await f.page.locator('figure').last().evaluate((figure,src)=>{
        figure.style.marginTop='10000px';figure.innerHTML=`<figcaption>Title:</figcaption><img data-src="${src}" width="96" height="64">`;
        const img=figure.querySelector('img'),observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){img.src=img.dataset.src;observer.disconnect();}});observer.observe(img);
      },source);
      assert.equal(await f.page.locator('figure img').last().getAttribute('src'),null);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.equal(loads,1);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('material capture waits for a decoding-complete image to finish its initial fade',async()=>{
    const f=await setup();try{
      await f.page.locator('.layout-material-container').evaluate(el=>el.animate([{opacity:.1},{opacity:1}],{duration:1000}));
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);
    }finally{await f.page.close();}
  });

  await t.test('unending appearance animations yield a recoverable read error within the bounded wait',async()=>{
    const f=await setup();try{
      await f.page.locator('figure img').first().evaluate(el=>el.animate([{opacity:.1},{opacity:1}],{duration:500,iterations:Infinity}));
      const snapshot=await f.engine.readQuestions(f.page,f.settings),record=snapshot.imageRecords[0];
      await assert.rejects(f.engine.imageReader.capture(record),error=>error.code==='IMAGE_READ_UNAVAILABLE'&&/稳定/.test(error.message));
      assert.deepEqual(f.requests,[]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('opaque image fallback keeps the entire source stable across stretched lessons and nested scrolling',async()=>{
    const f=await setup({verifyBlocks:completeRenderedBlocks,onRequest:async(index,page)=>{if(index===2)await page.locator('figure img').last().evaluate(el=>{
      el.style.width='450px';el.style.height='30px';const material=el.closest('.layout-material-container');Object.assign(material.style,{height:'130px',overflow:'auto'});material.scrollTop=100;
    });}});try{
      const {source}=await opaqueMaterial(f);
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);
      assert.equal(result.review,true);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);
      assert.equal(await f.page.locator('figure img').last().getAttribute('src'),source);assert.equal(await f.page.locator('[data-ustudy-image-capture]').count(),0);assert.equal(await f.page.evaluate(()=>window.submitted),false);
      assert.ok(Object.values(f.engine.imageMaterials.get(f.page).images).some(image=>image.verification.mode==='rendered'&&image.width===96&&image.height===64));
    }finally{await f.page.close();}
  });

  await t.test('replacing opaque image pixels at the same URL still blocks every answer and removes temporary renders',async()=>{
    let replace;const f=await setup({verifyBlocks:completeRenderedBlocks,onRequest:async index=>{if(index===2)await replace();}});try{
      ({replace}=await opaqueMaterial(f));
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),error=>error.code==='IMAGE_CHANGED'&&error.imageChange.reason==='content'&&error.imageChange.mode==='rendered');
      assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.locator('[data-ustudy-image-capture]').count(),0);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('opaque material taller than the viewport is rendered in full and leaves the lesson viewport unchanged',async()=>{
    const f=await setup();try{
      const source='https://images.example.test/tall-opaque-material.png';
      await f.page.route(source,route=>route.fulfill({contentType:'image/png',body:pictureBytes(3,{width:600,height:2200})}));
      f.engine.imageReader.download=async()=>{throw new Error('fixture original unavailable');};
      await f.page.locator('figure img').last().evaluate(async(el,src)=>{el.src=src;await el.decode();},source);
      const viewport=f.page.viewportSize(),snapshot=await f.engine.readQuestions(f.page,f.settings),record=snapshot.imageRecords.at(-1),asset=await f.engine.imageReader.capture(record);
      assert.equal(asset.verification.mode,'rendered');assert.equal(asset.width,436);assert.equal(asset.height,1600);
      await f.page.locator('figure img').last().evaluate(el=>{el.style.width='370px';el.style.height='20px';});await f.engine.imageReader.verify(record,asset);
      assert.deepEqual(f.page.viewportSize(),viewport);assert.equal(await f.page.locator('[data-ustudy-image-capture]').count(),0);assert.deepEqual(f.requests,[]);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('temporary opaque-image rendering is removed after screenshot failure or cancellation',async()=>{
    const f=await setup();try{
      await opaqueMaterial(f);const snapshot=await f.engine.readQuestions(f.page,f.settings),record=snapshot.imageRecords.at(-1),reader=f.engine.imageReader;
      for(const cancel of [false,true]){
        const controller=new AbortController(),frame={locator:selector=>{
          const target=record.frame.locator(selector);if(!selector.endsWith(' img'))return target;
          return {screenshot:async()=>{assert.equal(await f.page.locator('[data-ustudy-image-capture]').count(),1);if(cancel){controller.abort(new Error('fixture-render-stop'));throw controller.signal.reason;}throw new Error('fixture screenshot timeout');}};
        }};
        await assert.rejects(reader.capture({...record,frame},{signal:controller.signal}),error=>cancel?error.message==='fixture-render-stop':error.code==='IMAGE_READ_UNAVAILABLE');
        assert.equal(await f.page.locator('[data-ustudy-image-capture]').count(),0);
      }
      assert.deepEqual(f.requests,[]);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('temporary pre-fill image verification failure waits on the same lesson and resumes without asking AI again',async()=>{
    const f=await setup();try{
      const verify=f.engine.imageReader.verify.bind(f.engine.imageReader),gate=f.engine.gate.bind(f.engine);let failed=false,resumes=0;
      f.engine.imageReader.verify=async(...args)=>{if(!failed){failed=true;throw Object.assign(new Error('图片暂时不可读。'),{code:'IMAGE_READ_UNAVAILABLE'});}return verify(...args);};
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){resumes++;assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);await f.engine.pages.releaseTask(task.id);assert.equal(f.page.isClosed(),false);f.engine.controlTask(task.id,'resume');}return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(resumes,1);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);assert.ok(f.task.logs.some(log=>log.message.includes('仅重试图片读取和复核')));
    }finally{await f.page.close();}
  });

  await t.test('stopping while image verification is unavailable keeps the empty lesson and ends the running task',async()=>{
    const f=await setup();try{
      const controller=new AbortController(),gate=f.engine.gate.bind(f.engine);
      f.engine.imageReader.verify=async()=>{throw Object.assign(new Error('图片暂时不可读。'),{code:'IMAGE_READ_UNAVAILABLE'});};
      f.engine.gate=async(task,signal)=>{if(task.status==='review')f.engine.controlTask(task.id,'stop');return gate(task,signal);};
      await f.engine.runtime.start(f.task,controller,()=>f.engine.answerEntryAttempt(f.task,f.page,f.settings,controller.signal),()=>f.engine.pages.releaseTask(f.task.id));
      assert.equal(f.task.status,'stopped');assert.equal(f.page.isClosed(),false);assert.equal(f.engine.busy(),false);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });

  await t.test('post-fill image verification must recover before a fixture can submit and never fills the answers twice',async()=>{
    const f=await setup({grade:true});try{
      f.settings.autoSubmit=true;const verify=f.engine.imageReader.verify.bind(f.engine.imageReader),gate=f.engine.gate.bind(f.engine);let failed=false,resumes=0;
      f.engine.imageReader.verify=async(...args)=>{if(!failed&&await f.page.locator('textarea').first().inputValue()){failed=true;throw Object.assign(new Error('图片暂时不可读。'),{code:'IMAGE_READ_UNAVAILABLE'});}return verify(...args);};
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){resumes++;assert.equal(task.answered,3);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),pictureAnswers);assert.equal(await f.page.evaluate(()=>window.submitted),false);f.engine.controlTask(task.id,'resume');}return gate(task,signal);};
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.feedback.failed,false);assert.equal(resumes,1);assert.equal(f.task.answered,3);assert.deepEqual(f.requests,[0,1,2]);assert.equal(await f.page.evaluate(()=>window.submitted),true);assert.equal(f.store.data.bank.length,0);
    }finally{await f.page.close();}
  });

  await t.test('resuming image verification after a question change stops without filling or submitting stale answers',async()=>{
    const f=await setup();try{
      const gate=f.engine.gate.bind(f.engine);
      f.engine.imageReader.verify=async()=>{throw Object.assign(new Error('图片暂时不可读。'),{code:'IMAGE_READ_UNAVAILABLE'});};
      f.engine.gate=async(task,signal)=>{if(task.status==='review'){await f.page.locator('figure img').first().evaluate(async(el,src)=>{el.src=src;await el.decode();},pictureSources[2]);f.engine.controlTask(task.id,'resume');}return gate(task,signal);};
      await assert.rejects(f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal),/等待期间题目或图片发生变化/);await f.engine.pages.releaseTask(f.task.id);assert.equal(f.page.isClosed(),false);assert.deepEqual(f.requests,[0,1,2]);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('unreadable picture material blocks AI, filling and automatic no-question marks',async()=>{
    const f=await setup();try{
      f.engine.imageReader.capture=async()=>{throw new Error('本测试图片未加载成功。');};f.engine.askModel=async()=>assert.fail('must not guess');
      const result=await f.engine.answerEntryAttempt(f.task,f.page,f.settings,new AbortController().signal);assert.equal(result.review,true);assert.equal(result.manual,undefined);assert.match(result.message,/图片材料准备未完成/);assert.deepEqual(await f.page.locator('textarea').evaluateAll(items=>items.map(el=>el.value)),['','','']);assert.equal(await f.page.evaluate(()=>window.submitted),false);
    }finally{await f.page.close();}
  });

  await t.test('all-correct picture tasks save one exercise with three deduplicated image assets and reuse all three answers after reload',async()=>{
    const directory=path.join(root,'learn-pictures'),store=await new Store(directory,{env:{}}).load(),scope={courseId:'picture-book',unitId:'picture-unit',entryKey:JSON.stringify(['picture-unit',['Active reading'],'Before you read'])};
    function configure(f,{reuse=false}={}){
      Object.assign(f.task,scope,{courseTitle:'Complete English Book',unitLabel:'Unit 1'});f.settings.autoSubmit=true;f.engine.pages.attach(context);f.engine.courseDirectory=async()=>({page:{}});let completed=false;
      const entry={key:scope.entryKey,title:'Before you read',path:['Active reading'],required:true,pending:true,completed:false};
      f.engine.refreshTaskDirectory=async()=>{if(!f.page.isClosed())completed=await f.page.evaluate(()=>window.submitted);f.task.requiredTotal=1;f.task.requiredCompleted=completed?1:0;return {ready:true,activeUnitId:scope.unitId,entries:[{...entry,completed,pending:!completed}]};};f.engine.openRequiredEntry=async()=>{f.engine.pages.track(f.page,'lesson');return f.page;};
      const gate=f.engine.gate.bind(f.engine);f.engine.gate=async(task,signal)=>{if(task.status==='review')throw new Error('Unexpected picture review: '+task.logs.slice(-3).map(log=>log.message).join(' | '));return gate(task,signal);};if(reuse)f.engine.askModel=async()=>assert.fail('whole picture exercise should match without AI');
    }
    try{
      const f=await setup({store,grade:true});configure(f);await f.engine.runTask(f.task,{},f.settings,new AbortController().signal);assert.equal(f.task.status,'completed');assert.equal(store.data.bank.length,1,JSON.stringify(f.task.logs));
      const row=store.data.bank[0];assert.equal(row.kind,'exercise');assert.equal(row.imageAssets.length,3);assert.equal(row.pages.length,1);assert.equal(row.pages[0].questions.length,3);assert.ok(row.pages[0].questions.every(q=>q.images.length===3));assert.deepEqual(row.pages[0].questions.map(q=>q.answer[0]),pictureAnswers);assert.doesNotMatch(JSON.stringify(row),/selector|https:|visualDigest|data-ustudy/);await store.flush();
      const restored=await new Store(directory,{env:{}}).load();try{assert.deepEqual(Core.validateBank(JSON.parse(JSON.stringify(restored.data.bank))),restored.data.bank);const repeat=await setup({store:restored,grade:true});configure(repeat,{reuse:true});await repeat.engine.runTask(repeat.task,{},repeat.settings,new AbortController().signal);assert.equal(repeat.task.status,'completed');assert.equal(restored.data.bank.length,1);assert.ok(repeat.task.logs.some(log=>log.message.includes('整题题库')));}finally{await restored.flush();}
    }finally{await store.flush();}
  });
}
