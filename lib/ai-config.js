export const AI_REVIEW_VERSION=2;
export function reviewConfig(input={}){
 const sources=input.sources??['play','web','social','watch','apple'];if(!Array.isArray(sources)||!sources.length||sources.some(s=>!['play','web','social','watch','apple'].includes(s)))throw new Error('Выберите источники нейронного поиска.');
 const collectSources=input.collectSources??false;
 const enabled=input.enabled??false,time=input.time??'09:45',perRun=0,monthlyLimit=0,includeKnown=input.includeKnown??false;
 if(typeof collectSources!=='boolean'||typeof enabled!=='boolean'||typeof includeKnown!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание проверки ИИ.');

 const translateRu=input.translateRu??true,evidenceBudget=0;if(typeof translateRu!=='boolean'||!Number.isInteger(evidenceBudget)||evidenceBudget<0)throw new Error('Перевод: да/нет; проверки Brave: 0–2000.');
 return {translateRu,evidenceBudget,collectSources,enabled,time,perRun,monthlyLimit,includeKnown,sources:[...new Set(sources)]};
}
export function initialAIState(){return {config:reviewConfig(),results:[],jobs:[],inbox:[],newIds:[],shortlist:[],gatherJobs:[],usage:{},lastSuccessAt:null,lastRunAt:null};}
