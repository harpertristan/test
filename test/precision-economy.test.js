import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {memoryStore,openStore} from '../lib/store.js';
import {effectiveExclusions,manuallyExcluded,canonicalFindingURL} from '../lib/manual-exclusions.js';
import {groupedCandidates,inboxEntry,storeInbox} from '../lib/neural-inbox.js';
import {crmRows,crmExport,excludeCRM,restoreCRM,editCRM} from '../lib/crm.js';
import {screenCandidate} from '../lib/screening.js';
import {createAIReview,reviewDocuments,dueReviews} from '../lib/ai-review.js';
import {openaiProvider} from '../lib/openai-provider.js';
import {ollamaProvider,reviewRouter} from '../lib/ollama-provider.js';
import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-26T10:00:00Z');
const text='Acme offers business accounts for companies. Open a business account with a German IBAN. Our web dashboard is available.';
const bank={appId:'com.precise.bank',title:'Acme Business Bank',developerWebsite:'https://acme.example.eu/',screeningText:text,url:'https://play.google.com/store/apps/details?id=com.precise.bank&gl=DE',firstFoundAt:now.toISOString()};
const fact=(status,quote,sourceId='s1')=>({status,evidence:quote?[{sourceId,quote}]:[]});
const answer=documents=>{const d=documents.find(d=>d.text.includes('Open a business account'))??documents[0];return {business:fact('yes','Acme offers business accounts for companies.',d.id),account:fact('yes','Open a business account with a German IBAN.',d.id),euIban:fact('yes','Open a business account with a German IBAN.',d.id),utility:fact('unknown'),service:{name:'Acme',evidence:[]},summaryRu:'Есть предложение бизнес-счёта и заявление о немецком IBAN.',translations:[],licences:[]};};
const add=()=>{const s=memoryStore(now);s.state.findings.push({...bank});return s;};
const aiFixture=(store,patch={})=>createAIReview({store,clock:()=>now,pages:{page:async()=>{throw Error('offline');}},provider:{configured:()=>true,model:'fixture',assess:async({documents})=>({assessment:answer(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}})},...patch});

