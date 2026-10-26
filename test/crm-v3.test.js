import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {memoryStore,openStore} from '../lib/store.js';
import {nigeriaEvidence} from '../lib/geography.js';
import {excluded,validateCriteria} from '../lib/qualification.js';
import {validateConfig,exclusion,createJob,runSearch} from '../lib/search.js';
import {appleProvider,validateAppleConfig,applePlan,createAppleJob,runAppleSearch} from '../lib/app-store.js';
import {cataloguePreset} from '../lib/discovery.js';
import {inboxEntry,storeInbox,groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,editCRM,excludeCRM,restoreCRM,crmExport,crmCSV,crmDOCX,chatPacket} from '../lib/crm.js';
import {validateLicences,licenceLead} from '../lib/licences.js';
import {socialPlan,RECOMMENDED_SOURCES} from '../lib/source-catalog.js';
import {validateSocialConfig} from '../lib/social-search.js';
import {braveProvider} from '../lib/brave-provider.js';
import {createApp,shutdownApp} from '../server.js';
import {createAIReview,validatedTranslations} from '../lib/ai-review.js';
const now=new Date('2026-10-26T08:00:00Z');
const text='Acme offers business accounts for companies. Open a business account with a German IBAN. Use our online banking dashboard.';
const bank={appId:'co.acme.business',title:'Acme Business',developer:'Acme',genreId:'BUSINESS',price:0,free:true,released:'2026-10-01',minInstalls:1,description:text,screeningText:text,developerWebsite:'https://acme.example.eu/',url:'https://play.google.com/store/apps/details?id=co.acme.business',firstFoundAt:now.toISOString()};
const filters=patch=>validateConfig({...cataloguePreset(['DE']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false,...patch},now);
function state(){const s=memoryStore(now).state;s.findings.push({...bank});return s;}
const fact=(status,quote,sourceId='s1')=>({status,evidence:quote?[{sourceId,quote}]:[]});
const reply=documents=>({business:fact('yes','Acme offers business accounts for companies.'),account:fact('yes','Open a business account with a German IBAN.'),euIban:fact('yes','Open a business account with a German IBAN.'),utility:fact('unknown'),summaryRu:'Предлагается бизнес-счёт с немецким IBAN.',translations:documents.map(d=>({sourceId:d.id,translationRu:'Acme предлагает счета для компаний. Доступен немецкий IBAN и интернет-банк.'}))});
test('Nigeria exclusions cover title, descriptions, NGN and .ng without confusing Niger or a storefront',()=>{
 for(const entry of [{title:'Nigerian business account'},{screeningText:'Built in Nigeria'},{snippet:'Hold NGN naira balances'},{developerWebsite:'https://example.com.ng/'}])assert.equal(nigeriaEvidence(entry).reason,'excludedNigeria');
 for(const entry of [{title:'Niger startup'},{countries:['NG'],title:'German business bank'},{title:'Netherlands Business Account'}])assert.equal(nigeriaEvidence(entry),null);
 assert.equal(excluded({text:'Nigerian bank'},validateCriteria({profile:'business'})),'excludedNigeria');
});
test('historical Nigeria projects remain auditable in CRM but cannot enter the AI queue or active exports',()=>{
 const s=state();s.findings.push({...bank,appId:'co.nigeria.bank',title:'Nigeria Bank',developerWebsite:'https://bank.ng/',screeningText:text+' NGN'});
 assert.equal(groupedCandidates(s).length,1);const rows=crmRows(s);assert.equal(rows.length,2);assert.equal(rows.find(r=>r.title==='Nigeria Bank').status,'auto_excluded');assert.equal(crmExport(s).length,1);assert.equal(crmExport(s,{status:'auto_excluded'}).length,1);
});
test('four Google Play categories retain account providers; finance-only selection still works',()=>{
 for(const genreId of ['FINANCE','BUSINESS','PRODUCTIVITY','TOOLS'])assert.equal(exclusion({...bank,genreId},filters()),null);
 assert.equal(exclusion(bank,filters({categories:['FINANCE']})),'category');assert.equal(exclusion({...bank,genreId:'GAME'},filters()),'category');
});
test('old result and request ceilings are ignored while concurrency remains bounded',()=>{
 const c=filters({maxDetails:1,googleRequestBudget:1,recommendationBudget:1,evidenceBudget:1});assert.equal(c.maxDetails,0);assert.equal(c.googleRequestBudget,0);assert.equal(c.recommendationBudget,0);assert.equal(c.evidenceBudget,0);assert.throws(()=>filters({searchConcurrency:99}));
 const social=validateSocialConfig({profile:'business',sources:RECOMMENDED_SOURCES,queries:['business account'],eventMode:'signals',requestBudget:1},now);assert.equal(socialPlan(social,now).requests.length,socialPlan(social,now).total);assert.ok(socialPlan(social,now).total>20);
});
test('details appear while later Google queries are still waiting; cancellation preserves the completed match',{timeout:2500},async()=>{
 const controller=new AbortController();let waiting,found;const ready=new Promise(r=>waiting=r),saved=new Promise(r=>found=r);let calls=0;
 const {createMonitor}=await import('../lib/monitor.js');const store=memoryStore(now),m=createMonitor({store,delay:0,requestTimeoutMs:2000,clock:()=>now,provider:{search:async()=>++calls===1?[bank]:(waiting(),new Promise(()=>{})),app:async()=>bank}});
 const j=await m.startJob(filters({keywords:['business account','corporate account'],searchConcurrency:1}));await ready;
 for(let i=0;i<50&&!store.state.findings.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(store.state.findings.length,1);assert.equal(j.searchDone,1);await m.cancel(j.id);assert.equal(j.status,'cancelled');assert.equal(m.summary().busy,false);
});
test('unlimited queue checks more than the legacy configured card count without duplicate reads',async()=>{
 const apps=Array.from({length:4},(_,i)=>({...bank,appId:`co.acme.app${i}`})),job=createJob('all',filters({maxDetails:1}));let reads=0;await runSearch(job,{search:async()=>apps,app:async({appId})=>{reads++;return apps.find(a=>a.appId===appId);}},{delay:0});assert.equal(job.results.length,4);assert.equal(reads,4);
});
test('Apple direct search uses EU storefronts and no credentials or Google install threshold',async()=>{
 let requested;const p=appleProvider({intervalMs:0,request:async url=>{requested=url;return{results:[]};}});await p.search({term:'crypto bank',country:'LT',limit:200});assert.equal(requested.hostname,'itunes.apple.com');assert.equal(requested.searchParams.get('country'),'lt');assert.equal(requested.searchParams.get('entity'),'software');assert.equal(requested.searchParams.get('limit'),'200');
 const c=validateAppleConfig({queries:['one','two'],countries:['DE','FR'],requestBudget:1});assert.equal(applePlan(c,now).requests.length,4);assert.equal(c.requestBudget,0);
});
test('Apple genre screening retains a business service, rejects Nigeria and paid apps and deduplicates IDs',async()=>{
 const config=validateAppleConfig({queries:['business account'],countries:['DE']}),job=createAppleJob('apple',config,now),raw=[];
 const a={trackId:123456,trackName:'Acme',sellerUrl:'https://acme.example.eu',description:text,genreIds:['6000'],primaryGenreId:6000,price:0,releaseDate:'2026-10-01T00:00:00Z'};
 await runAppleSearch(job,{search:async()=>[a,a,{...a,trackId:789,description:text+' Nigeria NGN'}, {...a,trackId:456,price:3}]},{delay:0,clock:()=>now,onRawCandidate:async e=>raw.push(e)});assert.equal(job.status,'complete');assert.equal(job.results.length,1);assert.equal(job.results[0].url,'https://apps.apple.com/de/app/id123456');assert.equal(job.skipped.excludedNigeria,1);assert.equal(job.skipped.paid,1);assert.equal(job.skipped.duplicate,1);assert.equal(raw.length,3);
});
test('Google Play, Apple and web snapshots merge by actual provider domain in CRM',()=>{
 const s=state();s.apple.findings.push({id:'apple:123',appId:'apple:123',title:'Acme iOS',developerWebsite:bank.developerWebsite,url:'https://apps.apple.com/de/app/id123',screeningText:text});s.web.findings.push({id:'web:123',title:'Acme web',url:bank.developerWebsite,snippet:text});
 const rows=crmRows(s);assert.equal(rows.length,1);assert.deepEqual(new Set(rows[0].sources),new Set(['play','apple','web']));assert.equal(rows[0].targets.length,3);
});
test('CRM manual exclusion is global, export honors it, restore retains notes and shortlist',()=>{
 const s=state(),id=crmRows(s)[0].id;editCRM(s,{id,status:'selected',notes:'Проверить открытие для компании ЕС'});assert.ok(s.ai.shortlist.includes(id));excludeCRM(s,id,now);assert.equal(crmRows(s)[0].status,'excluded');assert.equal(groupedCandidates(s).length,0);assert.equal(crmExport(s).length,0);assert.equal(crmExport(s,{status:'all'}).length,0);assert.equal(crmExport(s,{status:'excluded'}).length,1);restoreCRM(s,id);assert.equal(crmRows(s)[0].status,'selected');assert.equal(crmRows(s)[0].notes,'Проверить открытие для компании ЕС');assert.equal(s.manualExclusions.length,0);
});
test('orphan exclusions are visible and restorable even after the source leaves retained jobs',()=>{
 const s=state();s.manualExclusions.push({key:'old',kind:'url',value:'https://old.example.eu',title:'Old project',url:'https://old.example.eu'});const row=crmRows(s).find(r=>r.exclusionKey==='old');assert.ok(row);restoreCRM(s,row.id);assert.equal(s.manualExclusions.length,0);
});
test('CRM CSV, Word and chat packet contain notes, analyses and originals without formula injection',()=>{
 const s=state(),id=crmRows(s)[0].id;editCRM(s,{id,status:'selected',notes:'=HYPERLINK("bad")'});const rows=crmExport(s);assert.match(crmCSV(rows),/'=HYPERLINK/);assert.match(crmCSV(rows),/Оригиналы/);const doc=crmDOCX(rows);assert.equal(doc.subarray(0,2).toString(),'PK');const packet=chatPacket(rows);assert.equal(packet.records[0].documents[0].text,text);assert.equal(packet.records[0].notes,'=HYPERLINK("bad")');
});
test('automatic Russian translation preserves exact original sources and ignores invented source IDs',()=>{
 const d=[{id:'s1',url:bank.url,text,kind:'listing'}],translations=validatedTranslations({translations:[{sourceId:'s1',translationRu:'Русский перевод'},{sourceId:'fake',translationRu:'Выдумка'}]},d);assert.equal(translations.length,1);assert.equal(translations[0].original,text);assert.equal(translations[0].translationRu,'Русский перевод');
});
test('AI analyses every queued project and stores translation while preserving genuine quote checks',async()=>{
 const store=memoryStore(now);store.state.findings.push(bank,{...bank,appId:'co.other.app',developerWebsite:'https://other.example.eu',url:'https://play.google.com/store/apps/details?id=co.other.app'});
 const ai=createAIReview({store,clock:()=>now,pages:{page:async()=>{throw Error('offline');}},provider:{configured:()=>true,model:'fixture',assess:async({documents,translateRu})=>{assert.equal(translateRu,true);return {assessment:reply(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});await ai.saveConfig({...ai.summary().config,perRun:1,monthlyLimit:1});await ai.startJob();await ai.idle();assert.equal(ai.results().length,2);assert.match(ai.results()[0].translations[0].original,/German IBAN/);assert.equal(ai.results()[0].translations[0].scope,'evidence');assert.equal(ai.results()[0].sourceDocuments[0].text,text);assert.equal(ai.results()[0].decision,'match');assert.equal(ai.summary().usage.attempts,2);assert.equal(ai.summary().config.monthlyLimit,0);
});
const licenceQuote='On 24 October 2026, Bank of Lithuania authorised Acme UAB as an electronic money institution in Lithuania.';
const licenceDocs=[{id:'s1',url:'https://www.lb.lt/en/news/acme',text:licenceQuote,kind:'official_page'}];
const licence={type:'emi',organisation:'Acme UAB',authority:'Bank of Lithuania',country:'Lithuania',decisionDate:'2026-10-24',sourceId:'s1',quote:licenceQuote};
test('EMI licence extracts named company and decision date only from exact official text',()=>{
 const result=validateLicences({licences:[licence]},licenceDocs);assert.equal(result.length,1);assert.equal(result[0].status,'authorised');assert.equal(result[0].decisionDate,'2026-10-24');assert.equal(result[0].organisation,'Acme UAB');assert.ok(licenceLead({url:licenceDocs[0].url,snippet:licenceQuote}));
});
test('MiCA CASP authorisation is distinct from VASP registration, applications and licence withdrawal',()=>{
 const quote='AMF authorised Nova SAS as a crypto-asset service provider under MiCA on 2026-10-23.';
 const docs=[{id:'s1',url:'https://www.amf-france.org/en/news/nova',text:quote}],raw={...licence,type:'casp',organisation:'Nova SAS',authority:'AMF',decisionDate:'2026-10-23',quote};assert.equal(validateLicences({licences:[raw]},docs)[0].status,'authorised');
 const old='Nova SAS registered as a virtual asset service provider (VASP).';assert.equal(validateLicences({licences:[{...raw,type:'vasp',quote:old}]},[{...docs[0],text:old}])[0].status,'registered');
 for(const text of ['Nova SAS applied for authorisation as a crypto-asset service provider under MiCA.','AMF revoked Nova SAS authorisation as a crypto-asset service provider.']){const r=validateLicences({licences:[{...raw,quote:text}]},[{...docs[0],text}]);assert.equal(r[0].status,'needs_review');assert.equal(r[0].decisionDate,null);}
});
test('unsupported regulator claims, invented companies and forged dates cannot become licence evidence',()=>{
 assert.deepEqual(validateLicences({licences:[licence]},[{...licenceDocs[0],url:'https://acme.example.eu/blog'}]),[]);assert.deepEqual(validateLicences({licences:[{...licence,organisation:'Invented UAB'}]},licenceDocs),[]);assert.equal(validateLicences({licences:[{...licence,decisionDate:'2026-10-25'}]},licenceDocs)[0].decisionDate,null);assert.deepEqual(validateLicences({licences:[{...licence,type:'casp'}]},licenceDocs),[]);
});
test('CRM licence filters default to EMI and MiCA and keep type-specific exports consistent',()=>{
 const s=state();storeInbox(s,[inboxEntry({title:'EMI authorisation',url:licenceDocs[0].url,snippet:licenceQuote},'social',now),inboxEntry({title:'MiCA authorisation',url:'https://www.esma.europa.eu/news/nova',snippet:'Nova authorised as a CASP under MiCA.'},'social',now)]);
 assert.equal(crmExport(s,{status:'licences'}).length,2);assert.equal(crmExport(s,{status:'licences',licenceType:'emi'}).length,1);assert.equal(crmExport(s,{status:'licences',licenceType:'casp'}).length,1);
});
test('Brave loads permitted pages until exhaustion, deduplicates repeats and counts actual calls',async()=>{
 const offsets=[];const p=braveProvider({key:'fake',minInterval:0,request:async url=>{const offset=Number(url.searchParams.get('offset'));offsets.push(offset);return{query:{more_results_available:offset<2},web:{results:offset===2?[]:[{url:`https://a.example.eu/${offset}`,title:'Bank'}]}};}});const rows=await p.search({q:'business account',allPages:true});assert.equal(rows.length,2);assert.deepEqual(offsets,[0,1,2]);
});
test('Brave pagination stops repeated pages without an infinite loop and preserves partial responses',async()=>{
 let calls=0;const p=braveProvider({key:'fake',minInterval:0,request:async()=>{calls++;return{web:{results:[{url:'https://same.example.eu/',title:'Bank'}]}};}});assert.equal((await p.search({q:'test',allPages:true})).length,1);assert.equal(calls,2);
 let n=0;const partial=braveProvider({key:'fake',minInterval:0,request:async()=>{if(n++)throw Error('network');return{web:{results:[{url:'https://one.example.eu'}]}};}});const results=await partial.search({q:'test',allPages:true});assert.equal(results.length,1);assert.equal(results.partialError,true);
});
test('upgrading preserves CRM notes, manual exclusions and disabled schedules and removes old quotas',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'scout-crm-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),s=state(),id=crmRows(s)[0].id;editCRM(s,{id,status:'watch',notes:'Сохранить'});for(const section of [s,s.social,s.web,s.watch,s.apple])section.schedule.enabled=false;s.schedule.filters.maxDetails=1;s.ai.config.perRun=1;s.ai.config.monthlyLimit=1;await writeFile(file,JSON.stringify(s));const opened=await openStore(file,now);assert.equal(opened.state.ai.config.perRun,0);assert.equal(opened.state.schedule.filters.maxDetails,0);assert.equal(crmRows(opened.state)[0].notes,'Сохранить');assert.equal(opened.state.apple.schedule.enabled,false);
});
test('CRM and Apple API respect authentication, cross-site guards and real download responses',async t=>{
 const store=memoryStore(now);store.state.findings.push(bank);const server=createApp({store,password:'test-only',appStoreProvider:{search:async()=>[]}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Basic '+Buffer.from('admin:test-only').toString('base64'),'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/crm')).status,401);assert.equal((await fetch(base+'/api/crm')).status,401);assert.equal((await fetch(base+'/api/apple/defaults',{headers})).status,200);assert.equal((await fetch(base+'/api/crm/update',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);
 const id=crmRows(store.state)[0].id;assert.equal((await fetch(base+'/api/crm/update',{method:'POST',headers,body:JSON.stringify({id,status:'watch',notes:'Проверить сайт'})})).status,200);for(const file of ['export.csv','export.docx','chat.json']){const response=await fetch(base+'/api/crm/'+file,{headers});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.ok((await response.arrayBuffer()).byteLength>20);}
 assert.equal((await fetch(base+'/api/licences',{headers})).status,200);assert.equal((await fetch(base+'/api/crm/item?'+new URLSearchParams({id}),{headers})).status,200);
});

test('direct registry watch includes official EMI/MiCA pages and detects changes without claiming a grant',async()=>{
 const {watchPlan,validateWatchConfig,relevantText}=await import('../lib/watch.js');const config=validateWatchConfig({watchUrls:[],watchApps:[],autoWatchFindings:false,autoWatchSites:false,watchRegisters:true});const urls=watchPlan(config,[],now).map(t=>t.url);assert.ok(urls.some(u=>u.includes('esma.europa.eu')));assert.ok(urls.some(u=>u.includes('eba.europa.eu')));assert.match(relevantText(licenceQuote),/electronic money institution/);
});
test('unified daily mode disables independent schedules to avoid duplicate scans',{timeout:2000},async t=>{
 const store=memoryStore(now),server=createApp({store,clock:()=>now,autoSchedule:false,appStoreProvider:{search:async()=>[]}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base=`http://127.0.0.1:${server.address().port}`;const res=await fetch(base+'/api/crm/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:'10:15'})});assert.equal(res.status,200);assert.equal(store.state.ai.config.enabled,true);assert.equal(store.state.ai.config.collectSources,true);assert.equal(store.state.ai.config.time,'10:15');assert.equal(store.state.ai.config.sources.length,5);for(const s of [store.state,store.state.apple,store.state.web,store.state.social,store.state.watch])assert.equal(s.schedule.enabled,false);
});
test('explicit analysis of one selected CRM card can refresh unchanged cached information',async()=>{
 const store=memoryStore(now);store.state.findings.push(bank);let calls=0;const ai=createAIReview({store,clock:()=>now,pages:{page:async()=>{throw Error('offline');}},provider:{configured:()=>true,model:'fixture',assess:async({documents})=>{calls++;return {assessment:reply(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});await ai.startJob();await ai.idle();await assert.rejects(ai.startJob(),/Новых находок/);await ai.startJob({ids:[crmRows(store.state)[0].id]});await ai.idle();assert.equal(calls,2);assert.equal(ai.results().length,1);
});
test('fresh sources cannot leave an old AI verdict displayed as a confirmed CRM match',()=>{
 const s=state(),row=crmRows(s)[0];s.ai.results.push({id:row.id,inputHash:row.inputHash,decision:'match',facts:{},summary:'Ранее найдено совпадение'});assert.equal(crmRows(s)[0].status,'confirmed');s.findings[0].screeningText+=' New terms.';assert.equal(crmRows(s)[0].status,'review');assert.equal(crmRows(s)[0].analysisStale,true);
});

test('parallel AI cancellation waits for both workers and late replies cannot change a new run',{timeout:3000},async()=>{
 const store=memoryStore(now);store.state.findings.push(bank,{...bank,appId:'co.parallel.other',developerWebsite:'https://other.example.eu',url:'https://play.google.com/store/apps/details?id=co.parallel.other'});let entered=0,ready,hang=true;const waiting=new Promise(r=>ready=r),late=[];
 const ai=createAIReview({store,clock:()=>now,pages:{page:async()=>{throw Error('offline');}},provider:{configured:()=>true,model:'fixture',assess:async({documents})=>{if(hang){if(++entered===2)ready();return new Promise(resolve=>late.push(()=>resolve({assessment:reply(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}})));}return{assessment:reply(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});
 await ai.startJob();await waiting;await ai.cancel();assert.equal(ai.summary().busy,false);assert.equal(ai.results().length,0);hang=false;await ai.startJob();await ai.idle();assert.equal(ai.results().length,2);for(const resolve of late)resolve();await new Promise(r=>setImmediate(r));assert.equal(ai.results().length,2);assert.equal(ai.summary().usage.attempts,4);
});
