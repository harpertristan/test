import {SOCIAL_SOURCES} from './source-catalog.js';
export const SEARCH_CHANNELS=[
 {id:'play',name:'Google Play',kind:'play',category:'apps',settingsURL:'/'},
 {id:'web',name:'Сайты провайдеров',kind:'web',category:'web',settingsURL:'/web'},
 {id:'watch',name:'Наблюдение · страницы и RSS',kind:'watch',category:'watch',settingsURL:'/watch'},
 ...SOCIAL_SOURCES.filter(s=>!s.retired&&s.id!=='custom'&&s.id!=='web').flatMap(s=>(s.domains.length>1?s.domains:[null]).map(domain=>({id:'social:'+s.id+(domain?':'+domain:''),name:domain??s.name,kind:'social',category:s.category,source:s.id,focusDomain:domain,settingsURL:'/social'})))
];
export function channelMatches(row,id){
 if(!id)return true;const c=SEARCH_CHANNELS.find(s=>s.id===id);if(!c)return false;
 if(row.sourceKeys?.includes(id))return true;
 if(c.kind!=='social')return Boolean(row.sources?.includes(c.kind)||row.targets?.some(t=>t.section===c.kind));
 if(!row.sources?.includes(c.source))return false;
 if(!c.focusDomain)return true;
 return [...row.targets??[],...row.documents??[]].some(t=>{try{const h=new URL(t.url).hostname;return h===c.focusDomain||h.endsWith('.'+c.focusDomain);}catch{return false;}});
}
