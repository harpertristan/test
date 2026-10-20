export const AI_REVIEW_VERSION=1;
export function reviewConfig(input={}){
 const sources=input.sources??['play','web','social','watch'];if(!Array.isArray(sources)||!sources.length||sources.some(s=>!['play','web','social','watch'].includes(s)))throw new Error('Выберите источники нейронного поиска.');
 const collectSources=input.collectSources??false;
 const enabled=input.enabled??false,time=input.time??'09:45',perRun=input.perRun??10,monthlyLimit=input.monthlyLimit??300,includeKnown=input.includeKnown??false;
 if(typeof collectSources!=='boolean'||typeof enabled!=='boolean'||typeof includeKnown!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание проверки ИИ.');
 if(!Number.isInteger(perRun)||perRun<1||perRun>50||!Number.isInteger(monthlyLimit)||monthlyLimit<1||monthlyLimit>3000)throw new Error('За запуск: 1–50 проверок; за месяц: 1–3000.');
 return {collectSources,enabled,time,perRun,monthlyLimit,includeKnown,sources:[...new Set(sources)]};
}
export function initialAIState(){return {config:reviewConfig(),results:[],jobs:[],inbox:[],newIds:[],gatherJobs:[],usage:{},lastSuccessAt:null,lastRunAt:null};}
