import {abortable} from './run-context.js';
// This bounds transient memory, not requests or the number of saved findings.
export function cachedPageProvider(provider,{ttlMs=300000,maxBytes=64*1024*1024,clock=()=>Date.now()}={}){
 const cache=new Map(),pending=new Map();let bytes=0;
 const remove=url=>{const old=cache.get(url);if(old)bytes-=old.bytes;cache.delete(url);};
 const prune=()=>{for(const [url,item]of cache)if(clock()-item.at>=ttlMs)remove(url);while(bytes>maxBytes&&cache.size)remove(cache.keys().next().value);};
 return {...provider,clearCache:()=>{cache.clear();bytes=0;},page:async(url,options={})=>{
  options.signal?.throwIfAborted();
  const old=cache.get(url);
  if(old&&clock()-old.at<ttlMs){cache.delete(url);cache.set(url,old);return old.value;}
  if(old)remove(url);
  if(pending.has(url)){const shared=pending.get(url);return abortable(()=>shared,options.signal);}
  const work=abortable(()=>provider.page(url,options),options.signal).then(value=>{
   const size=Buffer.byteLength(String(value.body??''))+Buffer.byteLength(String(value.text??''));
   if(!options.signal?.aborted&&size<=maxBytes){remove(url);cache.set(url,{value,at:clock(),bytes:size});bytes+=size;prune();}
   return value;
  }).finally(()=>{if(pending.get(url)===work)pending.delete(url);});
  pending.set(url,work);return work;
 }};
}
