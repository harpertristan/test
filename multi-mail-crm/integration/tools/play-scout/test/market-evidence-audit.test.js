import test from 'node:test';
import assert from 'node:assert/strict';
import {nonTargetMarketEvidence,europeanProductLead,DEFAULT_BLOCKED_JURISDICTIONS} from '../lib/market-scope.js';
import {nigeriaEvidence} from '../lib/geography.js';
import {screenCandidate} from '../lib/screening.js';
import {validateAssessment} from '../lib/ai-review.js';
import {memoryStore} from '../lib/store.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,excludeCRM} from '../lib/crm.js';
import {revalidateStoredAnalyses} from '../lib/review-repair.js';
const entry=text=>({title:'Global account provider',url:'https://provider.example.com/',developerWebsite:'https://provider.example.com/',documents:[{id:'s1',url:'https://provider.example.com/',kind:'official_page',text}]});

test('currency codes and supported currencies are not provider jurisdiction or a domestic-market claim',()=>{
 for(const text of [
  'EUR,USD, GBP, CNY, HKD, CHF, AUD, AED, CAD, NOK,',
  'We specialize in EUR,USD, GBP, CNY.',
  'Send money from: EUR (Euro), USD (US dollar), GBP (British pound), HKD (Hong Kong dollar). Send money to: CNY (Chinese yuan), SAR (Saudi riyal).',
  'Plus EUR, GBP, and AED virtual IBANs, local currency accounts in NGN, KES, BRL, and 10 more currencies.',
  'Hold NGN naira balances.'
 ]){assert.equal(nonTargetMarketEvidence(entry(text)),null,text);assert.equal(nigeriaEvidence(entry(text)),null,text);}
});

test('payment destinations and rails do not identify the international provider as Indian or Pakistani',()=>{
 for(const text of [
  'Send to mobile wallets including GCash, bKash, Pix, UPI, Maya, MoMo, Alipay, Weixin, Nequi, DaviPlata, Nagad and others.',
  'Cash Out Instantly, Zero Fees Convert to NGN in 30 seconds, KES in 12 seconds, PKR via Raast - instant, BRL via PIX in 48 seconds.'
 ])assert.equal(nonTargetMarketEvidence(entry(text)),null,text);
 assert.equal(nonTargetMarketEvidence(entry('Indian residents must provide Aadhaar and IFSC details.')).country,'IN');
 assert.equal(nonTargetMarketEvidence(entry('Pakistani residents must provide a CNIC.')).country,'PK');
});

test('a negated FDIC disclaimer and sponsor bank do not make an international provider a US-only product',()=>{
 const disclaimer='Wise is a Money Service Business registered with FinCen, not an FDIC-insured bank.';
 assert.equal(nonTargetMarketEvidence(entry(disclaimer)),null);
 assert.equal(nonTargetMarketEvidence(entry('The Wise Multi-Currency Card Program is issued by its sponsor Bank, member FDIC.')),null);
 assert.equal(nonTargetMarketEvidence(entry('US residents require a Social Security Number. FDIC insured.')).country,'US');
});

test('the actual customer-country sentence behind Genome does not locate the provider in Hong Kong',()=>{
 const text='You can quickly set up an account if your company is registered in the UK, EU/EEA countries (including Germany, Lithuania, France, and Cyprus), Canada, Australia, Singapore, Hong Kong, New Zealand, or Ukraine.';
 assert.equal(nonTargetMarketEvidence(entry(text)),null);
 assert.equal(nonTargetMarketEvidence(entry('Our company is registered in Hong Kong.')).country,'HK');
 for(const country of DEFAULT_BLOCKED_JURISDICTIONS)assert.equal(nonTargetMarketEvidence({...entry('Open business accounts with a German IBAN.'),developerCountry:country}).code,'excludedJurisdiction',country);
});

test('Nigerian clients and corridor compliance do not become Nigerian provider licensing',()=>{
 for(const text of [
  'Nigerian businesses and families both need euros: suppliers invoice in them, universities bill in them, relatives live on them.',
  "This corridor turns naira into euros in any euro-area account, converted once at the NGN to EUR figure previewed on screen, delivered by SEPA inside CBN's rules, which the app applies before you confirm rather than after.",
  'Send money to Nigeria. Hold NGN naira balances.'
 ])assert.equal(nigeriaEvidence(entry(text)),null,text);
 for(const text of ['Prospa is a fully CBN licensed and NDIC insured bank for serious businesses.','We are regulated by the Central Bank of Nigeria.','Our company is incorporated in Nigeria.'])assert.ok(nigeriaEvidence(entry(text)),text);
 assert.ok(nigeriaEvidence({...entry('International accounts.'),developerWebsite:'https://bank.ng/'}));
});

