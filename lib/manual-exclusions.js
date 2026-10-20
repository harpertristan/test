// Shared by browser and server. Manual exclusions take precedence over archive views.
export function canonicalFindingURL(raw) {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    url.hash='';url.hostname=url.hostname.replace(/^www\./,'');
    for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();url.pathname=url.pathname.replace(/\/$/,'')||'/';return url.href;
  }catch{return null;}
}
export function manuallyExcluded(entry,rules=[]) {
  const urls=[entry.url,entry.developerWebsite].map(canonicalFindingURL).filter(Boolean);
  return rules.some(rule=>rule.kind==='app'?entry.appId===rule.value:rule.kind==='domain'?urls.some(raw=>{const host=new URL(raw).hostname;return host===rule.value||host.endsWith(`.${rule.value}`);}):rule.kind==='url'&&urls.includes(rule.value));
}
export function visibleJob(job,rules=[]) {
  if(!job)return job;
  return {...job,...Object.fromEntries(['results','existingResults','reviewCandidates'].filter(key=>Array.isArray(job[key])).map(key=>[key,job[key].filter(e=>!manuallyExcluded(e,rules))]))};
}
