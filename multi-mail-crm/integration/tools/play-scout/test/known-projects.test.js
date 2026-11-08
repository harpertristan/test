import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {seedKnownProjects} from '../lib/known-projects.js';
import {effectiveExclusions,manuallyExcluded} from '../lib/manual-exclusions.js';
import {memoryStore,openStore} from '../lib/store.js';
import {crmRows,crmExport,bulkCRM,crmDOCX} from '../lib/crm.js';
import {storeInbox,inboxEntry,groupedCandidates} from '../lib/neural-inbox.js';
import {dueReviews} from '../lib/ai-review.js';
import {createMonitor} from '../lib/monitor.js';
const now=new Date('2026-10-29T12:00:00Z');
function fixture(){const s=memoryStore(now);seedKnownProjects(s.state,now);return s;}
test('39 known projects seed once and match their domains, aliases, subject headlines and early article leads',()=>{
 const store=fixture();assert.equal(store.state.knownProjects.length,39);assert.equal(seedKnownProjects(store.state,now),false);const rules=effectiveExclusions(store.state);
 for(const e of[
  {url:'https://kartiera.eu/new-accounts'},
  {title:'Colibrix One announces new services'},
  {title:'Borderpay raises a funding round'},
  {title:'An interview with Omexpay'},
  {title:'New payment provider in Europe',snippet:'Omexpay Business has launched corporate IBAN accounts.'},
  {title:'BANKPRO launches new business accounts',url:'https://finextra.com/news/bankpro'},
  {title:'Moneff Business',appId:'co.unknown.package'},
  {appId:'com.stablecom.app'}
 ])assert.equal(manuallyExcluded(e,rules),true,JSON.stringify(e));
 assert.equal(manuallyExcluded({title:'BorderlessPay launches business accounts'},rules),false);
 assert.equal(manuallyExcluded({title:'How stable business growth works'},rules),false);
 assert.equal(manuallyExcluded({title:'A new e-money institution for companies'},rules),false);
});
test('a newly named provider is retained when the known brand is only its partner',()=>{
 const rules=effectiveExclusions(fixture().state);
 for(const e of[
  {title:'FreshCo launches business accounts through Omexpay',snippet:'FreshCo provides accounts through its partner Omexpay.'},
  {title:'Omexpay and FreshCo announce a partnership',serviceName:'FreshCo',snippet:'FreshCo offers new accounts.'}
 ])assert.equal(manuallyExcluded(e,rules),false,JSON.stringify(e));
});
test('known apps, sites and articles never enter working lists or AI; the known registry remains separately exportable',()=>{
 const store=fixture(),app={appId:'co.omexpay.business',title:'Omexpay Business',url:'https://play.google.com/store/apps/details?id=co.omexpay.business',screeningText:'Business accounts with a German IBAN.'},post={id:'post:known',title:'Omexpay raises a funding round',url:'https://finextra.com/news/known',snippet:'Omexpay Business offers business accounts with a German IBAN.',source:'finextra'};
 store.state.findings.push(app);store.state.crm.records['app:'+app.appId]={notes:'Старый комментарий сохраняется'};store.state.social.findings.push(post);storeInbox(store.state,[inboxEntry(app,'play',now),inboxEntry(post,'social',now)]);
 assert.equal(store.state.ai.inbox.length,0);assert.equal(groupedCandidates(store.state).length,0);assert.equal(dueReviews(store.state,'offline').length,0);assert.equal(crmExport(store.state).length,0);assert.equal(crmExport(store.state,{status:'all'}).length,0);assert.equal(crmExport(store.state,{status:'known'}).length,39);assert.equal(crmRows(store.state).filter(r=>r.status==='known').length,39);assert.equal(store.state.findings.length,1,'historical records remain on disk');
 assert.match(crmExport(store.state,{status:'known'}).find(r=>r.title==='Omexpay Business').notes,/Старый комментарий/);
 const document=crmDOCX(crmExport(store.state,{status:'known'})).toString('utf8');assert.match(document,/Omexpay/);assert.doesNotMatch(document,/Target=""/);
});
test('restoring a known project persists across restart without changing manual exclusions or reseeding it',async t=>{
 const store=fixture(),id=store.state.knownProjects.find(p=>p.name==='Omexpay Business').id;store.state.manualExclusions=[{key:'manual',kind:'domain',value:'blocked.eu',reason:'worked'}];
 bulkCRM(store.state,{ids:[id],action:'restore'},now);assert.equal(manuallyExcluded({title:'Omexpay launches new services'},effectiveExclusions(store.state)),false);assert.equal(crmExport(store.state,{status:'known'}).length,38);
 const dir=await mkdtemp(join(tmpdir(),'known-projects-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json');await writeFile(path,JSON.stringify(store.state));const reopened=await openStore(path,now);
 assert.equal(reopened.state.knownProjects.find(p=>p.id===id).enabled,false);assert.equal(crmExport(reopened.state,{status:'known'}).length,38);assert.equal(reopened.state.manualExclusions[0].key,'manual');
});
test('a known seed still supplies recommendations while its own finding and AI input remain hidden',async()=>{
 for(const explicitlyExcluded of[false,true]){
  const store=fixture();if(explicitlyExcluded)store.state.manualExclusions=[{key:'manual-stable',kind:'app',value:'com.stablecom.app',reason:'worked'}];let recommendations=0;
  const app={appId:'co.fresh.business',title:'Fresh Business',description:'We offer business accounts with a German IBAN and SEPA transfers.',developerWebsite:'https://fresh.eu/',genreId:'FINANCE',price:0,free:true,minInstalls:100,released:'2026-10-01'};
  const monitor=createMonitor({store,clock:()=>now,delay:0,provider:{search:async()=>[],related:async()=>{recommendations++;return[{appId:app.appId}];},app:async()=>app}});
  await monitor.startJob({...store.state.schedule.filters,referenceDiscovery:false,keywords:['business IBAN'],countries:['DE'],seedApps:['com.stablecom.app'],related:true,developerExpansion:false,useWebIndex:false,ignoreReleaseDate:true});await monitor.idle();
  assert.equal(recommendations,explicitlyExcluded?0:2);assert.equal(store.state.findings.length,explicitlyExcluded?0:1);assert.ok(!store.state.ai.inbox.some(r=>r.appId==='com.stablecom.app'));await monitor.stop();
 }
});