test('general IBAN definitions do not override the actual provider market',()=>{
 const text='IBAN consists of an alphabetical country code, followed by two numbers. Most European countries use IBAN account formats.';
 assert.equal(europeanProductLead(text),false);
 const bank={...entry('We provide business banking services. '+text),developerWebsite:'https://www.standardbank.co.za/'};assert.equal(nonTargetMarketEvidence(bank).country,'ZA');
 assert.equal(nonTargetMarketEvidence({...bank,documents:[{...bank.documents[0],text:'Open your business account with a German IBAN.'}]}),null);
 const explicit={...entry('Our domestic bank is regulated by the Bank of Uganda.'),developerWebsite:'https://bank.co.za/'};assert.equal(nonTargetMarketEvidence(explicit).country,'ZA');
});

test('account providers with optional credit-score or calculator features do not become unrelated products',()=>{
 const provider=entry('Open a multi-currency bank account. Our e-money account supports EUR and SEPA transfers. Credit score monitoring and a loan calculator are optional features.');
 assert.equal(screenCandidate(provider).eligible,true);
 const result=validateAssessment({},provider.documents);assert.equal(result.facts.euIban.status,'unknown');assert.notEqual(result.decision,'match');
 assert.equal(screenCandidate(entry('A payday loan calculator and credit score checker.')).eligible,false);
});

test('short transfer-provider descriptions stay reviewable without brand exceptions or invented account evidence',()=>{
 const e={...entry('Our company offers responsive services through agents and correspondents.'),title:'Example Money Transfer'};
 assert.equal(screenCandidate(e).eligible,true);assert.equal(screenCandidate(e).kind,'remittance_lead');
 assert.equal(validateAssessment({},e.documents).facts.business.status,'unknown');
 assert.equal(screenCandidate({...e,title:'General Company'}).eligible,false);
});

test('new geographical rules preserve worked records and reject real tools without API or history reset',()=>{
 const store=memoryStore(new Date('2026-11-02T17:00:00Z'));
 for(const [name,host,text]of [['Known provider','known.example.eu','Our company is registered in Hong Kong.'],['IBAN Checker','checker.example.eu','This tool validates existing IBAN numbers.']])store.state.findings.push({appId:'co.example.'+name.split(' ')[0].toLowerCase(),title:name,url:'https://'+host+'/',developerWebsite:'https://'+host+'/',screeningText:text});
 const id=crmRows(store.state).find(r=>r.title==='Known provider').id;excludeCRM(store.state,id,new Date(),'worked');store.state.crm.records[id].notes='Protected note';
 const before=structuredClone({rules:store.state.manualExclusions,records:store.state.crm.records,config:store.state.ai.config,usage:store.state.ai.usage});revalidateStoredAnalyses(store.state);
 assert.equal(crmRows(store.state).find(r=>r.id===id).worked,true);assert.equal(crmRows(store.state).find(r=>r.title==='IBAN Checker').status,'auto_excluded');
 assert.deepEqual({rules:store.state.manualExclusions,records:store.state.crm.records,config:store.state.ai.config,usage:store.state.ai.usage},before);assert.equal(store.state.ai.lastRepair.apiCalls,0);
});


test('a saved direct storage quote keeps an IBAN sharing utility excluded despite the words your IBAN',()=>{
 const text='"IBAN & Card" allows you to easily store and share your IBAN and card information. Features: Easily store IBAN and card details.';
 const store=memoryStore(new Date('2026-11-02T17:00:00Z'));store.state.findings.push({appId:'co.example.storage',title:'Details app',url:'https://play.google.com/store/apps/details?id=co.example.storage',screeningText:text});
 const group=groupedCandidates(store.state,{includeExcluded:true,allSources:true})[0],documents=group.documents.map((d,i)=>({...d,id:'s'+(i+1)}));
 const quote='Features: Easily store IBAN and card details.';
 const result=validateAssessment({utility:{status:'yes',evidence:[{sourceId:'s1',quote}]}},documents);
 store.state.ai.results.push({...result,id:group.id,inputHash:group.inputHash,version:2,checkedAt:'2026-11-02T17:00:00Z',analysisMethod:'ai',sourceDocuments:documents});
 const row=crmRows(store.state).find(r=>r.id===group.id);assert.equal(row.status,'auto_excluded');assert.equal(row.approval,null);
});
