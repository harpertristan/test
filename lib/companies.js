import {publicURL,eligibleFinding,excluded} from './qualification.js';
const REFERENCES=[{domain:'lurrapay.com',name:'LurraPay',pattern:/\blurrapay\b/i},{domain:'rampy.money',name:'Rampy',pattern:/\brampy(?:\.money)?\b/i},{domain:'stable.com',name:'Stable.com',pattern:/\bstable\.com\b/i},{domain:'photonpay.com',name:'PhotonPay',pattern:/\bphotonpay\b/i},{domain:'kleos.money',name:'Kleos',pattern:/\bkleos(?: capital|\.money)\b/i}];
export function companyAssociation(entry){
  const own=publicURL(entry.developerWebsite??(entry.signalType==='page_change'?entry.url:''));
  if(own)return {domain:own.hostname.replace(/^www\./,''),name:entry.developer??own.hostname.replace(/^www\./,''),kind:entry.developerWebsite?'developer_site':'watched_site'};
  const text=`${entry.title??''} ${entry.snippet??''} ${entry.screeningText??''}`;
  const ref=REFERENCES.find(ref=>ref.pattern.test(text));
  return ref?{domain:ref.domain,name:ref.name,kind:'name_hint'}:null;
}
export function companyGroups(state){
  const groups=new Map();
  for(const [type,entries]of [['play',state.findings??[]],['play_review',state.reviewCandidates??[]],['publication',state.social?.findings??[]],['change',state.watch?.findings??[]]])for(const entry of entries){
    const filters=type==='publication'?state.social?.schedule.filters:type==='change'?state.watch?.schedule.filters:state.schedule.filters;
    if(excluded({text:`${entry.title??''} ${entry.snippet??''} ${entry.screeningText??''}`,appId:entry.appId,url:entry.url,domains:entry.developerWebsite?[entry.developerWebsite]:[]},filters))continue;
    if(type!=='play_review'&&!eligibleFinding(entry,filters))continue;
    const association=companyAssociation(entry);if(!association)continue;
    if(!groups.has(association.domain))groups.set(association.domain,{domain:association.domain,name:association.name,items:[]});
    const group=groups.get(association.domain),key=entry.id??entry.appId;
    if(group.items.some(item=>item.key===key))continue;
    group.items.push({key,type,title:entry.title,url:entry.url,association:association.kind,foundAt:entry.firstFoundAt??entry.checkedAt,signalType:entry.signalType??'app',euIban:entry.discovery?.euIban??'unknown'});
  }
  return [...groups.values()].map(g=>({...g,items:g.items.sort((a,b)=>(b.foundAt??'').localeCompare(a.foundAt??'')),unconfirmedAssociations:g.items.filter(i=>i.association==='name_hint').length})).sort((a,b)=>(b.items[0]?.foundAt??'').localeCompare(a.items[0]?.foundAt??''));
}
