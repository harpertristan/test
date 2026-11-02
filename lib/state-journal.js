import {readFile,mkdir,open,rename,unlink,stat,truncate} from 'node:fs/promises';
import {dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import jsonPatch from 'fast-json-patch';
import lockfile from 'proper-lockfile';

const META='__playScoutStorage',FORMAT='play-scout-delta-v1';
const projectionIds=new WeakMap();
export const projectionIdentity=state=>projectionIds.get(state)??state;
function projectionChanged(patches){return patches.some(p=>{
 const parts=p.path.split('/').slice(1);
 if(parts[0]==='braveUsage')return false;
 if(parts[0]==='ai'&&['usage','localUsage','geminiUsage','reviewCache'].includes(parts[1]))return false;
 const jobField=parts[0]==='ai'&&parts[1]==='jobs'?parts[3]:parts[0]==='jobs'?parts[2]:['web','social','watch','apple'].includes(parts[0])&&parts[1]==='jobs'?parts[3]:null;
 if(jobField&&['done','searchDone','searchTotal','detailDone','detailTotal','attempts','braveRequests','request','stage','workers','current','errors','status','finishedAt','scanned','skipped','successfulSearches'].includes(jobField))return false;
 return true;
});}
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp=s=>s?`${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`:null;
const maybeStat=async file=>{try{return await stat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const persistenceError=cause=>Object.assign(new Error('Не удалось сохранить историю. Проверьте место, права на папку data и отсутствие второго экземпляра с этой базой.',{cause}),{code:'PERSISTENCE_ERROR'});
const journalError=cause=>Object.assign(new Error('Журнал изменений истории повреждён или не соответствует state.json. Файлы не сброшены; сохраните всю папку data и восстановите согласованную резервную копию.',{cause}),{code:'STATE_JOURNAL_INVALID'});
async function syncDirectory(file){
 if(process.platform==='win32')return;
 let handle;try{handle=await open(dirname(file),'r');await handle.sync();}catch(e){if(!['EINVAL','ENOTSUP'].includes(e.code))throw e;}finally{await handle?.close();}
}
export const journalPath=file=>file+'.journal';
const unsigned=record=>JSON.stringify({format:record.format,id:record.id,seq:record.seq,prev:record.prev,patches:record.patches});
function canonicalJSON(value){
 const seen=new WeakSet(),active=new WeakSet();
 function visit(item){
  if(item===undefined)return null;
  if(typeof item==='number')return Number.isFinite(item)?item:null;
  if(item===null||['string','boolean'].includes(typeof item))return item;
  if(typeof item!=='object')throw Error('History values must be JSON data');
  if(item instanceof Date)return item.toJSON();
  if(active.has(item))throw Error('Circular history data');
  if(seen.has(item))return item;
  active.add(item);
  if(Array.isArray(item)){
   for(let i=0;i<item.length;i++)item[i]=visit(item[i]);
   for(const key of Object.keys(item))if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=item.length)delete item[key];
  }else for(const key of Object.keys(item)){if(item[key]===undefined)delete item[key];else item[key]=visit(item[key]);}
  active.delete(item);seen.add(item);return item;
 }
 return visit(value);
}

// Read-only recovery is also used by doctor/profile export. Retain every complete
// acknowledged record; an unfinished final line was not a committed transaction.
export async function loadStoredState(file){
 for(let attempt=0;attempt<4;attempt++){
  const before=await maybeStat(file);let bytes;
  try{bytes=await readFile(file,'utf8');}catch(e){
   if(e.code==='ENOENT'&&(await maybeStat(journalPath(file)))?.size)throw journalError(e);
   throw e;
  }
  const state=JSON.parse(bytes),hasMeta=Object.hasOwn(state??{},META),meta=state?.[META]??null;
  if(hasMeta&&(!meta||meta.format!==FORMAT||typeof meta.id!=='string'||!Number.isSafeInteger(meta.seq)||meta.seq<0||!/^[a-f0-9]{64}$/.test(meta.head??'')))throw journalError();
  if(meta)delete state[META];
  let journal=Buffer.alloc(0);try{journal=await readFile(journalPath(file));}catch(e){if(e.code!=='ENOENT')throw journalError(e);}
  const after=await maybeStat(file);if(stamp(before)!==stamp(after))continue;
  if(journal.length&&!meta)throw journalError();
  let seq=meta?.seq??0,head=meta?.head??null,validBytes=0,previous=null;
  for(let start=0;start<journal.length;){
   const end=journal.indexOf(10,start);if(end<0)break;
   const line=journal.subarray(start,end).toString('utf8');let record;
   try{
    record=JSON.parse(line);
    if(record.format!==FORMAT||record.id!==meta.id||!Number.isSafeInteger(record.seq)||record.seq<1||!Array.isArray(record.patches)||record.hash!==hash(unsigned(record)))throw Error('Invalid record');
    if(previous&&(record.seq!==previous.seq+1||record.prev!==previous.hash))throw Error('Invalid journal chain');
    for(const patch of record.patches)if(!['add','remove','replace'].includes(patch.op)||typeof patch.path!=='string'||!patch.path.startsWith('/'))throw Error('Invalid patch');
    if(record.seq>meta.seq){
     if(record.seq!==seq+1||record.prev!==head)throw Error('Missing transaction');
     jsonPatch.applyPatch(state,record.patches,true,true,true);seq=record.seq;head=record.hash;
    }else if(record.seq===meta.seq&&record.hash!==meta.head)throw Error('Wrong checkpoint');
   }catch(e){throw journalError(e);}
   previous=record;validBytes=end+1;start=end+1;
  }
  return{state,meta,seq,head,fileStamp:stamp(after),snapshotBytes:Buffer.byteLength(bytes),rawBytes:journal.length,validBytes};
 }
 throw journalError(new Error('History changed while reading'));
}
export async function readStoredState(file){return(await loadStoredState(file)).state;}

// Restore unchanged object identities after diffing the plain mutable draft.
// Callbacks keep their existing structuredClone-compatible data contract.
function shareUnchanged(base,draft,patches){
 const root={children:new Map()};
 for(const patch of patches){let node=root;for(const part of patch.path.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'))){if(!node.children.has(part))node.children.set(part,{children:new Map()});node=node.children.get(part);}node.whole=true;}
 function visit(a,b,node){
  if(node.whole||!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return b;
  const result=Array.isArray(b)?b.slice():{...b};
  for(const key of Object.keys(result)){const child=node.children.get(key);if(child)result[key]=visit(a[key],b[key],child);else if(Object.hasOwn(a,key))result[key]=a[key];}
  return result;
 }
 return visit(base,draft,root);
}

export class StateStore{
 constructor(file,state,info=null){
  this.file=file;this.state=state;this.pending=Promise.resolve();this.info=info?{...info,state:undefined}:null;
  if(file)projectionIds.set(state,{});
  this.seq=info?.seq??0;this.head=info?.head??null;this.lastCheckpointAt=Date.now();
  this.persistenceStats={bytesWritten:0,checkpoints:0,transactions:0,journalBytes:info?.rawBytes??0,lastCheckpointError:null};
 }
 async _exclusive(work){
  await mkdir(dirname(this.file),{recursive:true});
  const release=await lockfile.lock(this.file,{realpath:false,stale:10000,update:2000,retries:{retries:12,factor:1,minTimeout:1000,maxTimeout:1000}});
  try{return await work();}finally{await release();}
 }
 async _atomicSnapshot(state,meta){
  const temp=this.file+'.'+randomUUID()+'.tmp';let handle;
  try{
   await mkdir(dirname(this.file),{recursive:true});
   handle=await open(temp,'wx',0o600);
   const body=JSON.stringify({...state,[META]:meta})+'\n';
   await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
   await rename(temp,this.file);
   await syncDirectory(this.file);
   this.persistenceStats.bytesWritten+=Buffer.byteLength(body);
   return{fileStamp:stamp(await stat(this.file)),snapshotBytes:Buffer.byteLength(body)};
  }finally{await handle?.close().catch(()=>{});await unlink(temp).catch(()=>{});}
 }
 async _checkExternalChange(){
  if(!this.info){if(await maybeStat(this.file)||(await maybeStat(journalPath(this.file)))?.size)throw Error('History was created by another writer');return;}
  const journal=await maybeStat(journalPath(this.file));
  if(stamp(await maybeStat(this.file))!==this.info.fileStamp||(journal?.size??0)!==this.info.rawBytes)throw Error('History was modified by another writer');
 }
 async _checkpoint(state=this.state){
  await this._checkExternalChange();
  const id=this.info?.meta?.id??randomUUID(),head=this.head??hash(id);
  const meta={format:FORMAT,id,seq:this.seq,head};
  const next=await this._atomicSnapshot(state,meta);
  this.head=head;this.info={...this.info,...next,meta,seq:this.seq,head,rawBytes:this.info?.rawBytes??0,validBytes:this.info?.validBytes??0};
  this.persistenceStats.checkpoints++;this.lastCheckpointAt=Date.now();
  // If a crash occurs before truncation, the new snapshot's sequence/hash lets
  // recovery skip the old, already-checkpointed prefix without applying it twice.
  if(this.info.rawBytes){const h=await open(journalPath(this.file),'r+');try{await h.truncate(0);await h.sync();}finally{await h.close();}}
  this.info.rawBytes=0;this.info.validBytes=0;this.persistenceStats.journalBytes=0;this.persistenceStats.lastCheckpointError=null;
 }
 async _append(patches){
  await this._checkExternalChange();
  if(this.info.rawBytes!==this.info.validBytes){await truncate(journalPath(this.file),this.info.validBytes);this.info.rawBytes=this.info.validBytes;}
  const record={format:FORMAT,id:this.info.meta.id,seq:this.seq+1,prev:this.head,patches};record.hash=hash(unsigned(record));
  const body=JSON.stringify(record)+'\n',size=Buffer.byteLength(body),offset=this.info.rawBytes;
  let h;try{
   const fresh=!(await maybeStat(journalPath(this.file)));
   h=await open(journalPath(this.file),'a',0o600);await h.writeFile(body);await h.sync();if(fresh)await syncDirectory(this.file);
  }catch(e){if(h)try{await h.truncate(offset);await h.sync();}catch{}throw e;}
  finally{await h?.close().catch(()=>{});}
  this.seq=record.seq;this.head=record.hash;this.info.seq=this.seq;this.info.head=this.head;this.info.rawBytes+=size;this.info.validBytes=this.info.rawBytes;
  this.persistenceStats.bytesWritten+=size;this.persistenceStats.transactions++;this.persistenceStats.journalBytes=this.info.rawBytes;
 }
 async update(change,{backup=null}={}){
  const operation=this.pending.then(async()=>{
   const draft=structuredClone(this.state);let backupFile=null;
   if(backup&&this.file){
    if(!/^[a-z0-9-]+$/.test(backup))throw Error('Некорректное имя резервной копии.');
    const path=this.file+'.'+backup+'-'+randomUUID()+'.json';
    try{await mkdir(dirname(this.file),{recursive:true});const h=await open(path,'wx',0o600);try{await h.writeFile(JSON.stringify(this.state)+'\n');await h.sync();}finally{await h.close();}backupFile=basename(path);}catch(cause){throw persistenceError(cause);}
   }
   const result=change(draft,{backupFile});
   if(!this.file){this.state=draft;return result;}
   canonicalJSON(draft);
   const patches=jsonPatch.compare(this.state,draft);
   for(const patch of patches)if(patch.path.split('/').some(part=>['__proto__','constructor','prototype'].includes(part.replaceAll('~1','/').replaceAll('~0','~'))))throw persistenceError(new Error('Unsupported prototype modification'));
   try{
    if(this.info?.meta&&!patches.length)return result;
    await this._exclusive(async()=>{
     if(!this.info?.meta){await this._checkpoint(draft);this.state=draft;projectionIds.set(draft,{});return;}
     const next=shareUnchanged(this.state,draft,patches);
     await this._append(patches);projectionIds.set(next,projectionChanged(patches)?{}:projectionIdentity(this.state));this.state=next;
     // Compaction follows a durable commit and stays inside the writer lock.
     const target=Math.max(4*1024*1024,(this.info.snapshotBytes??0)/4);
     if(this.info.rawBytes>=target&&Date.now()-this.lastCheckpointAt>=30000){try{await this._checkpoint();}catch(e){this.persistenceStats.lastCheckpointError='Не удалось обновить полный снимок; подтверждённые изменения остаются в журнале.';}}
    });
   }catch(cause){throw persistenceError(cause);}
   return result;
  });
  this.pending=operation.catch(()=>{});return operation;
 }
 async flush(){
  const operation=this.pending.then(async()=>{if(this.file&&(this.seq!==this.info?.meta?.seq||this.info?.rawBytes||!this.info?.meta)){try{await this._exclusive(()=>this._checkpoint());}catch(cause){throw persistenceError(cause);}}});
  this.pending=operation.catch(()=>{});return operation;
 }
}
