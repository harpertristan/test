// Bounded public web research for Scout. This module has no SMTP, upload or intranet access.
import dns from "node:dns/promises";
import https from "node:https";
import {publicIPv4,safeWebUrl,safePublicText} from "./scout_web_policy.mjs";
const MAX_BYTES=500_000;
const MAX_REDIRECTS=3;

function decodeEntities(value){
  return String(value).replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([0-9a-f]+));/gi,(full,dec,hex)=>{
    if(dec||hex){const number=parseInt(dec||hex,hex?16:10);
      return number>=32&&number<=0x10ffff?String.fromCodePoint(number):" ";}
    return ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '})[full.toLowerCase()]??" ";
  });
}
function stripTags(html){
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi," ")
    .replace(/<\/(?:p|div|section|li|h[1-6]|tr)>/gi,"\n")
    .replace(/<[^>]*>/g," ")
    .replace(/[ \t]{2,}/g," ").replace(/\n[ \t]*/g,"\n").trim()).slice(0,10000);
}
function resolveResultLink(link,base){
  let raw=decodeEntities(link);
  try{
    const u=new URL(raw,base);
    if((u.hostname==="www.google.com"||u.hostname==="google.com")&&u.pathname==="/url"){
      raw=u.searchParams.get("q")||u.searchParams.get("url")||"";
    } else if(u.hostname.endsWith(".duckduckgo.com")&&u.pathname.startsWith("/l/")){
      raw=u.searchParams.get("uddg")||"";
    }
    return safeWebUrl(new URL(raw,u).href).href;
  }catch{return null;}
}
export function parsePage(html,base,maxLinks=65){
  const title=decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"").slice(0,250);
  const description=decodeEntities(html.match(
    /<meta\s+[^>]*(?:name=["']description["']|property=["']og:description["'])[^>]*content=["']([^"']{1,700})/i
  )?.[1]||"").slice(0,500);
  const seen=new Set(),links=[];
  // Search provider RSS feeds expose direct destination URLs in <item><link>.
  // Treat them as unverified candidates, never as regulator-confirmed findings.
  const feedItems=/<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let feed;
  while((feed=feedItems.exec(html))&&links.length<maxLinks){
    const body=feed[1];
    const link=body.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    if(link){
      const direct=resolveResultLink(link.trim(),base);
      if(direct&&!seen.has(direct)){seen.add(direct);links.push(direct);}
    }
  }
  const href=/\b(?:href|data-url)\s*=\s*(?:"([^"]{1,1800})"|'([^']{1,1800})')/gi;
  let hit;
  while((hit=href.exec(html))&&links.length<maxLinks){
    const link=resolveResultLink(hit[1]||hit[2],base);
    if(link&&!seen.has(link)){seen.add(link);links.push(link);}
  }
  return {title,description,text:stripTags(html),links};
}

async function resolvePublic(hostname){
  let records;
  try{records=await dns.lookup(hostname,{all:true,family:4});}
  catch{throw Error("DNS_RESOLUTION_FAILED");}
  if(!records.length||records.length>16||records.some(r=>!publicIPv4(r.address)))
    throw Error("NON_PUBLIC_ADDRESS");
  return records[0].address;
}

// Node 20+ passes {all:true} to custom lookups when autoSelectFamily is enabled.
// In that mode it requires an array of address/family records; a single string
// produces ERR_INVALID_IP_ADDRESS ("Invalid IP address: undefined") before TCP.
export function pinnedLookup(address){
  return (_hostname, options, callback)=>{
    if(typeof options==="function"){callback=options;options={};}
    if(options?.all===true)return callback(null,[{address,family:4}]);
    return callback(null,address,4);
  };
}

