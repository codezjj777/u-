import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import * as UStudy from './shared/core.mjs';
import {validateSettings} from './settings.mjs';
import {emptyState,validateState,validateManualEntryMarks,SCHEMA_VERSION} from './state-schema.mjs';
import {verifyBankImages} from './image-materials.mjs';
import {APP_INFO} from './runtime-check.mjs';
import {protectForCurrentUser,unprotectForCurrentUser,writePrivateFile} from './local-secrets.mjs';
export {defaultSettings} from './settings.mjs';

const bankName=/^bank-[a-f0-9]{64}\.json$/;
const storageFailure=()=>Object.assign(new Error('数据未能保存到磁盘，请检查目录权限后重试。'),{status:507});
const credentialFormat='windows-dpapi-v1';
const credentialPurpose='AI credentials';
const credentialFailure=()=>Object.assign(new Error(process.platform==='win32'
  ?'无法加密保存 API Key。请检查当前 Windows 用户的密钥保护和 .runtime 目录权限后重试。'
  :'本机加密保存仅支持 Windows。请通过 USTUDY_API_KEY 环境变量提供 Key。'),{status:507,code:'CREDENTIAL_STORAGE'});
const removeLegacyTemporary=directory=>unlink(path.join(directory,'credentials.tmp')).catch(error=>{if(error.code!=='ENOENT')throw error;});

