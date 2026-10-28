import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';
import {createSourceWorkspace} from '../lib/source-workspace.js';
import {SEARCH_CHANNELS,channelMatches} from '../lib/source-workspace-catalog.js';
import {validateSocialConfig,runSocialSearch,createSocialJob} from '../lib/social-search.js';
import {sourceRestriction} from '../lib/source-catalog.js';
import {groupedCandidates,inboxEntry,storeInbox} from '../lib/neural-inbox.js';
import {crmExport,bulkCRM} from '../lib/crm.js';
import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-28T10:00:00Z'),pause=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await pause();}assert.ok(fn(),'condition did not settle');}
function fixture(t){const store=memoryStore(now),calls=[],monitors={};let reviews=0;
 for(const kind of ['play','web','social','watch']){let busy=false,promise=Promise.resolve(),release;const jobs=new Map();monitors[kind]={jobs,isBusy:()=>busy,summary:()=>({schedule:(kind==='play'?store.state:store.state[kind]).schedule}),async startJob(input,source){if(busy)throw Error('busy');busy=true;const job={id:String(calls.length),status:'running',neuralCaptured:2};jobs.set(job.id,job);calls.push({kind,input,source,job});promise=new Promise(r=>release=r);return job;},idle:()=>promise,finish(){busy=false;[...jobs.values()].at(-1).status='complete';release();},async cancel(id){jobs.get(id).status='cancelled';busy=false;release();}};}
 const workspace=createSourceWorkspace({store,monitors,clock:()=>now,review:{summary:()=>({configured:true,busy:false}),startJob:async()=>{reviews++;return {id:'review'};},idle:async()=>{},job:()=>({errors:[]})},autoSchedule:true});t.after(()=>workspace.stop());return{store,workspace,monitors,calls,reviews:()=>reviews};}
