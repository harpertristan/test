// Exclude the provider's Nigerian jurisdiction, not an arbitrary country selector.
export function nigeriaEvidence(entry={}) {
 const urls=[entry.url,entry.developerWebsite].filter(Boolean),domain=urls.find(raw=>{try{return /\.ng$/i.test(new URL(raw).hostname);}catch{return false;}});
 if(domain||entry.developerCountry==='NG')return{reason:'excludedNigeria',text:domain??'NG',basis:'provider_domain_or_country'};
 const title=String(entry.title??''),address=String(entry.developerAddress??'');
 if(/\bNigeria(?:n)?\b|Нигери/iu.test(title+' '+address))return{reason:'excludedNigeria',text:(title+' '+address).trim().slice(0,300),basis:'provider_identity'};
 const text=[entry.developer,entry.screeningText,entry.snippet,entry.summary,...(entry.documents??entry.sourceDocuments??[]).map(d=>d.text)].filter(Boolean).join('\n');
 const sentences=text.split(/\n+|(?<=[.!?])\s+/u).filter(s=>s.length<1600&&!/(?:Afghanistan.{0,50}Albania|Albania.{0,50}Algeria)/i.test(s));
 const role=/Central Bank of Nigeria|Nigeria Deposit Insurance|\bCBN\b|(?:based|built|headquartered|incorporated|registered|located|licensed|regulated)\b.{0,65}\bNigeria\b|Nigerian (?:bank|business|account|fintech|companies)|(?:bank|company|business)\b.{0,35}\bin Nigeria\b|NGN\s+naira|Nigeria\s+NGN|(?:naira|NGN)\s+(?:bank\s+)?accounts?|Нигери[яиюей]+.{0,30}(?:банк|регулятор)/iu;
 const sentence=sentences.find(s=>role.test(s));return sentence?{reason:'excludedNigeria',text:sentence.trim().slice(0,500),basis:'provider_or_local_account_claim'}:null;
}
