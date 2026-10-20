import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {publicURL} from './qualification.js';
const MAX_BYTES=2*1024*1024;
export function publicAddress(address) {
  const version=isIP(address);
  if(version===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));}
  return version===6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
export async function publicTarget(raw,resolve=lookup){
  const url=publicURL(raw);if(!url)throw new Error('Only public HTTPS URLs are supported');
  const addresses=await resolve(url.hostname,{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Private or reserved destination');
  return {url,addresses};
}
export function htmlText(html){
  return String(html).replace(/<(script|style|noscript|svg|nav)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<\/(?:p|div|section|article|li|h[1-6])>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d{1,7});/g,(_,v)=>{const n=Number(v);return n<=0x10ffff?String.fromCodePoint(n):' ';}).split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').slice(0,100000);
}
export function pageProvider({resolve=lookup,request=https.get,proxy=process.env.HTTPS_PROXY||process.env.https_proxy}={}){
  return {page:(raw,{signal}={})=>getPage(raw,0,signal)};
  async function getPage(raw,redirects,signal){
    signal?.throwIfAborted();
    if(redirects>3)throw new Error('Too many redirects');
    const {url,addresses}=await publicTarget(raw,resolve);
    signal?.throwIfAborted();
    const agent=proxy?new HttpsProxyAgent(proxy):undefined;
    return new Promise((resolvePage,reject)=>{
      let timer,settled=false;
      const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);agent?.destroy();error?reject(error):resolvePage(value);};
      const req=request(url,{agent,signal,lookup:(_host,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family),headers:{'User-Agent':'PlayScout/2.1 public-product-monitor','Accept':'text/html, application/rss+xml, application/atom+xml, application/xml, text/plain','Accept-Encoding':'identity'}},res=>{
        if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();clearTimeout(timer);agent?.destroy();settled=true;getPage(new URL(res.headers.location,url).href,redirects+1,signal).then(resolvePage,reject);return;}
        if(res.statusCode!==200){res.resume();done(Object.assign(new Error('Public page access failed'),{status:res.statusCode}));return;}
        const contentType=res.headers['content-type']??'';
        if(!/text\/(?:html|plain|xml)|application\/(?:rss\+xml|atom\+xml|xml|xhtml\+xml)/i.test(contentType)){res.resume();done(new Error('Unsupported page type'));return;}
        const chunks=[];let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES)req.destroy(new Error('Page too large'));else chunks.push(chunk);});
        res.on('error',error=>done(error));
        res.on('end',()=>{try{let buffer=Buffer.concat(chunks);if(res.headers['content-encoding']==='gzip')buffer=gunzipSync(buffer,{maxOutputLength:MAX_BYTES});const body=buffer.toString('utf8');const xml=/xml/i.test(contentType)||/^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed)\b/i.test(body);const text=htmlText(body);
          if(!xml&&(text.length<80||/just a moment|verify (?:you are|that you are) human|access denied|enable javascript and cookies|checking your browser|consent required/i.test(text)))throw new Error('Page blocked or no readable public content');
          done(null,{url:url.href,title:htmlText(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]??url.hostname).slice(0,200),text,body,contentType,xml});
        }catch(error){done(error);}});
      });
      timer=setTimeout(()=>req.destroy(new Error('Public page timeout')),15000);
      req.on('error',error=>done(error));
    });
  }
}
export function feedItems(xml){
  const field=(body,tag)=>{const value=body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))?.[1]??'';return htmlText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));};
  return [...String(xml).matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0,100).map(([,body])=>{
    const link=body.match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i)?.[1]??body.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1]??field(body,'link');
    const url=publicURL(link.replace(/&amp;/g,'&'));
    if(url)for(const key of [...url.searchParams.keys()])if(/^(?:utm_|fbclid|gclid)/i.test(key))url.searchParams.delete(key);
    return {url:url?.href,title:field(body,'title'),description:field(body,'description')||field(body,'summary')||field(body,'content'),date:field(body,'pubDate')||field(body,'published')||field(body,'updated')};
  }).filter(item=>item.url&&item.title);
}