test('Play language/country variants and Apple storefront slugs share a stable exclusion identity',()=>{
 assert.equal(canonicalFindingURL('http://play.google.com/store/apps/details?id=com.precise.bank&hl=ru&gl=AT'),canonicalFindingURL(bank.url));
 const rules=[{key:'one',kind:'url',value:bank.url}];assert.ok(manuallyExcluded({url:'https://play.google.com/store/apps/details?hl=en&gl=ES&id=com.precise.bank'},rules));assert.ok(!manuallyExcluded({url:'https://play.google.com/store/apps/details?id=com.other.bank'},rules));
 assert.ok(manuallyExcluded({url:'https://apps.apple.com/fr/app/name/id123456?l=fr'},[{kind:'app',value:'apple:123456'}]));
});
test('legacy app-only exclusion suppresses the provider website, iOS app, saved raw snapshots and the AI queue',()=>{
 const s=add().state;s.web.findings.push({id:'web:acme',title:'Acme web',url:'https://acme.example.eu/business',snippet:text});s.apple.findings.push({id:'apple:123456',appId:'apple:123456',developerWebsite:bank.developerWebsite,url:'https://apps.apple.com/de/app/acme/id123456',title:'Acme iOS',screeningText:text});s.manualExclusions.push({key:'legacy',kind:'app',value:bank.appId,title:bank.title});
 storeInbox(s,[inboxEntry({...bank,url:bank.url+'&hl=ru'},'watch',now)]);const rules=effectiveExclusions(s);assert.ok(rules[0].domains.includes('acme.example.eu'));assert.ok(rules[0].appIds.includes('apple:123456'));assert.equal(groupedCandidates(s).length,0);assert.equal(dueReviews(s,'fixture',now).length,0);assert.equal(crmExport(s,{status:'all'}).length,0);assert.ok(crmRows(s).every(r=>r.status==='excluded'));assert.equal(s.ai.inbox.length,0);
});
test('excluding a provider URL blocks other paths/subdomains while excluding an article leaves other publisher posts intact',()=>{
 const s=add().state;s.manualExclusions.push({key:'site',kind:'url',value:'https://www.acme.example.eu/business'});const rules=effectiveExclusions(s);assert.ok(manuallyExcluded({url:'https://app.acme.example.eu/signup'},rules));assert.ok(manuallyExcluded(bank,rules));
 const article={url:'https://finextra.com/newsarticle/1/acme',title:'Acme launch',screeningText:text};s.manualExclusions=[{key:'article',kind:'url',value:article.url}];s.ai.inbox.push(inboxEntry(article,'social',now));const limited=effectiveExclusions(s);assert.ok(manuallyExcluded(article,limited));assert.ok(!manuallyExcluded({url:'https://finextra.com/newsarticle/2/other'},limited));assert.ok(!manuallyExcluded(bank,limited));
});
test('manual rejected status also blocks analysis and restores without losing notes',()=>{
 const s=add().state,id=crmRows(s)[0].id;editCRM(s,{id,status:'rejected',notes:'Проверено мной: не подходит'});assert.equal(groupedCandidates(s).length,0);assert.equal(crmExport(s,{status:'all'}).length,0);assert.equal(crmRows(s)[0].status,'excluded');restoreCRM(s,id);assert.equal(crmRows(s)[0].status,'review');assert.equal(crmRows(s)[0].notes,'Проверено мной: не подходит');
});
test('restoring a project clears linked identities but keeps its historical data',()=>{
 const s=add().state;s.manualExclusions.push({key:'legacy',kind:'app',value:bank.appId});const row=crmRows(s)[0];restoreCRM(s,row.id);assert.equal(s.findings.length,1);assert.equal(groupedCandidates(s).length,1);assert.equal(s.manualExclusions.length,0);
});
test('IBAN utilities, task planners, local-only payments and crypto-only wallets are filtered before any AI request',()=>{
 for(const [title,text]of [['IBAN Checker','Check and validate IBAN and BIC numbers for business payments.'],['Business Wallet','Store credentials and digital company identity documents.'],['Business account manager','Organize passwords and social media logins.'],['Wallet','Non-custodial crypto wallet for bitcoin and ethereum.'],['Budget tracker','Record income and expenses and connect your existing bank accounts.']])assert.equal(screenCandidate({title,screeningText:text}).eligible,false,title);
 assert.equal(screenCandidate(bank).eligible,true);assert.equal(screenCandidate({title:'New neobank',screeningText:'Join our waitlist for business accounts with EUR and SEPA.'}).eligible,true);
});
test('all four user-provided real examples survive screening',async()=>{
 const files=await import('node:fs/promises');const fixtures=JSON.parse(await files.readFile(new URL('./fixtures/play-precision.json',import.meta.url),'utf8')).apps;
 for(const id of ['co.tide.tideplatform.eu','com.bankera.wallet','it.hype.business','com.wamo.business']){const card=fixtures.find(e=>e.appId===id);assert.ok(card,'Real card fixture must exist: '+id);assert.equal(screenCandidate({...card,screeningText:card.description}).eligible,true,id);}
});
test('compact context retains positive and negative IBAN claims within 6000 characters',()=>{
 const long='A general marketing sentence. '.repeat(1500)+' We do not offer business IBAN accounts yet. '+text;
 const docs=[{id:'s1',url:bank.developerWebsite,kind:'official_page',text:long},{id:'s2',url:bank.url,kind:'listing',text:long}];const compact=reviewDocuments(docs);assert.ok(compact.reduce((n,d)=>n+d.text.length,0)<=6000);assert.match(compact[0].text,/do not offer business IBAN/);assert.match(compact[0].text,/German IBAN/);assert.ok(reviewDocuments(docs,'full').reduce((n,d)=>n+d.text.length,0)>compact.reduce((n,d)=>n+d.text.length,0));
});
test('unchanged uncertain results are not billed again simply because a day passed',async()=>{
 const s=add(),a=aiFixture(s);await a.startJob();await a.idle();const later=new Date(+now+30*86400000);assert.equal(dueReviews(s.state,'fixture',later).length,0);s.state.findings[0].screeningText+=' We have changed our terms.';assert.equal(dueReviews(s.state,'fixture',later).length,1);
});
test('a manual exclusion made during website loading prevents paid dispatch entirely',async()=>{
 const s=add();let release,entered,calls=0;const ready=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);const a=aiFixture(s,{pages:{page:async url=>{entered();await waiting;return{url,text,body:''};}},provider:{configured:()=>true,model:'fixture',assess:async()=>{calls++;throw Error('should not call');}}});await a.startJob();await ready;await s.update(d=>excludeCRM(d,crmRows(d)[0].id,now));release();await a.idle();assert.equal(calls,0);assert.equal(a.results().length,0);assert.equal(a.summary().usage.attempts,0);
});
test('a manual exclusion made during an in-flight AI response prevents reinsertion after reply',async()=>{
 const s=add();let release,entered;const ready=new Promise(r=>entered=r);const a=aiFixture(s,{provider:{configured:()=>true,model:'fixture',assess:async({documents})=>{entered();await new Promise(r=>release=r);return{assessment:answer(documents),model:'fixture',usage:{inputTokens:10,outputTokens:10}};}}});await a.startJob();await ready;await s.update(d=>excludeCRM(d,crmRows(d)[0].id,now));release();await a.idle();assert.equal(a.results().length,0);assert.equal(s.state.ai.results.length,0);assert.equal(crmExport(s.state,{status:'all'}).length,0);assert.equal(a.summary().usage.attempts,1);
});
test('paid calls skip unqualified utilities even when their IDs are explicitly submitted',async()=>{
 const s=add();s.state.findings.push({...bank,appId:'com.utility.iban',title:'IBAN checker',developerWebsite:'https://checker.example.eu',url:'https://play.google.com/store/apps/details?id=com.utility.iban',screeningText:'Check IBAN and generate IBAN examples.'});const utility=crmRows(s.state).find(r=>r.title==='IBAN checker'),a=aiFixture(s);assert.equal(utility.status,'auto_excluded');await assert.rejects(a.startJob({ids:[utility.id]}),/Новых находок/);assert.equal(a.summary().usage.attempts,0);
});
test('Ollama uses schema-guided JSON, local models and separate token counters with no paid fallback',async()=>{
 const s=add();let paid=0,local=0;const ollama=ollamaProvider({request:async(path,body)=>{if(path==='/api/tags')return{models:[{name:'qwen2.5:3b'}]};local++;assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.equal(body.options.num_ctx,8192);const docs=JSON.parse(body.messages[1].content).documents.map(d=>({...d,id:d.sourceId}));return{message:{content:JSON.stringify(answer(docs))},prompt_eval_count:150,eval_count:70};}});
 const remote={model:'paid',configured:()=>true,assess:async()=>{paid++;throw Error('must never call');}},router=reviewRouter({store:s,openai:remote,ollama});const a=aiFixture(s,{provider:router});await a.saveConfig({...a.summary().config,engine:'ollama'});assert.equal((await ollama.status()).installed,true);await a.startJob();await a.idle();assert.equal(local,1);assert.equal(paid,0);assert.equal(a.results()[0].decision,'match');assert.equal(a.results()[0].engine,'ollama');assert.equal(a.summary().usage.inputTokens,150);assert.equal(a.summary().openAIUsage.attempts,0);
});
test('offline Ollama stops the local batch and never uses a configured paid key',async()=>{
 const s=add();s.state.findings.push({...bank,appId:'com.second.bank',url:'https://play.google.com/store/apps/details?id=com.second.bank',developerWebsite:'https://second.example.eu'});let paid=0,local=0;const router=reviewRouter({store:s,openai:{configured:()=>true,model:'paid',assess:async()=>{paid++;}},ollama:ollamaProvider({request:async()=>{local++;throw Object.assign(new Error('offline'),{code:'LOCAL_OFFLINE'});}})}),a=aiFixture(s,{provider:router});await a.saveConfig({...a.summary().config,engine:'ollama'});await a.startJob();await a.idle();assert.equal(local,1);assert.equal(paid,0);assert.equal(a.summary().usage.attempts,1);assert.equal(a.summary().openAIUsage.attempts,0);assert.equal(s.state.ai.jobs.at(-1).status,'failed');
});
test('invalid local JSON never becomes an unsupported bank match',async()=>{
 const local=ollamaProvider({request:async()=>({message:{content:'not JSON'}})});await assert.rejects(local.assess({title:'Example',documents:[]}),{code:'LOCAL_RESPONSE'});
});
test('OpenAI economy mode reduces response allowance and passes mode without exposing its API key',async()=>{
 const seen=[],p=openaiProvider({key:'test-secret',request:async body=>{seen.push(body);return{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer([{id:'s1',text}]))}]}]};}});for(const mode of ['economy','full'])await p.assess({title:'Example',documents:[{id:'s1',text,url:bank.url}],mode});assert.equal(seen[0].max_output_tokens,4000);assert.equal(seen[1].max_output_tokens,16000);assert.ok(!JSON.stringify(seen).includes('test-secret'));assert.equal(JSON.parse(seen[0].input[1].content).mode,'economy');
});
test('local endpoint and model choice retain authentication and cross-site protections',async t=>{
 const s=add(),server=createApp({store:s,password:'private',localAIProvider:ollamaProvider({request:async()=>({models:[{name:'qwen2.5:3b'}]})})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Basic '+Buffer.from('admin:private').toString('base64'),'Content-Type':'application/json'};assert.equal((await fetch(base+'/api/ai/local/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal((await fetch(base+'/api/ai/local/test',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);const r=await fetch(base+'/api/ai/local/test',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);assert.equal((await r.json()).installed,true);
});
test('local engine, economy settings, usage and original manual exclusions survive migration',async t=>{
 const s=add();s.state.ai.config.engine='ollama';s.state.ai.localUsage={'2026-10':{attempts:2,inputTokens:10,outputTokens:20}};s.state.manualExclusions.push({key:'legacy',kind:'app',value:bank.appId});const dir=await mkdtemp(join(tmpdir(),'scout-economy-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');await writeFile(file,JSON.stringify(s.state));const reloaded=await openStore(file,now);assert.equal(reloaded.state.ai.config.engine,'ollama');assert.equal(reloaded.state.ai.config.mode,'economy');assert.equal(reloaded.state.ai.localUsage['2026-10'].attempts,2);assert.equal(reloaded.state.manualExclusions.length,1);assert.equal(groupedCandidates(reloaded.state).length,0);
});

test('generic bank comparisons and opinion articles do not consume AI while concrete launches remain leads',()=>{
 assert.equal(screenCandidate({title:'Best business accounts with IBAN in Europe',snippet:'Compare banks and choose a corporate account with SEPA payments.'}).eligible,false);
 assert.equal(screenCandidate({title:'How to choose an IBAN for your business',snippet:'An opinion on European business banking.'}).eligible,false);
 assert.equal(screenCandidate({title:'Acme launches corporate accounts',snippet:'Companies can open a business account with EUR IBAN and SEPA payments.'}).eligible,true);
});

test('switching local/paid engines reuses their saved verdicts without buying the same analysis again',async()=>{
 const s=add();let paid=0,local=0;const router=reviewRouter({store:s,openai:{model:'paid',configured:()=>true,assess:async({documents})=>{paid++;return{assessment:answer(documents),model:'paid',usage:{inputTokens:1,outputTokens:1}};}},ollama:ollamaProvider({request:async(_path,body)=>{local++;const documents=JSON.parse(body.messages[1].content).documents.map(d=>({...d,id:d.sourceId}));return{message:{content:JSON.stringify(answer(documents))}};}})}),a=aiFixture(s,{provider:router});await a.startJob();await a.idle();await a.saveConfig({...a.summary().config,engine:'ollama'});await a.startJob();await a.idle();await a.saveConfig({...a.summary().config,engine:'openai'});assert.equal(a.summary().due,0);assert.equal(a.results()[0].model,'paid');assert.equal(paid,1);assert.equal(local,1);await assert.rejects(a.startJob(),/Новых находок/);
});

test('upgrade preserves the cache for unchanged v3 source snapshots instead of rebilling them',async t=>{
 const {createHash}=await import('node:crypto');const s=add().state,g=groupedCandidates(s)[0];const old=createHash('sha256').update(JSON.stringify([g.title,g.documents.map(d=>[d.url,d.text]),g.updatedAt,g.developerWebsite])).digest('hex');s.ai.results.push({id:g.id,inputHash:old,model:'fixture',version:2,decision:'review',facts:{},checkedAt:now.toISOString()});const dir=await mkdtemp(join(tmpdir(),'scout-cache-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');await writeFile(file,JSON.stringify(s));const reloaded=await openStore(file,now);assert.equal(dueReviews(reloaded.state,'fixture',new Date(+now+86400000)).length,0);assert.equal(reloaded.state.ai.results[0].inputHash,groupedCandidates(reloaded.state)[0].inputHash);
});

test('QR transfer tools, record organizers and self-custody stablecoin wallets are not account providers',()=>{
 const samples=[{title:'Euvena',screeningText:'Euvena turns a SEPA credit transfer into a QR code and back. The code says the IBAN and amount. Euvena has no accounts and no backend. It never holds or moves money. Every payment is made in your own banking app.'},{title:'Digital Wallet Pro',screeningText:'Digital business card and profile. Keep your bank account information organized alongside your credit and debit card information.'},{title:'Zela Pay',screeningText:'A self-custody wallet for small businesses. Hold USDC and USDT on Solana. Send payments by phone number. It is a non-custodial wallet, not a bank.'}];for(const entry of samples)assert.equal(screenCandidate(entry).eligible,false,entry.title);
 const realFiat={title:'A new global banking service',screeningText:'Open global accounts in USD, GBP and EUR. Create accounts in your own name. Payments for freelancers and businesses. Also supports Ethereum and stablecoins.'};assert.equal(screenCandidate(realFiat).eligible,true);
 const business={title:'A business payment service',screeningText:'Business accounts are designed for companies, subject to KYB. Currency exchange and supported currencies. Crypto access is optional.'};assert.equal(screenCandidate(business).eligible,true);
});

test('Ollama HTTP transport speaks only to loopback and handles the real JSON protocol without API credentials',async t=>{
 const {localRequest}=await import('../lib/ollama-provider.js');let calls=0;const service=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,undefined);if(req.url==='/api/tags'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({models:[{name:'qwen2.5:3b'}]}));return;}let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);assert.equal(req.url,'/api/chat');assert.equal(input.model,'qwen2.5:3b');assert.equal(input.stream,false);calls++;const documents=JSON.parse(input.messages[1].content).documents.map(d=>({...d,id:d.sourceId}));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({message:{content:JSON.stringify(answer(documents))},prompt_eval_count:40,eval_count:30}));});await new Promise(r=>service.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>service.close(r)));const port=service.address().port,provider=ollamaProvider({request:(path,body,options)=>localRequest(path,body,{...options,port})});assert.equal((await provider.status()).installed,true);const result=await provider.assess({title:'Acme',documents:[{id:'s1',url:bank.url,text}]});assert.equal(result.usage.inputTokens,40);assert.equal(calls,1);assert.equal(result.engine,'ollama');
});

