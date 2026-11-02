import {SOCIAL_SOURCES} from './source-catalog.js';
export const SOURCE_GROUPS=[
 {id:'apify',name:'Соцсети через Apify API',categories:['external_social']},
 {id:'apps',name:'Приложения',categories:['apps']},
 {id:'web',name:'Сайты провайдеров',categories:['web']},
 {id:'publications',name:'Новости и публикации',categories:['news','newsletter']},
 {id:'social',name:'Соцсети и реклама',categories:['social','advertising']},
 {id:'registers',name:'Лицензии и реестры',categories:['register']},
 {id:'partners',name:'Банки и инфраструктурные партнёры',categories:['partner']},
 {id:'communities',name:'Каталоги, отзывы и сообщества',categories:['community','directory']},
 {id:'watch',name:'Наблюдение и RSS',categories:['watch']},
];
export const sourceGroup=channel=>SOURCE_GROUPS.find(g=>g.categories.includes(channel.category))?.id??'web';
export function sourceConnection(channel){
 if(channel.kind==='apify')return{mode:'apify_task',label:'Apify API · платный сбор публичных данных · только ручной запуск',manualURL:'https://console.apify.com/actors/tasks',helpURL:'https://github.com/harpertristan/test/blob/main/SOCIAL_CONNECTIONS.md'};
 if(channel.kind==='play')return{mode:'public_catalogue',label:'Публичный каталог Google Play'};
 if(channel.kind==='watch')return{mode:'public_pages',label:'Открытые страницы и RSS из ваших настроек'};
 const social=['linkedin','facebook','meta-ads','linkedin-ads'].includes(channel.source);
 const manualURL=channel.source==='meta-ads'?'https://www.facebook.com/ads/library/':channel.source==='linkedin-ads'?'https://www.linkedin.com/ad-library/home':channel.source==='facebook'?'https://www.facebook.com/':channel.source==='linkedin'?'https://www.linkedin.com/':null;
 return{mode:'brave_index',label:social?'Публичный индекс Brave · доступ к аккаунту не подключён':'Поиск через Brave',...(social?{limited:true,manualURL,helpURL:'https://github.com/harpertristan/test/blob/main/SOCIAL_CONNECTIONS.md'}:{})};
}
export const SEARCH_CHANNELS=[
 {id:'apify:facebook',name:'Facebook · Apify API',kind:'apify',connector:'facebook',category:'external_social',settingsURL:'/crm#social-api-settings'},
 {id:'apify:linkedin',name:'LinkedIn · Apify API',kind:'apify',connector:'linkedin',category:'external_social',settingsURL:'/crm#social-api-settings'},
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