export class Store extends EventEmitter {
  constructor(directory,{env=process.env}={}){
    super();this.directory=directory;this.data=emptyState();this.connected=false;this.windowOpen=false;this.syncing=false;this.operation=null;
    this.apiKey=(env.USTUDY_API_KEY||'').trim();this.envEndpoint=(env.USTUDY_API_ENDPOINT||'').trim();this.envModel=(env.USTUDY_API_MODEL||'').trim();
    this.keyEndpoint='';this.keyVersion='legacy';this.writeQueue=Promise.resolve();this.saveTimer=null;this.storageError=null;this.credentialError=null;this.revision=0;this.instanceId=randomUUID();this.bankCache=null;this.bankFileCache=null;
  }
  async load(){
    await mkdir(this.directory,{recursive:true});let raw;
    try{raw=await readFile(path.join(this.directory,'state.json'),'utf8');}catch(error){if(error.code!=='ENOENT')throw new Error('无法读取本地数据文件，请检查目录权限。');}
    if(raw!==undefined){
      try{
        const saved=JSON.parse(raw);let bank=saved.bank;
        if(saved.bankFile!==undefined){
          if(!bankName.test(saved.bankFile))throw new Error('题库文件引用无效。');
          const bankText=await readFile(path.join(this.directory,saved.bankFile),'utf8');
          if('bank-'+createHash('sha256').update(bankText).digest('hex')+'.json'!==saved.bankFile)throw new Error('题库内容校验失败。');
          bank=JSON.parse(bankText);
        }
        const candidate=validateState(saved,bank);verifyBankImages(candidate.bank);this.data=candidate;
        if(saved.bankFile)this.bankFileCache={bank:this.data.bank,name:saved.bankFile};
      }catch{
        this.data=emptyState();const backup=`state.invalid-${Date.now()}-${randomUUID().slice(0,8)}.json`;
        try{await rename(path.join(this.directory,'state.json'),path.join(this.directory,backup));this.data.activity.push({message:`原始数据格式异常，已保留备份 ${backup}，当前使用默认设置。`,icon:'info',timestamp:Date.now()});}
        catch{this.storageError='原始数据格式异常且备份失败，请检查目录权限；当前使用默认设置。';}
      }
    }
    this.configureEnvironment();await this.loadLocalKey();return this;
  }
  configureEnvironment(){
    if(this.apiKey.length>8192)throw new Error('USTUDY_API_KEY 长度异常。');
    if(this.envEndpoint&&!UStudy.validateEndpoint(this.envEndpoint))throw new Error('USTUDY_API_ENDPOINT 必须是有效的 HTTPS Chat Completions 地址。');
    if(this.envModel.length>200)throw new Error('USTUDY_API_MODEL 长度异常。');
    if(this.envEndpoint)this.data.settings.endpoint=UStudy.validateEndpoint(this.envEndpoint);
    if(this.envModel)this.data.settings.model=this.envModel;
    this.keyEndpoint=this.data.settings.endpoint;this.keySource=this.apiKey?'environment':'none';
  }
  async loadLocalKey(){
    try{await removeLegacyTemporary(this.directory);}
    catch{this.credentialError='无法清理旧版临时密钥文件，请检查 .runtime 目录权限。';return;}
    let file;
    try{file=JSON.parse(await readFile(path.join(this.directory,'credentials.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')this.credentialError='无法读取本地密钥文件，请检查目录权限或在设置中重新保存 Key。';return;}
    const legacy=file?.format===undefined&&typeof file?.apiKey==='string';
    if(this.keySource==='environment'&&!legacy)return;
    if(legacy){
      try{await this.writeCredentials(file);}
      catch(error){this.credentialError=`旧版 API Key 未能迁移。${error.message}`;return;}
    }else{
      try{
        if(file?.format!==credentialFormat)throw new Error('未知密钥格式');
        file=JSON.parse(await unprotectForCurrentUser(file.protected,credentialPurpose));
      }catch{this.credentialError='当前账号无法解密本地 API Key，请在答题设置中重新输入并保存。';return;}
    }
    if(this.keySource==='environment')return;
    const version=this.data.credentialVersion||'legacy';
    const credentials=[file,...(Array.isArray(file?.previous)?file.previous:[])].find(item=>item&&(item.version||'legacy')===version);
    if(!credentials){this.credentialError='本地密钥与配置版本不一致，请在设置中重新保存 Key。';return;}
    const endpoint=UStudy.validateEndpoint(credentials.endpoint);
    if(typeof credentials.apiKey!=='string'||!credentials.apiKey.trim()||credentials.apiKey.length>8192||!endpoint){this.credentialError='本地密钥格式无效，请在设置中重新保存 Key。';return;}
    this.apiKey=credentials.apiKey.trim();this.keyEndpoint=endpoint;this.keySource='local';this.keyVersion=version;
  }
  async writeCredentials(credentials){
    try{
      const protectedData=await protectForCurrentUser(JSON.stringify(credentials),credentialPurpose);
      await removeLegacyTemporary(this.directory);
      await writePrivateFile(path.join(this.directory,'credentials.json'),JSON.stringify({format:credentialFormat,protected:protectedData}));
    }catch{throw credentialFailure();}
  }
  getBankIndex(){
    if(this.bankCache?.bank!==this.data.bank)this.bankCache={bank:this.data.bank,index:UStudy.buildBankIndex(this.data.bank)};
    return this.bankCache.index;
  }
  async learnVerifiedExercise(input){
    const exercise=UStudy.validateExercise(input),identity=UStudy.exerciseIdentity(exercise);
    verifyBankImages([exercise]);
    return this.enqueue(async()=>{
      const existing=this.data.bank.findIndex(row=>row.kind==='exercise'&&UStudy.exerciseIdentity(row)===identity);
      const summary={pages:exercise.pages.length,questions:exercise.pages.reduce((sum,page)=>sum+page.questions.length,0)};
      const answers=UStudy.exerciseAnswersIdentity;
      if(existing>=0&&answers(this.data.bank[existing])===answers(exercise))return {added:false,unchanged:true,...summary};
      const bank=[...this.data.bank];if(existing<0)bank.push(exercise);else bank[existing]=exercise;
      if(bank.length>20000)throw new Error('题库已达到 20,000 条记录上限，请先导出整理。');
      const candidate={...this.data,bank};await this.persist(candidate);this.data=candidate;this.changed({persist:false});
      return {added:existing<0,...summary};
    });
  }
  findManualEntry(scope,settings={}){
    const selector=(settings.questionSelector||'').trim();
    return this.data.manualEntryMarks.find(mark=>mark.courseId===scope.courseId&&mark.unitId===scope.unitId&&mark.entryKey===scope.entryKey&&mark.questionSelector===selector)||null;
  }
  async rememberManualEntry(scope,settings={},reason='no-fillable-questions',handler){
    const entry=validateManualEntryMarks([{courseId:scope.courseId,unitId:scope.unitId,entryKey:scope.entryKey,label:scope.currentEntry||'',questionSelector:(settings.questionSelector||'').trim(),reason,markedAt:Date.now(),...(handler?{handler}:{})}])[0];
    return this.enqueue(async()=>{
      const previous=this.findManualEntry(scope,settings);if(previous&&(!handler||previous.handler===handler))return previous;
      const candidate={...this.data,manualEntryMarks:[...this.data.manualEntryMarks.filter(mark=>mark!==previous),entry].slice(-10000)};
      await this.persist(candidate);this.data=candidate;this.changed({persist:false});return entry;
    });
  }
  async forgetManualEntry(scope,settings={}){
    return this.enqueue(async()=>{
      const previous=this.findManualEntry(scope,settings);if(!previous)return false;
      const candidate={...this.data,manualEntryMarks:this.data.manualEntryMarks.filter(mark=>mark!==previous)};
      await this.persist(candidate);this.data=candidate;this.changed({persist:false});return true;
    });
  }
  async clearManualEntries(){
    return this.enqueue(async()=>{
      const cleared=this.data.manualEntryMarks.length,candidate={...this.data,manualEntryMarks:[]};
      await this.persist(candidate);this.data=candidate;this.changed({persist:false});return {cleared,manualEntryCount:0};
    });
  }
  publicState(){return {appInfo:APP_INFO,revision:this.revision,instanceId:this.instanceId,courses:this.data.courses,tasks:this.data.tasks,activity:this.data.activity,settings:this.data.settings,bankCount:this.data.bank.length,exerciseBankCount:this.data.bank.filter(row=>row.kind==='exercise').length,manualEntryCount:this.data.manualEntryMarks.length,lastSynced:this.data.lastSynced,syncCoverage:this.data.syncCoverage,connected:this.connected,windowOpen:this.windowOpen,syncing:this.syncing,operation:this.operation,keyPresent:!!this.apiKey,keySource:this.keySource||'none',storageError:this.storageError,credentialError:this.credentialError};}
  publish(){this.revision++;this.emit('state',this.publicState());}
  changed({persist=true}={}){
    this.publish();if(persist){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{this.saveTimer=null;void this.save().catch(()=>{});},250);this.saveTimer.unref();}
  }
  enqueue(work){
    const pending=this.writeQueue.then(work).catch(error=>{
      const failure=error?.code==='CREDENTIAL_STORAGE'?error:storageFailure();
      this.storageError=failure.message;this.publish();this.emit('notice',{message:this.storageError});throw failure;
    });
    this.writeQueue=pending.catch(()=>{});return pending;
  }
  async persist(data,{credentials}={}){
    let name=this.bankFileCache?.bank===data.bank?this.bankFileCache.name:null;
    if(!name){
      verifyBankImages(data.bank);
      const content=JSON.stringify(data.bank);name=`bank-${createHash('sha256').update(content).digest('hex')}.json`;
      try{await writeFile(path.join(this.directory,name),content,{encoding:'utf8',flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    const {bank,...state}=data;
    await writeFile(path.join(this.directory,'state.tmp'),JSON.stringify({...state,schemaVersion:SCHEMA_VERSION,bankFile:name},null,2),'utf8');
    if(credentials)await this.writeCredentials(credentials);
    // state.json is the commit point. Staged credentials retain the previous
    // version, so a failure or crash before this rename keeps the old pair readable.
    await rename(path.join(this.directory,'state.tmp'),path.join(this.directory,'state.json'));
    this.bankFileCache={bank:data.bank,name};
    if(this.storageError){this.storageError=null;this.publish();}
  }
  save(){return this.enqueue(()=>this.persist(this.data));}
  async saveConfiguration({settings,bank=this.data.bank,apiKey}={}){
    const validatedSettings=validateSettings(settings),validatedBank=bank===this.data.bank?bank:UStudy.validateBank(bank);
    verifyBankImages(validatedBank);
    if(apiKey!==undefined&&(this.keySource==='environment'||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||!UStudy.validateEndpoint(validatedSettings.endpoint)))throw new Error('本地密钥配置无效。');
    clearTimeout(this.saveTimer);this.saveTimer=null;
    return this.enqueue(async()=>{
      const version=apiKey?randomUUID():this.data.credentialVersion;
      const candidate={...this.data,settings:validatedSettings,bank:validatedBank,...(version?{credentialVersion:version}:{})};
      const credentials=apiKey?{apiKey:apiKey.trim(),endpoint:validatedSettings.endpoint,version,previous:this.keySource==='local'?[{apiKey:this.apiKey,endpoint:this.keyEndpoint,version:this.keyVersion}]:[]}:undefined;
      await this.persist(candidate,{credentials});this.data=candidate;
      if(credentials){this.apiKey=credentials.apiKey;this.keyEndpoint=credentials.endpoint;this.keySource='local';this.keyVersion=version;this.credentialError=null;}
      this.changed({persist:false});return this.publicState();
    });
  }
  saveLocalKey(apiKey,endpoint){return this.saveConfiguration({settings:{...this.data.settings,endpoint},apiKey});}
  addActivity(message,icon='check'){this.data.activity.unshift({message,icon,timestamp:Date.now()});this.data.activity=this.data.activity.slice(0,40);this.changed();}
  notice(message){this.emit('notice',{message});}
  addLog(task,message,level='info'){task.logs.push({message,level,timestamp:Date.now()});task.logs=task.logs.slice(-150);task.updatedAt=Date.now();this.changed();}
  async flush(){clearTimeout(this.saveTimer);this.saveTimer=null;await this.save();}
}
