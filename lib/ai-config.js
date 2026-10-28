export const AI_REVIEW_VERSION=2;
export function localEndpoints(input=['http://127.0.0.1:8081']){
 if(!Array.isArray(input)||!input.length||input.length>32)throw new Error('Укажите адреса локальных GPU-серверов, по одному на строку (до 32 обработчиков).');
 return [...new Set(input.map(raw=>{if(typeof raw!=='string')throw new Error('Некорректный адрес ИИ-сервера.');let u;try{u=new URL(raw);}catch{throw new Error('Укажите http://127.0.0.1:8081 или адрес компьютера в вашей сети.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Адрес ИИ: http(s), без пароля, пути и параметров.');return u.origin;}))];
}
export const HARDWARE_PROFILES={
 'windows-8gb':{name:'Windows · 32 ГБ RAM / NVIDIA 8 ГБ',engine:'llamacpp',mode:'economy',localModel:'qwen2.5-3b-instruct-q4_k_m',localEndpoints:['http://127.0.0.1:8081'],hardwareProfile:'windows-8gb'},
 'mac-m5-16gb':{name:'Mac M5 · 16 ГБ общей памяти',engine:'llamacpp',mode:'economy',localModel:'qwen2.5-3b-instruct-q4_k_m',localEndpoints:['http://127.0.0.1:8081'],hardwareProfile:'mac-m5-16gb'},
 'farm-6gpu':{name:'6 × RTX 2060 Super · один компьютер',engine:'llamacpp',mode:'economy',localModel:'qwen2.5-7b-instruct-q4_k_m',localEndpoints:Array.from({length:6},(_,i)=>'http://127.0.0.1:'+(8081+i)),hardwareProfile:'farm-6gpu'}
};
export function reviewConfig(input={}){
 const sources=input.sources??['play','web','social','watch'];if(!Array.isArray(sources)||!sources.length||sources.some(s=>!['play','web','social','watch','apple'].includes(s)))throw new Error('Выберите источники нейронного поиска.');
 const engine=input.engine??'openai',mode=input.mode??'economy',ollamaModel=input.ollamaModel??'qwen2.5:3b';if(!['openai','ollama','gemini','llamacpp'].includes(engine)||!['economy','full'].includes(mode)||typeof ollamaModel!=='string'||!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(ollamaModel))throw new Error('Проверьте ИИ, режим анализа и модель Ollama.');
 const endpoints=localEndpoints(input.localEndpoints),localModel=input.localModel??'play-scout-local',hardwareProfile=input.hardwareProfile??'custom';if(typeof localModel!=='string'||!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(localModel)||!['custom',...Object.keys(HARDWARE_PROFILES)].includes(hardwareProfile))throw new Error('Проверьте модель и аппаратный профиль локального ИИ.');
 const geminiModel=input.geminiModel??'gemini-2.5-flash-lite';if(typeof geminiModel!=='string'||!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(geminiModel))throw new Error('Проверьте название модели Gemini.');
 const cloudConcurrency=input.cloudConcurrency??3;if(!Number.isInteger(cloudConcurrency)||cloudConcurrency<1||cloudConcurrency>6)throw new Error('Параллельных облачных разборов: от 1 до 6.');
 const collectSources=input.collectSources??false;
 const enabled=sources.every(s=>s==='apple')?false:input.enabled??false,time=input.time??'09:45',perRun=0,monthlyLimit=0,includeKnown=input.includeKnown??false;
 if(typeof collectSources!=='boolean'||typeof enabled!=='boolean'||typeof includeKnown!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание проверки ИИ.');

 const translateRu=input.translateRu??true,evidenceBudget=0;if(typeof translateRu!=='boolean'||!Number.isInteger(evidenceBudget)||evidenceBudget<0)throw new Error('Перевод: да/нет; проверки Brave: 0–2000.');
 return {engine,mode,ollamaModel,localModel,localEndpoints:endpoints,hardwareProfile,geminiModel,cloudConcurrency,translateRu,evidenceBudget,collectSources,enabled,time,perRun,monthlyLimit,includeKnown,sources:[...new Set(sources.filter(s=>s!=='apple'))].length?[...new Set(sources.filter(s=>s!=='apple'))]:['play','web','social','watch']};
}
export function initialAIState(){return {config:reviewConfig(),results:[],jobs:[],inbox:[],newIds:[],shortlist:[],gatherJobs:[],localUsage:{},geminiUsage:{},usage:{},lastSuccessAt:null,lastRunAt:null};}
