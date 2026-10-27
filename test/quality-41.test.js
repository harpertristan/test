import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateLicences,extractLicenceEvents,regulatoryKind} from '../lib/licences.js';
import {screenCandidate} from '../lib/screening.js';
import {nigeriaEvidence} from '../lib/geography.js';
import {collectEvidence,validateAssessment,reviewDocuments,dueReviews,createAIReview,validatedTranslations} from '../lib/ai-review.js';
import {namedProductLinks,VALIDATION_POLICY_VERSION} from '../lib/product-evidence.js';
import {revalidateStoredAnalyses,repairStoredResult} from '../lib/review-repair.js';
import {memoryStore,openStore} from '../lib/store.js';
import {inboxEntry,storeInbox,groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,crmExport,chatPacket,excludeCRM} from '../lib/crm.js';
import {createApp,shutdownApp} from '../server.js';
const cases=JSON.parse(await readFile(new URL('./fixtures/audit-excerpts-2026-10.json',import.meta.url),'utf8')).cases;
const example=i=>cases.find(r=>r.index===i),now=new Date('2026-10-28T12:00:00Z'),unknown=()=>Object.fromEntries(['business','account','euIban','utility'].map(k=>[k,{status:'unknown',evidence:[]}])) ;
const docs=r=>r.documents.map((d,i)=>({...d,id:'s'+(i+1)}));
function seed(store,index,title){const r=example(index),entry={title:title??r.name,url:r.url,developerWebsite:r.website??(r.id.startsWith('company:')?'https://'+r.id.slice(8):null),screeningText:r.documents.find(d=>d.url===r.url)?.text??r.documents[0].text};storeInbox(store.state,[inboxEntry(entry,'web',now)]);const group=groupedCandidates(store.state,{includeExcluded:true,allSources:true}).find(g=>g.url===r.url);assert.ok(group,r.name);const result={id:group.id,title:entry.title,url:r.url,developerWebsite:entry.developerWebsite,serviceName:r.name,inputHash:group.inputHash,model:'fixture',mode:'economy',version:2,facts:r.facts??unknown(),licences:r.licences,sourceDocuments:docs(r),summary:r.summary,checkedAt:now.toISOString()};store.state.ai.results.push(result);return group.id;}

