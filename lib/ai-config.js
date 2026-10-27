export const AI_REVIEW_VERSION=2;
export function reviewConfig(input={}){
 const sources=input.sources??['play','web','social','watch'];if(!Array.isArray(sources)||!sources.length||sources.some(s=>!['play','web','social','watch','apple'].includes(s)))throw new Error('Выберите источники нейронного поиска.');
 const engine=input.engine??'openai',mode=input.mode??'economy',ollamaModel=input.ollamaModel??'qwen2.5:3b';if(!['openai','ollama','gemini'].includes(engine)||!['economy','full'].includes(mode)||typeof ollamaModel!=='string'||!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(ollamaModel))throw new Error('Проверьте ИИ, режим анализа и модель Ollama.');
 const geminiModel=input.geminiModel??'gemini-2.5-flash-lite';if(typeof geminiModel!=='string'||!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(geminiModel))throw new Error('Проверьте название модели Gemini.');
 const cloudConcurrency=input.cloudConcurrency??3;if(!Number.isInteger(cloudConcurrency)||cloudConcurrency<1||cloudConcurrency>6)throw new Error('Параллельных облачных разборов: от 1 до 6.');
 const collectSources=input.collectSources??false;
 const enabled=sources.every(s=>s==='apple')?false:input.enabled??false,time=input.time??'09:45',perRun=0,monthlyLimit=0,includeKnown=input.includeKnown??false;
 if(typeof collectSources!=='boolean'||typeof enabled!=='boolean'||typeof includeKnown!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание проверки ИИ.');

 const translateRu=input.translateRu??true,evidenceBudget=0;if(typeof translateRu!=='boolean'||!Number.isInteger(evidenceBudget)||evidenceBudget<0)throw new Error('Перевод: да/нет; проверки Brave: 0–2000.');
 return {engine,mode,ollamaModel,geminiModel,cloudConcurrency,translateRu,evidenceBudget,collectSources,enabled,time,perRun,monthlyLimit,includeKnown,sources:[...new Set(sources.filter(s=>s!=='apple'))].length?[...new Set(sources.filter(s=>s!=='apple'))]:['play','web','social','watch']};
}
export function initialAIState(){return {config:reviewConfig(),results:[],jobs:[],inbox:[],newIds:[],shortlist:[],gatherJobs:[],localUsage:{},geminiUsage:{},usage:{},lastSuccessAt:null,lastRunAt:null};}