function httpsGet(url,address){
  return new Promise((resolve,reject)=>{
    if(!publicIPv4(address))return reject(Error("NON_PUBLIC_ADDRESS"));
    const req=https.get(url,{
      timeout:10_000,
      lookup:pinnedLookup(address),
      headers:{'User-Agent':'Hermes-Scout-PublicResearch/1.0',
        accept:'text/html,text/plain,application/xhtml+xml',
        'accept-encoding':'identity'},
      maxHeaderSize:16_384
    },res=>{
      if([301,302,303,307,308].includes(res.statusCode)){
        const location=res.headers.location;
        res.resume();
        return resolve({redirect:location||null,status:res.statusCode});
      }
      if(res.statusCode<200||res.statusCode>=300){
        res.resume();return reject(Error("REMOTE_HTTP_"+res.statusCode));
      }
      const type=String(res.headers['content-type']||"").toLowerCase();
      if(!/(text\/html|text\/plain|application\/xhtml\+xml|application\/rss\+xml|application\/xml|text\/xml)/.test(type)){
        res.resume();return reject(Error("REMOTE_TYPE_REFUSED"));
      }
      let size=0;const parts=[];
      res.on('data',part=>{
        size+=part.length;
        if(size>MAX_BYTES){res.destroy(Error("REMOTE_TOO_LARGE"));return;}
        parts.push(part);
      });
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,
        html:Buffer.concat(parts).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(Error("REMOTE_TIMEOUT")));
    req.on('error',reject);
  });
}

export async function publicOpen(value,network={resolve:resolvePublic,get:httpsGet},maxLinks=65){
  let url=safeWebUrl(value);
  const seen=new Set();
  for(let i=0;i<=MAX_REDIRECTS;i++){
    if(seen.has(url.href))throw Error("REDIRECT_LOOP");
    seen.add(url.href);
    const address=await network.resolve(url.hostname);
    if(!publicIPv4(address))throw Error("NON_PUBLIC_ADDRESS");
    const result=await network.get(url,address);
    if(result.redirect){
      if(i===MAX_REDIRECTS)throw Error("REDIRECT_LIMIT");
      url=safeWebUrl(new URL(result.redirect,url).href);
      continue;
    }
    if(!result.html||typeof result.html!=="string")
      throw Error("REMOTE_CONTENT_INVALID");
    return {sourceUrl:url.href,checkedAt:new Date().toISOString(),status:result.status,
      ...parsePage(result.html,url.href,maxLinks)};
  }
  throw Error("REDIRECT_LIMIT");
}

// Search-engine pages contain navigation, forums and unrelated links.
// Results remain unverified leads. Prefer destinations mentioning the requested brand.
export function rankResearchResults(links, query) {
  const q=String(query).toLowerCase();
  const stop=new Set(["company","companies","limited","legal","entity","official","website","register",
    "registry","regulator","regulated","services","business","account","financial","license",
    "licence","google","play","information","ltd","the","and","for","with","from","about",
    "юридическое","лицо","регулятор","регулирующие","органы","великобритании","сайт","компания"]);
  const signal=(q.match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(t=>!stop.has(t)).slice(0,5);
  const excluded=/(^|\.)(reddit\.com|github\.com|stackoverflow\.com|youtube\.com|facebook\.com|instagram\.com|linkedin\.com|pinterest\.com|quora\.com)$/;
  const entries=[],seen=new Set();
  for(const link of links||[]) {
    try {
      const u=safeWebUrl(link), host=u.hostname.toLowerCase();
      if(seen.has(u.href))continue;
      seen.add(u.href);
      if(excluded.test(host) && !/(reddit|github|stackoverflow|youtube|facebook|instagram|linkedin|pinterest|quora)/.test(q))continue;
      if(/(^|\.)(bing\.com|google\.com|duckduckgo\.com|microsoft\.com)$/.test(host))continue;
      const location=(host+" "+decodeURIComponent(u.pathname).toLowerCase()).slice(0,500);
      const score=signal.filter(t=>location.includes(t)).length*4+
        (/(^|\.)(gov\.uk|fca\.org\.uk|europa\.eu)$/.test(host)?2:0);
      entries.push({url:u.href,score});
    }catch{}
  }
  // Reject zero-evidence destinations. Otherwise an unrelated forum/link farm
  // can become the first result merely because the search engine linked it.
  const relevant=entries.filter(x=>x.score>=4);
  relevant.sort((a,b)=>b.score-a.score);
  return relevant.slice(0,20).map(x=>x.url);
}

export async function publicSearch(query,network){
  const text=safePublicText(query,180);
  const providers=[
    "https://www.bing.com/search?format=rss&q="+encodeURIComponent(text),
    "https://www.google.com/search?q="+encodeURIComponent(text)+"&num=10",
    "https://www.bing.com/search?q="+encodeURIComponent(text)+"&count=10",
    "https://html.duckduckgo.com/html/?q="+encodeURIComponent(text)
  ];
  const errors=[];
  // Search engines can return unrelated navigation URLs. Try every provider
  // until at least one positively matching candidate is found.
  for(const address of providers){
    try{
      const result=await publicOpen(address,network,220);
      const results=rankResearchResults(result.links,text);
      if(results.length)return {query:text,provider:new URL(address).hostname,
        results,checkedAt:result.checkedAt,excerpt:result.text.slice(0,2000)};
      const lower=result.text.toLowerCase();
      errors.push(
        /unfortunately, bots use duckduckgo too|confirm this search was made by a human|unusual traffic|captcha|please verify you are human|try using google search/.test(lower)
          ? "SEARCH_ENGINE_CHALLENGE" : "NO_RESULTS"
      );
    }catch(e){errors.push(/^([A-Z_]+|REMOTE_HTTP_\d{3})$/.test(e.message)?e.message:"SEARCH_UNAVAILABLE");}
  }
  return {query:text,results:[],code:"SEARCH_RESULTS_UNAVAILABLE",
    providerErrors:errors,checkedAt:new Date().toISOString()};
}