test('catalogue exposes individual domains and excludes App Store',()=>{const ids=SEARCH_CHANNELS.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.includes('social:payments:thepaypers.com'));assert.ok(ids.includes('social:payments:fintechfutures.com'));assert.ok(ids.includes('social:trustpilot'));assert.ok(!ids.some(id=>/appstore|apple/.test(id)));});
test('one source starts alone; queued sources remain separate and cancelling one leaves another running',async t=>{
 const {workspace,monitors,calls,reviews}=fixture(t);await workspace.start({id:'social:trustpilot'});await until(()=>calls.length===1);assert.deepEqual(calls[0].input.sources,['trustpilot']);assert.equal(calls[0].source,'channel:social:trustpilot');
 await workspace.start({id:'social:finextra'});await workspace.start({id:'web'});await until(()=>calls.length===2);assert.equal(workspace.summary().channels.find(c=>c.id==='social:finextra').last.status,'queued');
 await workspace.cancel('social:finextra');assert.ok(monitors.social.isBusy());assert.ok(monitors.web.isBusy());assert.equal(reviews(),0);
 await workspace.cancel('social:trustpilot');assert.ok(monitors.web.isBusy());await workspace.cancel('web');assert.equal(workspace.summary().busy,false);
});
test('a focused publication preserves its own domain and runs after the previous publication only',async t=>{
 const {workspace,monitors,calls}=fixture(t);await workspace.start({id:'social:payments:thepaypers.com'});await workspace.start({id:'social:payments:fintechfutures.com'});await until(()=>calls.length===1);assert.equal(calls[0].input.focusDomain,'thepaypers.com');monitors.social.finish();await until(()=>calls.length===2);assert.equal(calls[1].input.focusDomain,'fintechfutures.com');assert.equal(calls.length,2);
});
test('individual schedules honour Kaliningrad time and never repeat a source on the same day',async t=>{
 const {workspace,store,calls}=fixture(t);await workspace.save({id:'web',enabled:true,time:'13:00'});await workspace.save({id:'social:trustpilot',enabled:true,time:'09:00',analyse:false});await workspace.tick();await until(()=>calls.length===1);assert.equal(calls[0].kind,'social');await workspace.cancel('social:trustpilot');await workspace.tick();assert.equal(calls.length,1);assert.equal(store.state.sourceWorkspace.settings.web.time,'13:00');
});
test('AI after a source is opt-in and settings cannot trigger other sources',async t=>{const {workspace,monitors,calls,reviews}=fixture(t);await workspace.start({id:'web',analyse:true});await until(()=>calls.length===1);monitors.web.finish();await until(()=>reviews()===1);assert.equal(calls.length,1);await assert.rejects(workspace.start({id:'missing'}));await assert.rejects(workspace.save({id:'web',time:'25:00'}));});
test('source provenance survives merging and one exclusion applies to every view and export',()=>{
 const store=memoryStore(now),entry={title:'Acme',url:'https://acme.example.eu/',developerWebsite:'https://acme.example.eu/',screeningText:'Acme provides business accounts with a German IBAN.',sourceKey:'web'};
 storeInbox(store.state,[inboxEntry(entry,'web',now),inboxEntry({...entry,url:'https://finextra.com/news/acme',source:'finextra',sourceKey:'social:finextra'},'social',now)]);
 const merged=groupedCandidates(store.state);assert.equal(merged.length,1);assert.deepEqual(merged[0].sourceKeys,['web','social:finextra']);assert.equal(crmExport(store.state,{source:'web'}).length,1);assert.equal(crmExport(store.state,{source:'social:finextra'}).length,1);assert.equal(crmExport(store.state,{source:'social:trustpilot'}).length,0);
 bulkCRM(store.state,{ids:[merged[0].id],reason:'worked'},now);assert.equal(groupedCandidates(store.state).length,0);assert.equal(crmExport(store.state,{source:'web'}).length,0);assert.equal(crmExport(store.state,{status:'excluded',source:'social:finextra'}).length,1);
});
test('domain focus validates against selected source and filters off-domain index results',async()=>{
 assert.throws(()=>validateSocialConfig({sources:['finextra'],focusDomain:'evil.example'}));
 const config=validateSocialConfig({profile:'business',sources:['payments'],focusDomain:'thepaypers.com',queries:['business account IBAN']},now);assert.match(sourceRestriction('payments',config),/site:thepaypers\.com$/);
 const job=createSocialJob('focused',config,now),seen=[];await runSocialSearch(job,{configured:()=>true,search:async()=>[{url:'https://fintechfutures.com/acme',title:'Acme launches business account with German IBAN',description:'Business account with a German IBAN.'}]},{delay:0,clock:()=>now,onRawCandidate:e=>seen.push(e),onMatch:async()=>{},isSeen:()=>false});assert.equal(seen.length,0);
 assert.ok(channelMatches({sources:['payments'],targets:[{url:'https://thepaypers.com/news/acme'}]},'social:payments:thepaypers.com'));assert.ok(!channelMatches({sources:['payments'],targets:[{url:'https://fintechfutures.com/news/acme'}]},'social:payments:thepaypers.com'));
});
test('source API remains read-only for viewers and rejects cross-site owner actions',async t=>{
 const server=createApp({password:'owner',viewerPassword:'reader'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port;
 const call=(auth,extra={})=>fetch(base+'/api/sources/start',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(auth).toString('base64'),'Content-Type':'application/json',...extra},body:'{"id":"play"}'});
 assert.equal((await call('viewer:reader')).status,403);assert.equal((await call('admin:owner',{'Sec-Fetch-Site':'cross-site'})).status,403);
});
test('completed sources wait for an existing AI review and global stop prevents a late new analysis',async t=>{
 const {workspace,monitors,calls}=fixture(t);let release,attempts=0,busy=true;
 // A separate workspace shares the real monitor lanes, as an existing manual
 // review would; no paid provider is present in this scenario.
 const store=memoryStore(now),review={summary:()=>({configured:true,busy}),idle:()=>new Promise(r=>release=r),startJob:async()=>{attempts++;return{id:'new'};}};
 const w=createSourceWorkspace({store,monitors,review});t.after(()=>w.stop());await w.start({id:'web',analyse:true});await until(()=>calls.length===1);monitors.web.finish();await until(()=>typeof release==='function');await w.cancelAll();busy=false;release();await pause();await pause();assert.equal(attempts,0);assert.equal(workspace.summary().busy,false);
});
test('failed local AI pauses automatic follow-up across sources until explicitly resumed',async t=>{
 const {store,monitors,calls}=fixture(t);let attempts=0;
 const w=createSourceWorkspace({store,monitors,review:{summary:()=>({configured:true,busy:false}),startJob:async()=>{attempts++;return{id:'bad'};},idle:async()=>{},job:()=>({engine:'llamacpp',errors:[{code:'LOCAL_TIMEOUT'}]})}});t.after(()=>w.stop());
 await w.start({id:'web',analyse:true});await until(()=>calls.length===1);monitors.web.finish();await until(()=>Boolean(w.summary().analysisPaused));await w.start({id:'social:trustpilot',analyse:true});await until(()=>calls.length===2);monitors.social.finish();await until(()=>!w.summary().busy);assert.equal(attempts,1);w.analysisResumed();assert.equal(w.summary().analysisPaused,null);
});
