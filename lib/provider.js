import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { validAppId } from './discovery.js';
import gplay from 'google-play-scraper';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function liveProvider() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const requestOptions = {
    timeout: { request: 25000 }, retry: { limit: 0 },
    ...(proxy ? { agent: { https: new HttpsProxyAgent(proxy) } } : {})
  };
  return {
    search: async options => {
      const extra=new Set();
      const rows=await gplay.search({...options,requestOptions:{...requestOptions,hooks:{afterResponse:[response=>{try{if(new URL(response.url).pathname==='/store/search')for(const id of playPageIds(response.body))extra.add(id);}catch{}return response;}]}},throttle:2});
      const existing=new Set(rows.map(a=>a.appId));
      return [...rows,...[...extra].filter(id=>!existing.has(id)).map(appId=>({appId,pageSection:true}))];
    },
    developer: options => gplay.developer({...options,requestOptions,throttle:2}),
    app: options => gplay.app({ ...options, requestOptions, throttle: 2 }),
    related: async ({appId,country}) => {
      const url=new URL('https://play.google.com/store/apps/details');
      url.searchParams.set('id',appId);url.searchParams.set('gl',country);url.searchParams.set('hl','en');
      const html=await playHTML(url,proxy);
      const section=recommendationSection(html,appId);
      const ids=new Set(section.appIds);
      if(section.cluster){const cluster=new URL(section.cluster,'https://play.google.com');cluster.searchParams.set('gl',country);cluster.searchParams.set('hl','en');for(const id of playPageIds(await playHTML(cluster,proxy)))if(id!==appId)ids.add(id);}
      return [...ids].slice(0,250).map(appId=>({appId}));
    }
  };
}

export function playHTML(url, proxy, redirects=0) {
  if (url.hostname !== 'play.google.com' || url.protocol !== 'https:' || url.port || redirects>3) return Promise.reject(new Error('Unsupported Play redirect'));
  const agent=proxy ? new HttpsProxyAgent(proxy) : undefined;
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{agent,headers:{'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();clearTimeout(timer);agent?.destroy();playHTML(new URL(res.headers.location,url),proxy,redirects+1).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();clearTimeout(timer);agent?.destroy();reject(Object.assign(new Error('Google Play response'),{status:res.statusCode}));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)req.destroy(new Error('Play response too large'));else chunks.push(chunk);});
      res.on('error',error=>{clearTimeout(timer);agent?.destroy();reject(error);});
      res.on('end',()=>{clearTimeout(timer);agent?.destroy();try{let body=Buffer.concat(chunks);if(res.headers['content-encoding']==='gzip')body=gunzipSync(body,{maxOutputLength:4*1024*1024});resolve(body.toString('utf8'));}catch(error){reject(error);}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('Google Play timeout')),25000);
    req.on('error',error=>{clearTimeout(timer);agent?.destroy();reject(error);});
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
