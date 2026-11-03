/**
 * Shared domain contracts for editor checks and module boundaries.
 * @typedef {'waiting'|'running'|'paused'|'review'|'stopping'|'stopped'|'partial'|'completed'|'failed'} TaskStatus
 * @typedef {{key:string,text:string,selector?:string,originalLabel?:string}} SortItem
 * @typedef {{selector:string,kind:'text'|'editable'|'select'|'unipus-select'|'native'|'custom'|'unipus-choice'|'ipublish-choice'|'sortable',key?:string,inputMode?:'keyboard',choices?:Array<{text:string,value:string}>,items?:SortItem[],itemSelector?:string,rootSelector?:string}} Target
 * @typedef {{courseId?:string,unitId?:string,entryKey?:string}} QuestionScope
 * @typedef {{digest?:string,label:string,key?:string,mimeType?:string,dataURL?:string,width?:number,height?:number,visualDigest?:string}} MaterialImage
 * @typedef {{question:string,type:'single'|'multiple'|'text'|'matching',options:string[],targets:Target[],prompts?:string[],promptEmphasis?:string[][],context?:string,id?:string,questionType?:string,wordBank?:string[],blankOptions?:string[][],mediaKeys?:string[],images?:MaterialImage[],imageKeys?:string[],scope?:QuestionScope}} Question
 * @typedef {{kind:'exercise',version:1,title:string,scope:QuestionScope,pages:Array<{number:number,questions:Array<object>}>,verification:{method:'platform-all-correct',total:number,correct:number,unit:'questions'|'blanks',verifiedAt:number},learnedAt:number}} ExerciseBankEntry
 * @typedef {{answers:string[],indexes:number[],ordered?:boolean,source?:string,explanation?:string,matchBasis?:string}} Answer
 * @typedef {{id:string,status:TaskStatus,logs:Array<{message:string,timestamp:number,level?:string}>,metrics?:Record<string,{count:number,totalMs:number}>,oralReview?:{ready:true,entryKey:string,recordingKey:string,draftKey:string,previousSeconds:number,seconds:number},oralReplacement?:{entryKey:string,recordingKey:string,draftKey:string},oralRetryRequested?:boolean}} Task
 * @typedef {{key:string,title:string,path:string[],selector:string,required:boolean,completed:boolean,pending:boolean,status:string}} DirectoryEntry
 * @typedef {{activeUnitId:string,units:Array<{id:string,label:string,selector:string}>,entries:DirectoryEntry[],ready:boolean,loading:boolean,allLocked?:boolean,fingerprint:string}} DirectorySnapshot
 */
export {};
