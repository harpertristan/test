export const AI_REVIEW_VERSION=2;
export function reviewConfig(input={}){
 const sources=input.sources??['play','web','social','watch','apple'];if(!Array.isArray(sources)||!sources.length||sources.some(s=>!['play','web','social','watch','apple'].includes(s)))throw new Error('Выберите источники нейронного поиска.');
 const engine=input.engine??'openai',mode=input.mode??'economy',ollamaModel=input.ollamaModel??'qwen2.5:3b';if(!['openai','ollama'].includes(engine)||!['economy','full'].includes(mode)||typeof ollamaModel!=='string'||!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(ollamaModel))throw new Error('Проверьте ИИ, режим анализа и модель Ollama.');
 const collectSources=input.collectSources??false;
 const enabled=input.enabled??false,time=input.time??'09:45',perRun=0,monthlyLimit=0,includeKnown=input.includeKnown??false;
 if(typeof collectSources!=='boolean'||typeof enabled!=='boolean'||typeof includeKnown!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание проверки ИИ.');

 const translateRu=input.translateRu??true,evidenceBudget=0;if(typeof translateRu!=='boolean'||!Number.isInteger(evidenceBudget)||evidenceBudget<0)throw new Error('Перевод: да/нет; проверки Brave: 0–2000.');
 return {engine,mode,ollamaModel,translateRu,evidenceBudget,collectSources,enabled,time,perRun,monthlyLimit,includeKnown,sources:[...new Set(sources)]};
}
export function initialAIState(){return {config:reviewConfig(),results:[],jobs:[],inbox:[],newIds:[],shortlist:[],gatherJobs:[],localUsage:{},usage:{},lastSuccessAt:null,lastRunAt:null};}
