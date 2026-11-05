import {DISCOVERY_VERSION} from '../lib/discovery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';
import {createApp,shutdownApp} from '../server.js';
import {createAIReview} from '../lib/ai-review.js';
import {createMonitor} from '../lib/monitor.js';
import {companyGroups} from '../lib/companies.js';

const now=new Date('2026-10-26T10:00:00Z');
const text='Open a business account with a dedicated German IBAN. Companies can receive EUR payments and send SEPA transfers.';
const noNetwork={configured:()=>false,search:async()=>{throw Error('Unexpected network request');}};

function history(){
 const store=memoryStore(now),s=store.state;
 for(let i=0;i<271;i++){
  const row={appId:'co.sample.app'+i,title:'Business '+i,url:'https://play.google.com/store/apps/details?id=co.sample.app'+i,developerWebsite:'https://sample'+i+'.example.eu',countries:['DE'],keywords:['business account'],screeningText:text,firstFoundAt:now.toISOString(),discovery:{version:DISCOVERY_VERSION,status:i<85?'service_match':'needs_review'}};
  (i<85?s.findings:s.reviewCandidates).push(row);
 }
 for(let i=0;i<40;i++)s.manualExclusions.push({key:'excluded'+i,kind:'app',value:'co.sample.app'+i});
 for(let i=0;i<10;i++)s.jobs.push({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),status:'complete',config:s.schedule.filters,results:structuredClone(s.findings),reviewCandidates:structuredClone(s.reviewCandidates)});
 for(const section of [s,s.web,s.social,s.apple,s.watch])section.schedule.enabled=false;
 s.ai.config.enabled=false;
 return store;
}

// Count walks of retained jobs rather than imposing a flaky timing threshold.
// The regression rebuilt this graph once per row and blocked Node's event loop.
function trackHistoryWalks(state){
 let reads=0;const jobs=state.jobs;
 Object.defineProperty(state,'jobs',{configurable:true,enumerable:true,get(){reads++;return jobs;}});
 return {reset(){reads=0;},get reads(){return reads;}};
}

test('disabled and not-yet-due AI schedules do not scan source histories',async()=>{
 const store=history();let probes=0;
 const ai=createAIReview({store,clock:()=>now,autoSchedule:true,provider:{configured:()=>false,model:'offline'},isDiscoveryBusy:()=>{probes++;return false;}});
 await ai.tick();assert.equal(probes,0);
 store.state.ai.config.enabled=true;store.state.ai.config.time='23:59';
 await ai.tick();assert.equal(probes,0);
 await ai.stop();
});

test('source summary and saved lists build exclusions once, regardless of row count',async()=>{
 const store=history(),m=createMonitor({store,provider:noNetwork}),walks=trackHistoryWalks(store.state);
 const summary=m.summary();assert.equal(walks.reads,1);assert.equal(summary.totalFindings,45);assert.equal(summary.totalCandidates,186);
 walks.reset();assert.equal(m.findings().length,45);assert.equal(walks.reads,1);
 walks.reset();assert.equal(m.candidates().length,186);assert.equal(walks.reads,1);
 walks.reset();assert.equal(companyGroups(store.state).length,231);assert.equal(walks.reads,1);
 await m.stop();
});

test('startup and health remain responsive without calculating source summaries',async t=>{
 const store=history();store.state.ai.config.enabled=true;
 const server=createApp({store,autoSchedule:true,clock:()=>now,provider:noNetwork,socialProvider:noNetwork,aiProvider:{configured:()=>false,model:'offline'}});
 const walks=trackHistoryWalks(store.state);
 // Startup must use the cheap busy flag even when AI is enabled and due.
 for(const control of [server.monitor,server.webMonitor,server.socialMonitor,server.appleMonitor,server.watchMonitor])control.summary=()=>{throw Error('Startup must not calculate a dashboard summary');};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));
 const base='http://127.0.0.1:'+server.address().port;
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
 assert.equal(walks.reads,0);
 const page=await fetch(base+'/crm');assert.equal(page.status,200);assert.match(await page.text(),/Единая CRM/);
});

test('CRM with 85 apps, 186 candidates and retained jobs shares rules without retaining stale exclusions',async t=>{
 const store=history(),server=createApp({store,provider:noNetwork,socialProvider:noNetwork,aiProvider:{configured:()=>false,model:'offline'}}),walks=trackHistoryWalks(store.state);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));
 const base='http://127.0.0.1:'+server.address().port;
 const start=performance.now(),first=await fetch(base+'/api/crm');assert.equal(first.status,200);const data=await first.json();
 t.diagnostic(`CRM HTTP response: ${Math.round(performance.now()-start)} ms on this test machine`);
 assert.equal(walks.reads,1);assert.equal(data.rows.length,271);assert.equal(data.counts.excluded,40);assert.equal(data.ai.due,231);assert.equal(data.monitors.play.totalFindings,45);
 await store.update(d=>{d.manualExclusions=d.manualExclusions.filter(r=>r.key!=='excluded0');});
 const updated=await (await fetch(base+'/api/crm')).json();assert.equal(updated.counts.excluded,39);assert.equal(updated.ai.due,232);assert.equal(updated.rows.find(r=>r.id==='company:sample0.example.eu').manualExcluded,false);
 const exportReply=await fetch(base+'/api/jobs/00000000-0000-4000-8000-000000000000/export.csv?all=1');assert.equal(exportReply.status,200);
 const exported=await exportReply.text();assert.match(exported,/Business 0/);assert.ok(!exported.includes('"Business 1"'));
});
