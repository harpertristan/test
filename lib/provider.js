import {catalogueSearch} from './play-catalogue.js';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { validAppId } from './discovery.js';
import gplay from 'google-play-scraper';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { pause } from './run-context.js';

// The dependency's throttle can leave inThrottle=true after a rejected request.
// Gate actual HTTP starts instead; failed/aborted requests never own the gate.
export function playRequestGate(intervalMs=500) {
  let pending=Promise.resolve(),nextAt=0;
  return signal=>{
    const turn=pending.then(async()=>{
      signal?.throwIfAborted();
      const remaining=Math.max(0,nextAt-Date.now());
      if(remaining)await pause(remaining,signal);
      signal?.throwIfAborted();
      nextAt=Date.now()+intervalMs;
    });
    pending=turn.catch(()=>{});
    return turn;
  };
}

export function liveProvider({client=gplay,requestIntervalMs=500}={}) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const gate=playRequestGate(requestIntervalMs);
  const requestOptions = {
    timeout: { request: 25000 }, retry: { limit: 0 },
    hooks:{beforeRequest:[options=>gate(options.signal)]},
    ...(proxy ? { agent: { https: new HttpsProxyAgent(proxy) } } : {})
  };
  return {
    search: async (options,{signal}={}) => {
      const extra=new Set();
      const pageBodies=new Set();
      let rows;
      try{rows=await (client===gplay?catalogueSearch:client.search)({...options,throttle:undefined,requestOptions:{...requestOptions,signal,hooks:{
        beforeRequest:[...requestOptions.hooks.beforeRequest,request=>{
          if(request.method!=='POST'||!request.url.pathname.endsWith('/batchexecute'))return;
          const body=String(request.body??'');
          if(pageBodies.has(body))throw new Error('Repeated Google Play pagination token');
          pageBodies.add(body);
        }],
        afterResponse:[response=>{try{if(new URL(response.url).pathname==='/store/search')for(const id of playPageIds(response.body))extra.add(id);}catch{}return response;}]
      }}});}
      catch(error){
        if(signal?.aborted||!extra.size||[403,429,503].includes(error.status??error.response?.statusCode))throw error;
        const partial=[...extra].map(appId=>({appId,pageSection:true}));partial.partialError=true;return partial;
      }
      const existing=new Set(rows.map(a=>a.appId));
      return [...rows,...[...extra].filter(id=>!existing.has(id)).map(appId=>({appId,pageSection:true}))];
    },
    developer: (options,{signal}={}) => client.developer({...options,requestOptions:{...requestOptions,signal},throttle:undefined}),
    app: (options,{signal}={}) => client.app({ ...options, requestOptions:{...requestOptions,signal}, throttle:undefined }),
    related: async ({appId,country},{signal}={}) => {
      const url=new URL('https://play.google.com/store/apps/details');
      url.searchParams.set('id',appId);url.searchParams.set('gl',country);url.searchParams.set('hl','en');
      const html=await playHTML(url,proxy,0,signal);
      const section=recommendationSection(html,appId);
      const ids=new Set(section.appIds);
      if(section.cluster){const cluster=new URL(section.cluster,'https://play.google.com');cluster.searchParams.set('gl',country);cluster.searchParams.set('hl','en');for(const id of playPageIds(await playHTML(cluster,proxy,0,signal)))if(id!==appId)ids.add(id);}
      return [...ids].map(appId=>({appId}));
    }
  };
}

export function playHTML(url, proxy, redirects=0,signal,request=https.get) {
  if (url.hostname !== 'play.google.com' || url.protocol !== 'https:' || url.port || redirects>3) return Promise.reject(new Error('Unsupported Play redirect'));
  const agent=proxy ? new HttpsProxyAgent(proxy) : undefined;
  return new Promise((resolve,reject)=>{
    let timer,settled=false;
    const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);agent?.destroy();error?reject(error):resolve(value);};
    const req=request(url,{agent,signal,headers:{'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();let next;try{next=new URL(res.headers.location,url);}catch(error){done(error);return;}clearTimeout(timer);agent?.destroy();settled=true;playHTML(next,proxy,redirects+1,signal,request).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();done(Object.assign(new Error('Google Play response'),{status:res.statusCode}));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)req.destroy(new Error('Play response too large'));else chunks.push(chunk);});
      res.on('error',error=>done(error));
      res.on('aborted',()=>done(new Error('Google Play response interrupted')));
      res.on('end',()=>{try{let body=Buffer.concat(chunks);if(res.headers['content-encoding']==='gzip')body=gunzipSync(body,{maxOutputLength:4*1024*1024});done(null,body.toString('utf8'));}catch(error){done(error);}});
    });
    timer=setTimeout(()=>req.destroy(new Error('Google Play timeout')),25000);
    req.on('error',error=>done(error));
  });
}

// Public card anchors only: script/module/package names are not app identifiers.
export function playPageIds(html){return [...new Set([...String(html).matchAll(/href=["'](?:https:\/\/play\.google\.com)?\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g)].map(m=>m[1]).filter(validAppId))];}
export function recommendationSection(html,ownId){
 for(const [section]of String(html).matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)){
  if(!/>\s*Similar apps\s*<|aria-label=["'][^"']*Similar apps/i.test(section))continue;
  const cluster=section.match(/href=["'](\/store\/apps\/collection\/cluster\?[^"']+)["']/)?.[1]?.replaceAll('&amp;','&');
  return {appIds:playPageIds(section).filter(id=>id!==ownId),cluster:cluster??null};
 }
 return {appIds:[],cluster:null};
}
