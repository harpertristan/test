import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nonTargetMarketEvidence,DEFAULT_BLOCKED_JURISDICTIONS,validateMarketPolicy} from '../lib/market-scope.js';
import {pureCryptoWallet} from '../lib/crypto-scope.js';
import {screenCandidate} from '../lib/screening.js';
import {memoryStore,openStore} from '../lib/store.js';
import {inboxEntry,storeInbox,groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,crmExport} from '../lib/crm.js';
import {validateAssessment,dueReviews,createAIReview,reviewCacheKey} from '../lib/ai-review.js';
import {VALIDATION_POLICY_VERSION} from '../lib/product-evidence.js';
import {verifiedDecision} from '../lib/verification-policy.js';
import {utilityQuoteSupported} from '../lib/utility-evidence.js';
import {tuneFocusedSearch} from '../lib/focused-search.js';
import {DISCOVERY_KEYWORDS} from '../lib/discovery.js';
import {REFERENCE_LIBRARY,CURRENT_REFERENCE_EXAMPLES,referenceByName,referenceMatch,referenceQueries} from '../lib/references.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-29T08:00:00Z'),text='Acme offers business accounts for companies. Open your business account with a German IBAN.';
const entry=(host='acme.eu',patch={})=>({appId:'co.acme.app',title:'Acme',url:'https://play.google.com/store/apps/details?id='+(patch.appId??'co.acme.app')+'&gl=DE',developerWebsite:'https://'+host+'/',screeningText:text,...patch});
test('all 39 latest anchors are available without invented identities or bypassing product and market exclusions',()=>{
 assert.equal(CURRENT_REFERENCE_EXAMPLES.length,39);assert.equal(REFERENCE_LIBRARY.filter(r=>r.priority==='primary').length,39);
 for(const name of ['BORDERPAY','Omexpay','TantumPay','Moneybase']){const r=referenceByName(name);assert.ok(r,name);assert.equal(r.url,null);assert.deepEqual(r.appIds,[]);}
 assert.equal(referenceByName('Colibrix One').name,'Kartiera');assert.equal(referenceMatch({developerWebsite:'https://kartiera.eu/'}).name,'Kartiera');
 assert.equal(referenceMatch({developerWebsite:'https://www.bankpro.com/en/business'}).name,'BankPro');
 assert.equal(screenCandidate(entry('kartiera.eu',{developerCountry:'CN'})).eligible,false);assert.equal(screenCandidate(entry('myneoone.com',{title:'Crypto Wallet',screeningText:'A non-custodial Bitcoin wallet with private keys.'})).eligible,false);
 const store=memoryStore(now);tuneFocusedSearch(store.state,now);assert.equal(store.state.schedule.filters.referenceDiscovery,true);assert.ok(store.state.schedule.filters.referenceDomains.includes('kartiera.eu'));assert.ok(store.state.web.schedule.filters.referenceDomains.includes('railor.eu'));assert.ok(referenceQueries(store.state.schedule.filters).some(q=>q.keyword==='BORDERPAY Business'));
 assert.ok(!REFERENCE_LIBRARY.some(r=>/тест|через телефон/i.test(r.name)));
});
test('all explicitly excluded jurisdictions remain blocked even with an EU business product',()=>{
 for(const country of DEFAULT_BLOCKED_JURISDICTIONS){const e=entry('acme.eu',{developerCountry:country});const result=nonTargetMarketEvidence(e);assert.equal(result.code,'excludedJurisdiction',country);assert.equal(result.country,country);assert.equal(screenCandidate(e).eligible,false,country);}
 for(const host of ['bank.cn','bank.com.hk','bank.ae','bank.sa','bank.ru','bank.by','bank.ua','bank.kz','bank.uz','bank.am','bank.az','bank.kg','bank.tj','bank.md','bank.tm'])assert.equal(nonTargetMarketEvidence(entry(host)).code,'excludedJurisdiction',host);
});
test('Romania, Slovakia and Slovenia stay searchable; storefront and language never establish jurisdiction',()=>{
 for(const [code,host]of [['RO','bank.ro'],['SK','bank.sk'],['SI','bank.si']]){const e=entry(host,{developerCountry:code,url:'https://play.google.com/store/apps/details?id=co.bank&gl=RU',title:'حساب أعمال 企业账户'});assert.equal(nonTargetMarketEvidence(e),null);assert.equal(screenCandidate(e).eligible,true);}
 assert.equal(nonTargetMarketEvidence(entry('acme.lt',{title:'Бизнес-счёт',screeningText:text+' Supports customers in China, Ukraine and Belarus.'})),null);
 assert.equal(nonTargetMarketEvidence(entry('acme.eu',{screeningText:text+' For companies registered in China, additional checks apply.'})),null);
 assert.equal(nonTargetMarketEvidence(entry('acme.eu',{screeningText:text+' We are not based in China.'})),null);
 assert.equal(nonTargetMarketEvidence({title:'Acme EU IBAN launch',url:'https://news.cn/posts/acme',documents:[{url:'https://news.cn/posts/acme',kind:'third_party',text}]}),null,'publisher domain is not the provider jurisdiction');
});
test('published provider location overrides EU product claims; ordinary Italian words do not become SAR currency',()=>{
 for(const statement of ['Acme Ltd is headquartered in Hong Kong.','Acme is incorporated in China.','Our registered office is in Dubai.','Acme is based in Russia.','Acme is registered in Belarus.'])assert.equal(nonTargetMarketEvidence(entry('acme.com',{screeningText:statement+' '+text})).code,'excludedJurisdiction',statement);
 assert.equal(nonTargetMarketEvidence(entry('acme.eu',{screeningText:'Il saldo sarà restituito. '+text})),null);
 assert.equal(nonTargetMarketEvidence(entry('acme.ae'),{marketScope:'worldwide'}).code,'excludedJurisdiction');
 assert.equal(nonTargetMarketEvidence(entry('acme.ae'),{marketScope:'worldwide',blockedJurisdictions:[]}),null);
 assert.throws(()=>validateMarketPolicy({blockedJurisdictions:['ZZ']}));
});
test('non-European domestic products need European account evidence, not merely the word IBAN or a EUR balance',()=>{
 assert.equal(nonTargetMarketEvidence(entry('bank.co.jp',{screeningText:'Corporate banking in Japan for domestic companies.'})).country,'JP');
 assert.equal(nonTargetMarketEvidence(entry('bank.com.mm',{screeningText:'Foreign currency accounts in USD and EUR for companies.'})).country,'MM');
 assert.equal(nonTargetMarketEvidence(entry('bank.com.br',{screeningText:'Open business accounts with a German IBAN and SEPA transfers.'})),null);
});
test('pure crypto wallets are suppressed from all CRM views, active AI and new raw captures',()=>{
 const e=entry('wallet.example',{title:'Crypto Wallet',screeningText:'A non-custodial Bitcoin and Ethereum wallet. Store private keys and send USDT on Solana.'});assert.equal(pureCryptoWallet(e),true);assert.equal(screenCandidate(e).eligible,false);
 const store=memoryStore(now);store.state.findings.push(e);assert.equal(crmRows(store.state).length,0);assert.equal(groupedCandidates(store.state).length,0);assert.equal(crmExport(store.state,{status:'auto_excluded'}).length,0);assert.equal(dueReviews(store.state,'offline').length,0);
 storeInbox(store.state,[inboxEntry(e,'play',now)]);assert.equal(store.state.ai.inbox.length,0);assert.equal(store.state.findings.length,1,'historical storage is not destructively deleted');
});
test('crypto services issuing business fiat IBANs remain candidates and do not become confirmed on name alone',()=>{
 const e=entry('newprovider.eu',{title:'New crypto account',screeningText:text+' A crypto wallet with a fiat account through a licensed EMI partner.'});assert.equal(pureCryptoWallet(e),false);assert.equal(screenCandidate(e).eligible,true);
 const store=memoryStore(now);store.state.findings.push(e);assert.equal(crmRows(store.state)[0].status,'review');assert.equal(dueReviews(store.state,'offline').length,1);
});
test('a standalone wallet is neither saved nor expanded through a real monitor run',async()=>{
 const store=memoryStore(now),wallet=entry('wallet.example',{title:'Bitcoin Wallet',description:'A non-custodial Bitcoin wallet with private keys and USDC transfers.',genreId:'FINANCE',free:true,price:0,minInstalls:100,released:'2026-10-01'});let expanded=0;
 const monitor=createMonitor({store,delay:0,clock:()=>now,provider:{search:async()=>[wallet],app:async()=>wallet,related:async()=>{expanded++;return[];}}});
 await monitor.startJob({...store.state.schedule.filters,keywords:['business IBAN'],countries:['DE'],seedApps:[],referenceDiscovery:false,useWebIndex:false,ignoreReleaseDate:true,related:false,developerExpansion:false});await monitor.idle();assert.equal(store.state.findings.length,0);assert.equal(store.state.ai.inbox.length,0);assert.equal(store.state.reviewCandidates.length,0);assert.equal(expanded,0);await monitor.stop();
});
test('wallet or blocked country discovered on the website is remembered without an AI call or another review loop',async()=>{
 for(const [body,pure]of [
  ['A non-custodial crypto wallet. Keep private keys and Bitcoin on your device.',true],
  ['Acme is headquartered in Hong Kong. We provide business accounts with a German IBAN.',false]
 ]){
  const store=memoryStore(now);store.state.findings.push(entry('acme.com',{title:'Acme',screeningText:'A new financial service for business accounts.'}));store.state.ai.config.includeKnown=true;let calls=0;
  const review=createAIReview({store,clock:()=>now,provider:{configured:()=>true,model:'offline-test',assess:async()=>{calls++;throw new Error('AI must not be called');}},pages:{page:async url=>({url,body:'',text:body})}});
  await review.startJob();await review.idle();assert.equal(calls,0);assert.equal(dueReviews(store.state,'offline-test').length,0);assert.equal(review.results().length,0);assert.equal(store.state.ai.results[0].analysisMethod,'pre_ai_screen');assert.equal(store.state.ai.results[0].usage.inputTokens,0);
  const source=createMonitor({store,provider:{},clock:()=>now});assert.deepEqual(source.findings({all:true}),[]);assert.deepEqual(source.visibleJob({status:'complete',results:store.state.findings,existingResults:store.state.findings,reviewCandidates:store.state.findings}).results,[]);await source.stop();
  if(pure)assert.deepEqual(crmRows(store.state),[]);else assert.equal(crmRows(store.state)[0].marketEvidence.country,'HK');
  await review.stop();
 }
});
test('historical job exports cannot bypass wallet suppression with all=1',async t=>{
 const store=memoryStore(now),wallet=entry('wallet.example',{title:'Crypto Wallet',screeningText:'Non-custodial Bitcoin wallet. Store private keys and send USDT.'});store.state.findings=[wallet];
 store.state.jobs=[{id:'abcd-1234',status:'complete',config:structuredClone(store.state.schedule.filters),createdAt:now.toISOString(),results:[wallet],existingResults:[],reviewCandidates:[]}];
 const server=createApp({store});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/api/findings?all=1','/api/candidates','/api/companies','/api/ai/results'])assert.deepEqual(await(await fetch(base+path)).json(),[],path);
 const job=await(await fetch(base+'/api/jobs/abcd-1234')).json();assert.deepEqual(job.results,[]);
 const csv=await fetch(base+'/api/jobs/abcd-1234/export.csv?all=1');assert.equal(csv.status,200);assert.doesNotMatch(await csv.text(),/Crypto Wallet|co\.acme\.app/);
});
test('real rejected utility quotes for four banks are downgraded without inventing EU IBAN proof',async()=>{
 const cases=JSON.parse(await readFile(new URL('./fixtures/utility-quotes-2026-10-29.json',import.meta.url),'utf8'));
 for(const c of cases){assert.equal(utilityQuoteSupported(c.wrongUtilityQuote),false,c.title);const f={status:'yes',evidence:[{sourceId:'s1',quote:c.wrongUtilityQuote}]};const answer=validateAssessment({utility:f,summaryRu:'Это утилита.'},[{id:'s1',url:c.url,kind:c.kind,text:c.text}]);assert.equal(answer.facts.utility.status,'unknown',c.title);assert.notEqual(answer.decision,'irrelevant',c.title);assert.notEqual(answer.facts.euIban.status,'yes');assert.match(answer.factReasons.utility,/не доказывает/);}
 const fake={facts:{utility:{status:'yes',evidence:[{kind:'official_page',url:'https://bank.eu/',quote:'Do you like Air Bank?'}]}}};assert.equal(verifiedDecision(fake),'review');
 assert.equal(utilityQuoteSupported('An IBAN checker and validator.'),true);assert.equal(utilityQuoteSupported('Expense and income tracker with shared budgets.'),true);
});
test('licence changes for a payment provider remain leads while a licence by itself does not prove EU IBAN',()=>{
 const text='Photon Dance Fintech UK Limited is authorised as an Electronic Money Institution for the issuing of electronic money and provision of payment services.';
 const e={title:'Payment platform for businesses',url:'https://provider.com/uk',documents:[{url:'https://provider.com/uk',kind:'official_page',text}]};assert.equal(screenCandidate(e).eligible,true);
 assert.equal(screenCandidate({...e,developerCountry:'HK'}).eligible,false);const result=validateAssessment({},e.documents.map(d=>({...d,id:'s1'})));assert.equal(result.facts.euIban.status,'unknown');
});
test('primary QR, budget, parking and remittance tools stay excluded after rejecting unsupported AI utility claims',()=>{
 const cases=[
  ['Payment QR Generataor IBAN','Transform banking information into a QR code. Quickly convert your IBAN and BIC into a scanable code. Service Providers & Freelancers.','iban_utility'],
  ['Yabi Money','Smart Budgeting. Automatic expense tracking from your bank SMS. Works with Egyptian banks and wallets.','accounting_tool'],
  ['Bmove','An application that allows you to pay for parking. Open an account as a legal entity to allow parking payments.','unrelated_product'],
  ['Supersonicz Money Transfer','Send money around the globe. Instant Cash Pickup. Committed to support the emigrant communities.','retail_remittance'],
  ['YNAB','Securely link financial accounts to automatically import transactions. YNAB is an agent of Plaid Financial Ltd., an authorised payment institution. Plaid provides regulated account information services.','linked_accounts']
 ];
 for(const [title,text,kind]of cases){const result=screenCandidate({title,url:'https://provider.example/',documents:[{url:'https://provider.example/',kind:'official_page',text}]});assert.equal(result.eligible,false,title);assert.equal(result.kind,kind,title);}
});
test('focused migration preserves manual decisions, models and schedules and adds RO/SK/SI once',async t=>{
 const store=memoryStore(now);store.state.schedule.filters.keywords=[...DISCOVERY_KEYWORDS,'my custom IBAN query'];store.state.schedule.filters.countries=['DE'];store.state.ai.config.engine='ollama';store.state.ai.config.ollamaModel='qwen2.5:7b';store.state.schedule.enabled=true;store.state.manualExclusions.push({key:'keep',kind:'domain',value:'blocked.eu',reason:'worked'});store.state.crm.records['company:keep.eu']={notes:'Сохранить комментарий'};const old=structuredClone(store.state.schedule.filters);
 assert.equal(tuneFocusedSearch(store.state,now),true);assert.deepEqual(store.state.searchTuningBackup.play,old);assert.ok(store.state.schedule.filters.keywords.includes('my custom IBAN query'));assert.ok(!store.state.schedule.filters.keywords.includes('embedded banking'));assert.ok(['RO','SK','SI'].every(c=>store.state.schedule.filters.countries.includes(c)));assert.equal(store.state.schedule.enabled,true);assert.equal(store.state.ai.config.ollamaModel,'qwen2.5:7b');assert.equal(store.state.manualExclusions[0].key,'keep');assert.equal(tuneFocusedSearch(store.state,now),false);
 const dir=await mkdtemp(join(tmpdir(),'focus-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json');await writeFile(path,JSON.stringify(store.state));const reopened=await openStore(path,now);assert.equal(reopened.state.manualExclusions[0].key,'keep');assert.equal(reopened.state.crm.records['company:keep.eu'].notes,'Сохранить комментарий');assert.equal(reopened.state.ai.config.ollamaModel,'qwen2.5:7b');
});
test('upgrade repairs saved and cached unsupported utility assertions offline while preserving manual exclusions',async t=>{
 const c=JSON.parse(await readFile(new URL('./fixtures/utility-quotes-2026-10-29.json',import.meta.url),'utf8'))[0],store=memoryStore(now);
 store.state.findings.push(entry('airbank.cz',{title:c.title,screeningText:c.text}));store.state.ai.validationPolicyVersion=3;store.state.ai.config.includeKnown=true;
 const g=groupedCandidates(store.state,{includeExcluded:true,allSources:true})[0],result={id:g.id,title:c.title,url:g.url,developerWebsite:g.developerWebsite,inputHash:g.inputHash,model:'saved-local-model',checkedAt:now.toISOString(),sourceDocuments:g.documents,facts:{utility:{status:'yes',evidence:[{url:g.url,kind:'listing',quote:c.wrongUtilityQuote}]}},decision:'irrelevant'};
 store.state.ai.results=[structuredClone(result)];const key=reviewCacheKey(result.id,result.inputHash,result.model);store.state.ai.reviewCache={[key]:structuredClone(result)};
 store.state.findings.push(entry('manual.eu',{appId:'co.manual.app',title:'Manual bank'}));store.state.manualExclusions=[{key:'manual-rule',kind:'domain',value:'manual.eu',reason:'worked',createdAt:now.toISOString()}];const manual=structuredClone(store.state.manualExclusions);
 const dir=await mkdtemp(join(tmpdir(),'policy-repair-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json');await writeFile(path,JSON.stringify(store.state));const reopened=await openStore(path,now);
 assert.equal(reopened.state.ai.validationPolicyVersion,VALIDATION_POLICY_VERSION);assert.equal(reopened.state.ai.lastRepair.apiCalls,0);assert.equal(reopened.state.ai.results[0].facts.utility.status,'unknown');assert.notEqual(reopened.state.ai.results[0].decision,'irrelevant');assert.equal(reopened.state.ai.reviewCache[key].facts.utility.status,'unknown');assert.deepEqual(reopened.state.manualExclusions,manual);assert.equal(reopened.state.ai.results[0].model,'saved-local-model');
});
test('jurisdiction policy is global, audited and protected from viewer and cross-site writes',async t=>{
 const store=memoryStore(now);store.state.findings.push(entry('acme.ru'));const server=createApp({store,password:'owner',viewerPassword:'reader'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port;
 const headers=who=>({Authorization:'Basic '+Buffer.from(who).toString('base64'),'Content-Type':'application/json'}),body=JSON.stringify({marketScope:'eu_business',blockedJurisdictions:DEFAULT_BLOCKED_JURISDICTIONS});
 assert.equal((await fetch(base+'/api/crm/market-policy',{method:'POST',headers:headers('viewer:reader'),body})).status,403);assert.equal((await fetch(base+'/api/crm/market-policy',{method:'POST',headers:{...headers('admin:owner'),'Sec-Fetch-Site':'cross-site'},body})).status,403);assert.equal((await fetch(base+'/api/crm/market-policy',{method:'POST',headers:headers('admin:owner'),body})).status,200);
 const data=await(await fetch(base+'/api/crm',{headers:headers('admin:owner')})).json();assert.equal(data.rows[0].status,'auto_excluded');assert.equal(data.rows[0].marketEvidence.country,'RU');const report=await(await fetch(base+'/api/crm/auto-exclusions.json',{headers:headers('admin:owner')})).json();assert.equal(report.records[0].audit.reasons[0].stage,'market_rule');assert.ok(report.metadata.settings.marketPolicy.blockedJurisdictions.includes('UA'));
});
