import test from 'node:test';import assert from 'node:assert/strict';
import{memoryStore}from'../lib/store.js';import{resetForReview}from'../lib/review-cycle.js';import{groupedCandidates}from'../lib/neural-inbox.js';import{validateAssessment,createAIReview}from'../lib/ai-review.js';import{crmRows,crmExport,crmCSV,editCRM,bulkCRM,chatPacket}from'../lib/crm.js';import{createApp,shutdownApp}from'../server.js';
const reset=new Date('2026-10-30T09:00:00Z'),checked=new Date('2026-10-30T10:00:00Z'),later=new Date('2026-10-30T11:00:00Z');
const good='We offer business accounts to companies. We provide business accounts with a dedicated German IBAN and SEPA transfers.';
const empty={status:'unknown',evidence:[]},fact=(status,quote)=>({status,evidence:[{sourceId:'s1',quote}]});
function fixture(text=good,host='routing.eu'){
 const store=memoryStore(reset);store.state.findings.push({appId:'co.routing.app',title:'Routing Provider',url:'https://play.google.com/store/apps/details?id=co.routing.app',developerWebsite:'https://'+host+'/',screeningText:text,firstFoundAt:'2026-10-01T00:00:00Z'});resetForReview(store.state,{now:reset});return{store,id:'company:'+host};
}
function assessed(f,text,raw={},options={}){
 const entry=groupedCandidates(f.store.state,{includeExcluded:true,allSources:true})[0],document={id:'s1',url:entry.developerWebsite,text,kind:options.kind??'official_page'},assessment=validateAssessment({business:empty,account:empty,euIban:empty,utility:empty,summaryRu:'Проверка условий.',...raw},[document]);
 const result={...assessment,id:f.id,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite,sourceDocuments:[document],model:'offline',engine:'openai',analysisMethod:'ai',version:2,policyVersion:4,inputHash:entry.inputHash,checkedAt:checked.toISOString(),...options};f.store.state.ai.results=[result];return result;
}
const row=f=>crmRows(f.store.state).find(r=>r.id===f.id);

test('reviewed manual queue routes strong matches, explicit tools and unresolved cases without creating manual approval',()=>{
 const yes=fixture();assessed(yes,good);assert.equal(row(yes).status,'confirmed');assert.equal(row(yes).needsManualReview,false);assert.equal(row(yes).approval,null);assert.equal(crmExport(yes.store.state,{status:'review'}).length,0);assert.equal(crmExport(yes.store.state,{status:'confirmed'}).length,1);
 const no=fixture('IBAN checker and validator. This tool validates existing IBAN numbers.');assessed(no,'IBAN checker and validator. This tool validates existing IBAN numbers.',{utility:fact('yes','This tool validates existing IBAN numbers.')});assert.equal(row(no).status,'auto_excluded');assert.ok(row(no).autoExclusion);assert.equal(crmExport(no.store.state,{status:'active'}).length,0);assert.equal(crmExport(no.store.state,{status:'auto_excluded'}).length,1);
 const maybe=fixture('We offer payment services.');assessed(maybe,'We offer payment services.');assert.equal(row(maybe).status,'review');assert.equal(crmExport(maybe.store.state,{status:'review'}).length,1);
});

test('a missing/unavailable site, unverified model labels, stale or old analysis never remove a restored card',()=>{
 for(const options of[{checkedAt:'2026-10-29T08:00:00Z'},{inputHash:'changed'},{analysisMethod:'pre_ai_screen'},{policyVersion:3},{sourceDocuments:[]},{sourceErrors:['Публичный сайт не прочитан; используются доступные описания и индекс.']}]){
  const f=fixture('An IBAN checker.');assessed(f,'An IBAN checker.',{utility:fact('yes','An IBAN checker.')},options);assert.equal(row(f).status,'review',JSON.stringify(options));
 }
 const f=fixture();assessed(f,good,{business:empty,account:empty,euIban:empty,utility:fact('yes','Ordinary features: balances and transfers.')});assert.equal(row(f).status,'review');
 const news=fixture('IBAN checker information.');assessed(news,'An IBAN checker.',{utility:fact('yes','An IBAN checker.')},{kind:'third_party'});assert.equal(row(news).status,'review');
});

test('crypto-only wallets are removed, fiat providers/partners and ambiguous account products stay available',()=>{
 const crypto=fixture('A non-custodial Bitcoin wallet. Store private keys and send USDT.');assessed(crypto,'A non-custodial Bitcoin wallet. Store private keys and send USDT.');assert.equal(row(crypto).status,'auto_excluded');
 const hybrid=fixture();assessed(hybrid,good+' Convert USDT. Accounts are provided through a licensed EMI partner.');assert.equal(row(hybrid).status,'confirmed');
 const platform=fixture('We offer business accounts. Expense reports and budgeting are included.');assessed(platform,'We offer business accounts. Expense reports and budgeting are included.',{utility:fact('yes','Expense reports and budgeting are included.')});assert.equal(row(platform).status,'review');
 const bank=fixture();assessed(bank,good+' Our website has an IBAN checker.',{utility:fact('yes','Our website has an IBAN checker.')});assert.equal(row(bank).status,'review');
});