test('editing an exclusion immediately updates matching even when the same array object is reused',()=>{
 const rules=[{kind:'app',value:'com.old.app',appIds:[]}];assert.ok(manuallyExcluded({appId:'com.old.app'},rules));rules[0].value='com.new.app';assert.ok(!manuallyExcluded({appId:'com.old.app'},rules));assert.ok(manuallyExcluded({appId:'com.new.app'},rules));rules[0].appIds.push('com.alias.one');assert.ok(manuallyExcluded({appId:'com.alias.one'},rules));rules[0].appIds[0]='com.alias.two';assert.ok(!manuallyExcluded({appId:'com.alias.one'},rules));assert.ok(manuallyExcluded({appId:'com.alias.two'},rules));
});

test('first economy upgrade pauses existing paid automation but does not erase keys, findings or schedule settings',async t=>{
 const s=add().state;s.ai.config.enabled=true;s.ai.config.time='11:15';const dir=await mkdtemp(join(tmpdir(),'scout-auto-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');await writeFile(file,JSON.stringify(s));const reloaded=await openStore(file,now);assert.equal(reloaded.state.ai.config.enabled,false);assert.equal(reloaded.state.ai.pausedAfterUpgrade,true);assert.equal(reloaded.state.ai.config.time,'11:15');assert.equal(reloaded.state.findings.length,1);const a=aiFixture(reloaded);await a.saveConfig({...a.summary().config,enabled:true});assert.equal(a.summary().pausedAfterUpgrade,false);const again=await openStore(file,now);assert.equal(again.state.ai.config.enabled,true);
});