test('AMF application forms and generic NCA cannot become licensed provider companies',()=>{
 for(const i of [213,501]){const r=example(i),d=docs(r),raw={licences:r.licences.map(l=>({...l,sourceId:d.find(doc=>doc.url===l.url)?.id}))};assert.deepEqual(validateLicences(raw,d),[]);assert.equal(regulatoryKind({title:r.name,url:r.url,documents:d}),'reference');assert.equal(screenCandidate({title:r.name,url:r.url,documents:d}).eligible,false);}
});
test('the subject granting a permission is not mistaken for its recipient',()=>{
 const quote='The Central Bank of Ireland authorised Acme Ltd as an electronic money institution.',d=[{id:'s1',url:'https://registers.centralbank.ie/firm/acme',text:quote}];
 const make=organisation=>validateLicences({licences:[{type:'emi',organisation,sourceId:'s1',quote}]},d);
 assert.notEqual(make('Central Bank of Ireland')[0]?.status,'authorised');assert.equal(make('Acme Ltd')[0].status,'authorised');
});
test('named Latvian decisions recognise decided to issue and retain both PI and CASP',()=>{
 for(const i of [319,324]){const r=example(i),events=extractLicenceEvents(docs(r));assert.deepEqual(events.map(l=>l.type).sort(),['casp','pi']);assert.ok(events.every(l=>l.status==='authorised'));assert.ok(events.every(l=>l.decisionDate===null));assert.equal(regulatoryKind({title:r.name,url:r.url,documents:docs(r)}),'entity');}
});
test('an EMI permission does not become an extra bank licence from an explicit non-bank disclaimer',()=>{
 const text='Acme UAB is authorised as an electronic money institution and is not a credit institution.',url='https://www.lb.lt/en/news/acme',result=extractLicenceEvents([{id:'s1',url,text}]);assert.deepEqual(result.map(l=>l.type),['emi']);assert.equal(result[0].status,'authorised');
});
test('guidance containing a named example stays reference material rather than a new company event',()=>{
 const entry={title:'Licensing guide for electronic money institutions',url:'https://www.lb.lt/en/licensing-guide',documents:[{id:'s1',url:'https://www.lb.lt/en/licensing-guide',text:'Example: Acme UAB was authorised as an electronic money institution.'}]};assert.equal(regulatoryKind(entry),'reference');
});
test('article research skips Calendly and follows only the named financial provider',async()=>{
 const url='https://publisher.example/news/bunq-launch',body='<a href="https://calendly.com/demo">Book a business account call</a><a href="https://www.bunq.com/business">bunq business account</a>',text='bunq launches a new business account.';const seen=[];
 const result=await collectEvidence({title:'bunq launches business account',url,documents:[{url,kind:'third_party',text}]},{signal:new AbortController().signal,pages:{page:async target=>{seen.push(target);return target===url?{url,text,body}:{url:target,text:'bunq offers business accounts.',body:''};}}});assert.equal(result.productURL,'https://www.bunq.com/business');assert.ok(!seen.some(s=>s.includes('calendly')));assert.ok(namedProductLinks(body,url,{title:'General comparison',text:'No provider is named.'}).length===0);
});
test('games, private card vaults and tax portals are rejected before AI while a non-bank IBAN provider survives',()=>{
 for(const i of [1,26,31]){const r=example(i);assert.equal(screenCandidate({title:r.name,url:r.url,documents:docs(r)}).eligible,false,r.name);}
 const text='We are not a bank. Our business accounts for companies are provided through a licensed EMI partner. Obtain your German IBAN and receive EUR transfers.';assert.ok(screenCandidate({title:'New crypto IBAN provider',documents:[{kind:'listing',url:'https://play.google.com/store/apps/details?id=co.new.provider',text}]}).eligible);
});
test('Nigeria role evidence blocks BellMonie but a country selector does not block Skrill or VP Bank',()=>{
 const bank=example(12);assert.equal(nigeriaEvidence({title:bank.name,documents:docs(bank)}).reason,'excludedNigeria');
 for(const i of [101,108])assert.equal(nigeriaEvidence({title:example(i).name,documents:docs(example(i))}),null,example(i).name);
});
test('Finom exact business and French IBAN excerpts are retained without the old adjacency restriction',()=>{
 const d=docs(example(59)),result=validateAssessment({...unknown(),summaryRu:'Сведения об IBAN не указаны.'},d);assert.equal(result.decision,'match');assert.equal(result.facts.euIban.status,'yes');assert.match(result.facts.euIban.evidence[0].quote,/French IBAN/);assert.ok(d.some(doc=>doc.text.includes(result.facts.euIban.evidence[0].quote)));assert.match(result.summary,/есть подтверждающая цитата/);assert.ok(result.quality.recoveredFacts.includes('euIban'));
});
test('personal IBAN, transfer destinations, shared deposits and non-EU accounts cannot borrow business proof',()=>{
 for(const claim of ['Personal accounts receive a German IBAN.','Send payments to a German IBAN.','Obtain a GB IBAN for business.','Receive funds using our shared IBAN in Germany.']){const text='We offer business accounts. '+claim,d=[{id:'s1',url:'https://acme.eu/business',kind:'official_page',text}],f=quote=>({status:'yes',evidence:[{sourceId:'s1',quote}]});const result=validateAssessment({business:f('We offer business accounts.'),account:f(claim),euIban:f(claim),utility:{status:'unknown',evidence:[]}},d);assert.equal(result.facts.euIban.status,'unknown',claim);assert.notEqual(result.decision,'match');assert.ok(result.factReasons.euIban);}
});
test('business and IBAN listing evidence outranks unrelated personal and privacy pages',()=>{
 const docs=[{id:'s1',url:'https://bank.eu/personal/joint-accounts',kind:'official_page',text:'Personal joint accounts.'},{id:'s2',url:'https://bank.eu/personal/savings-accounts',kind:'official_page',text:'Personal savings accounts.'},{id:'s3',url:'https://bank.eu/privacy',kind:'official_page',text:'Privacy and cookies.'},{id:'s4',url:'https://play.google.com/store/apps/details?id=co.bank.biz',kind:'listing',text:'Business accounts with your French IBAN.'}];const selected=reviewDocuments(docs);assert.equal(selected[0].id,'s4');assert.ok(selected[0].text.includes('French IBAN'));
});
test('secondary IBAN calculator evidence cannot turn a bank application into a utility',()=>{
 const d=[{id:'s1',url:'https://play.google.com/store/apps/details?id=co.bank',kind:'listing',text:'We offer business accounts with your German IBAN.'},{id:'s2',url:'https://bank.eu/iban-generator',kind:'official_page',text:'This calculator generates IBAN for existing accounts.'}],result=validateAssessment({...unknown(),utility:{status:'yes',evidence:[{sourceId:'s2',quote:d[1].text}]}},d);assert.equal(result.facts.utility.status,'unknown');assert.equal(result.decision,'match');
});
test('invalid Russian summaries are replaced with checked facts and bad translations are not shown as Russian',()=>{
 const d=[{id:'s1',url:'https://bank.eu',kind:'official_page',text:'No account information is available.'}],result=validateAssessment({...unknown(),summaryRu:'Банк 提供账户'},d);assert.ok(!/[\u3400-\u9fff]/u.test(result.summary));assert.match(result.summary,/не подтверждено/);assert.equal(result.summaryOriginal,'Банк 提供账户');assert.ok(result.quality.issues.includes('russian_text_invalid'));assert.deepEqual(validatedTranslations({translations:[{sourceId:'s1',translationRu:'提供账户'}]},d),[]);
});
test('offline repair reclassifies old results, preserves exclusions and notes, and does not enqueue the whole history',()=>{
 const store=memoryStore(now),finom=seed(store,59),vault=seed(store,1),form=seed(store,213),bell=seed(store,12);store.state.crm.records[finom]={notes:'Сохранить мой комментарий'};excludeCRM(store.state,vault,now,'worked');const rules=structuredClone(store.state.manualExclusions);
 const repaired=revalidateStoredAnalyses(store.state,now),rows=crmRows(store.state);assert.equal(repaired.apiCalls,0);assert.equal(rows.find(r=>r.id===finom).status,'confirmed');assert.equal(rows.find(r=>r.id===finom).notes,'Сохранить мой комментарий');assert.equal(rows.find(r=>r.id===vault).status,'excluded');assert.deepEqual(store.state.manualExclusions,rules);assert.equal(rows.find(r=>r.id===form).status,'reference');assert.equal(rows.find(r=>r.id===bell).status,'auto_excluded');assert.equal(dueReviews(store.state,'fixture',now).length,0);assert.ok(!crmExport(store.state).some(r=>[vault,form,bell].includes(r.id)));
 revalidateStoredAnalyses(store.state,now);const repeated=crmRows(store.state).find(r=>r.id===finom);assert.equal(repeated.status,'confirmed');assert.match(repeated.summary,/EU IBAN: есть подтверждающая цитата/);assert.ok(repeated.quality.recoveredFacts.includes('euIban'));
});
test('targeted retry uses saved documents, skips manual exclusions and makes only the requested model calls',async()=>{
 const store=memoryStore(now),id=seed(store,54);revalidateStoredAnalyses(store.state,now);let pages=0,calls=0;const review=createAIReview({store,clock:()=>now,pages:{page:async()=>{pages++;throw Error('must reuse saved text');}},provider:{configured:()=>true,model:'fixture',assess:async({documents})=>{calls++;assert.ok(documents.some(d=>/French IBAN/.test(d.text)));return{assessment:{...unknown(),summaryRu:'Условия бизнеса не подтверждены.'},model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});assert.equal(review.summary().repairDue,1);await review.startJob({repairOnly:true,reuseSaved:true});await review.idle();assert.equal(calls,1);assert.equal(pages,0);excludeCRM(store.state,id,now,'worked');assert.equal(review.summary().repairDue,0);await assert.rejects(review.startJob({repairOnly:true}),{status:409});
});
test('repeated offline repair retains waitlist restrictions and the audit archive of removed foreign sources',()=>{
 const url='https://acme.eu/business',text='We offer business accounts. Obtain your German IBAN. Our business account is currently a waitlist product.',quote='Our business account is currently a waitlist product.';
 const entry={id:'company:acme.eu',title:'Acme',url,developerWebsite:url,documents:[{url,kind:'official_page',text}]},foreign={url:'https://calendly.com/demo',kind:'official_page',text:'Accounts are provided by Foreign Bank. Use our online banking portal.'};
 const old={id:entry.id,serviceName:'Acme',facts:unknown(),availability:{status:'waitlist',evidence:[{url,quote}]},sourceDocuments:[...entry.documents,foreign],summary:'Требуется проверка.',mode:'economy'};
 const first=repairStoredResult(old,entry),second=repairStoredResult(first,entry);
 for(const r of[first,second]){assert.equal(r.availability.status,'waitlist');assert.equal(r.decision,'review');assert.deepEqual(r.removedSourceUrls,[foreign.url]);assert.ok(r.sourceDocumentsOriginal.some(d=>d.url===foreign.url));assert.equal(r.delivery.kind,'unknown');assert.equal(r.webPresence.cabinet.status,'unknown');}
});
test('migration of stored data repairs once without changing API counters, secrets or manual decisions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'quality-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=memoryStore(now),id=seed(store,59);store.state.crm.records[id]={notes:'Заметка',status:'selected'};store.state.ai.usage['2026-10']={attempts:7,inputTokens:100,outputTokens:20};const stateFile=join(dir,'state.json');await writeFile(stateFile,JSON.stringify(store.state));const opened=await openStore(stateFile,now);assert.equal(opened.state.ai.validationPolicyVersion,VALIDATION_POLICY_VERSION);assert.equal(opened.state.ai.usage['2026-10'].attempts,7);assert.equal(opened.state.crm.records[id].status,'selected');const at=opened.state.ai.lastRepair.at;const second=await openStore(stateFile,new Date('2026-10-29'));assert.equal(second.state.ai.lastRepair.at,at);
});
test('audit export contains model, policy, rejection reasons and original title without exporting credentials',()=>{
 const store=memoryStore(now);seed(store,59);revalidateStoredAnalyses(store.state,now);const packet=chatPacket(crmRows(store.state),{appVersion:'4.1.0'}),r=packet.records[0];assert.equal(packet.schemaVersion,2);assert.equal(r.diagnostics.policyVersion,VALIDATION_POLICY_VERSION);assert.equal(r.diagnostics.model,'fixture');assert.ok(r.title);assert.ok(r.diagnostics.quality);assert.ok(!JSON.stringify(packet).includes('OPENAI_API_KEY'));
});
test('offline repair endpoint is owner-only and does not invoke a provider',async t=>{
 const store=memoryStore(now);seed(store,59);let calls=0;const server=createApp({store,password:'owner-pass',viewerPassword:'viewer-pass',aiProvider:{configured:()=>true,model:'fixture',assess:async()=>{calls++;throw Error('not expected');}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const url='http://127.0.0.1:'+server.address().port+'/api/crm/repair',headers=who=>({'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(who).toString('base64')});assert.equal((await fetch(url,{method:'POST',headers:headers('viewer:viewer-pass'),body:'{}'})).status,403);const response=await fetch(url,{method:'POST',headers:headers('admin:owner-pass'),body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).apiCalls,0);assert.equal(calls,0);
});
test('cloud workers that finish early do not skip newly promoted licence websites',async()=>{
 const store=memoryStore(now),url='https://www.lb.lt/en/news/acme',quote='Bank of Lithuania authorised Acme UAB as an electronic money institution.';
 store.state.social.findings.push({id:'grant',source:'registers',title:'Acme UAB authorised',url,snippet:quote});
 const text='We offer business accounts for companies. Obtain your German IBAN.';
 for(let i=0;i<2;i++)store.state.findings.push({appId:'co.queue.'+i,title:'Queue '+i,url:'https://play.google.com/store/apps/details?id=co.queue.'+i,screeningText:text});
 let calls=0;const review=createAIReview({store,pages:{page:async target=>{if(target!==url)await new Promise(r=>setTimeout(r,25));return target===url?{url,text:quote,body:'<a href="https://acme.eu/">Acme UAB</a>'}:{url:target,text,body:''};}},provider:{model:'fixture',configured:()=>true,assess:async()=>{calls++;return{assessment:{...unknown(),summaryRu:'Счёт по исходным данным.'},model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});await review.startJob();await review.idle();assert.equal(calls,3);assert.ok(review.results().some(r=>r.id==='company:acme.eu'&&r.decision==='match'));assert.equal(store.state.ai.jobs[0].done,4);assert.equal(store.state.ai.jobs[0].total,4);assert.equal(store.state.ai.usage[new Date().toISOString().slice(0,7)].attempts,3);
});
test('Nigeria discovered on the fetched site is screened before any AI call or charged attempt',async()=>{
 const store=memoryStore(now),text='Our business accounts let companies receive payments.';store.state.findings.push({appId:'co.scope.bank',title:'New provider',url:'https://play.google.com/store/apps/details?id=co.scope.bank',developerWebsite:'https://scope-bank.eu/',screeningText:text});let calls=0;const review=createAIReview({store,pages:{page:async url=>({url,text:'Banking and deposit services are provided by partners regulated by the Central Bank of Nigeria.',body:''})},provider:{model:'fixture',configured:()=>true,assess:async()=>{calls++;throw Error('should not call AI');}}});await review.startJob();await review.idle();assert.equal(calls,0);assert.equal(review.summary().usage.attempts,0);assert.equal(crmRows(store.state)[0].status,'auto_excluded');
});
test('deterministic grant dates come from the decision sentence, never discovery or a yearless date',()=>{
 const url='https://www.lb.lt/en/news/acme',text='On 24 October 2026, Bank of Lithuania authorised Acme UAB as an electronic money institution.';assert.equal(extractLicenceEvents([{id:'s1',url,text}])[0].decisionDate,'2026-10-24');assert.equal(extractLicenceEvents([{id:'s1',url,text:text.replace('24 October 2026','24 October')}])[0].decisionDate,null);
});