test('only explicit unconditional negative criteria cause exclusion; non-bank partnerships and regional restrictions do not',()=>{
 const personal=fixture();assessed(personal,'We do not offer business accounts.',{business:fact('no','We do not offer business accounts.')});assert.equal(row(personal).status,'auto_excluded');
 const nonEU=fixture();assessed(nonEU,'Business accounts receive only GB IBANs.',{business:fact('yes','Business accounts receive only GB IBANs.'),account:fact('yes','Business accounts receive only GB IBANs.'),euIban:fact('no','Business accounts receive only GB IBANs.')});assert.equal(row(nonEU).status,'auto_excluded');
 for(const quote of['Business accounts are not available for US residents.','We are not a bank.','We do not provide accounts directly; our EMI partner provides business accounts.']){const f=fixture();assessed(f,quote,{business:fact('no',quote),account:fact('no',quote)});assert.equal(row(f).status,'review',quote);}
 const unclear=fixture();assessed(unclear,'GBP accounts are available.',{euIban:fact('no','GBP accounts are available.')});assert.equal(row(unclear).status,'review');
});

test('excluded provider jurisdiction wins, while foreign customers and missing European information do not',()=>{
 const china=fixture(good,'bank.cn');assessed(china,good);assert.equal(row(china).status,'auto_excluded');
 const clients=fixture();assessed(clients,good+' We welcome Chinese customers and payments to China.');assert.equal(row(clients).status,'confirmed');
 const us=fixture('Open a business account in USD. FDIC insured.','bank.us');assessed(us,'Open a business account in USD. FDIC insured.');assert.equal(row(us).status,'review');
});

test('waitlists, future business products, shared IBANs and unsupported licence-only evidence remain for human review',()=>{
 for(const [text,raw]of[[good,{availability:{status:'waitlist',evidence:[{sourceId:'s1',quote:good}]}}],['We will provide business accounts with a German IBAN.',{}],[good+' Join our waitlist for business accounts.',{}],['Business accounts use only a shared IBAN for deposits.',{}]]){const f=fixture(text);assessed(f,text,raw);assert.equal(row(f).status,'review',text);}
 const licence=fixture();assessed(licence,'Licensed EMI, business accounts are planned.',{}, {sourceDocuments:[{id:'s1',url:'https://www.lb.lt/en/',kind:'official_page',text:'Licensed EMI, business accounts are planned.'}]});assert.equal(row(licence).status,'review');
});

test('manual approvals, selections, watch and exclusions are preserved; returning automatic exclusions to review persists',()=>{
 for(const status of['approved','selected','watch']){const f=fixture('An IBAN checker.');assessed(f,'An IBAN checker.');editCRM(f.store.state,{id:f.id,status,notes:'Сохранить'},later);assert.equal(row(f).status,status);assert.equal(row(f).notes,'Сохранить');}
 const original=fixture('An IBAN checker.');original.store.state.crm.records={};original.store.state.crm.reviewCycle=null;assert.equal(row(original).status,'auto_excluded');editCRM(original.store.state,{id:original.id,status:'review'},later);assert.equal(row(original).status,'review');
 const f=fixture('An IBAN checker.');assessed(f,'An IBAN checker.');assert.equal(row(f).status,'auto_excluded');bulkCRM(f.store.state,{ids:[f.id],action:'status',status:'review'},later);assert.equal(row(f).status,'review');assert.equal(row(f).reviewRouting.reason,'Вы вернули запись на ручную проверку после этого разбора.');
 f.store.state.ai.results[0].checkedAt='2026-10-30T12:00:00Z';assert.equal(row(f).status,'auto_excluded');bulkCRM(f.store.state,{ids:[f.id],action:'exclude',reason:'worked'},later);assert.equal(row(f).status,'excluded');assert.equal(row(f).worked,true);
});

test('classification is offline, leaves records/cache intact and is reflected in CSV, JSON and live API',async t=>{
 const f=fixture('An IBAN checker.');assessed(f,'An IBAN checker.');const before=JSON.stringify(f.store.state);const r=row(f);assert.equal(r.status,'auto_excluded');assert.equal(JSON.stringify(f.store.state),before);assert.ok(crmCSV([r]).includes(r.reviewRouting.reason));assert.equal(chatPacket([r]).records[0].reviewRouting.status,'auto_excluded');
 let calls=0;const server=createApp({store:f.store,clock:()=>checked,socialProvider:{configured:()=>false},aiProvider:{configured:()=>true,model:'offline',assess:async()=>{calls++;throw Error('must not run');}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,data=await(await fetch(base+'/api/crm')).json();assert.equal(data.manualReview.count,0);assert.equal(data.counts.auto_excluded,1);assert.equal(calls,0);
 const returned=await fetch(base+'/api/crm/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:f.id,status:'review'})});assert.equal(returned.status,200);assert.equal((await(await fetch(base+'/api/crm')).json()).manualReview.count,1);assert.equal(calls,0);
});


test('manual checks outside the restored cycle use the same routing and old 4.5 manual jobs are recognised',()=>{
 for(const useHistory of[false,true]){const f=fixture();f.store.state.crm.records={};f.store.state.crm.reviewCycle=null;assessed(f,good,useHistory?{}:{},{reviewScope:useHistory?undefined:'manual'});if(useHistory)f.store.state.ai.jobs=[{id:'manual-old',scope:'manual',status:'complete',results:[f.id]}];assert.equal(row(f).status,'confirmed');}
});
