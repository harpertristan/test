import {EventEmitter} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {socialPreset,socialPlan,SOCIAL_SOURCES} from '../lib/source-catalog.js';
import {validateSocialConfig,createSocialJob,runSocialSearch,evaluatePost} from '../lib/social-search.js';
import {publicAddress,publicTarget,htmlText,feedItems,pageProvider} from '../lib/page-provider.js';
import {validateWatchConfig,watchPlan,createWatchJob,runWatch} from '../lib/watch.js';
import {memoryStore,openStore,initialState} from '../lib/store.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp} from '../server.js';
import {companyGroups} from '../lib/companies.js';
import {eligibleFinding} from '../lib/qualification.js';
const now=new Date('2026-10-20T08:00:00Z');
const config=patch=>validateWatchConfig({watchUrls:['https://example.eu/business'],watchApps:[],autoWatchFindings:false,autoWatchSites:false,...patch});
const text='Open a business account with EUR IBAN and SEPA transfers. Accounts are available for companies in Europe.';
const webpage=body=>({url:'https://example.eu/business',title:'Example business accounts',text:body,body,contentType:'text/html'});
async function historyFile(t){const dir=await mkdtemp(join(tmpdir(),'watch-scout-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'state.json');}

test('bounded daily rotation covers every selected source/query pair and uses Kaliningrad day',()=>{
 const c=validateSocialConfig({...socialPreset(),eventMode:'signals'},now),pairs=new Set();
 const first=socialPlan(c,now);assert.equal(first.requests.length,8);assert.equal(first.total,34);assert.equal(first.cycleDays,5);
 for(let day=0;day<first.cycleDays;day++)for(const r of socialPlan(c,new Date(+now+day*86400000)).requests)pairs.add(`${r.source}|${r.query}`);
 assert.equal(pairs.size,first.total);
 assert.deepEqual(socialPlan(c,new Date('2026-10-19T22:01:00Z')),socialPlan(c,new Date('2026-10-20T20:00:00Z')));
 assert.notDeepEqual(socialPlan(c,new Date('2026-10-19T21:59:00Z')).requests,first.requests);
 for(const entry of socialPlan({...c,requestBudget:64},now).requests){const def=SOCIAL_SOURCES.find(s=>s.id===entry.source);const q=`${def.restriction} ${entry.query}`;assert.ok(q.length<=400);assert.ok(q.split(/\s+/).length<=50);}
});
test('Brave runner enforces budget, reports source status and does not call a register a recent launch',async()=>{
 const c=validateSocialConfig({...socialPreset(),eventMode:'signals',sources:['payments','regional','partners','registers'],requestBudget:3},now),job=createSocialJob('rotation',c,now);let calls=0;
 await runSocialSearch(job,{search:async()=>{calls++;return [];}},{delay:0,clock:()=>now});assert.equal(calls,3);assert.equal(job.searchTotal,3);assert.equal(job.sourceStatus.length,3);assert.equal(job.status,'complete');
 const reg=evaluatePost({url:'https://www.lb.lt/en/financial-market-participants',title:'Register of authorised electronic money institutions',description:'Payment institutions authorised in Lithuania.',page_age:'2020-01-01'},'registers',c,now).post;
 assert.ok(reg);assert.equal(reg.signalType,'register_lead');assert.equal(reg.dateReported,null);assert.equal(reg.discovery.euIban,'unknown');assert.ok(eligibleFinding(reg,c));
 const noRegion=evaluatePost({url:'https://www.lb.lt/en/register',title:'Register of authorised institutions',description:'Licensed payment institution.'},'registers',c,now).post;assert.deepEqual(noRegion.mentionedRegions,['Регион обслуживания не подтверждён']);
});
test('forum URLs are source-scoped, canonical and clearly user reports',()=>{
 const c=validateSocialConfig({...socialPreset(),eventMode:'signals'},now),entry={title:'Which business account with IBAN?',description:text,url:'https://old.reddit.com/r/fintech/comments/abc123/my-bank/?utm_source=test'};
 const first=evaluatePost(entry,'reddit',c,now).post,alias=evaluatePost({...entry,url:'https://www.reddit.com/r/fintech/comments/abc123/another-title/'},'reddit',c,now).post;
 assert.equal(first.id,alias.id);assert.equal(first.trust,'user_report');assert.equal(first.discovery.euIban,'unknown');
 assert.equal(evaluatePost({...entry,url:'https://reddit.com/r/unrelated/comments/abc123/topic'},'reddit',c,now).reason,'notPost');
 assert.equal(evaluatePost({...entry,url:'https://reddit.com.attacker.test/r/fintech/comments/abc123/topic'},'reddit',c,now).reason,'notPost');
 const forum=url=>evaluatePost({...entry,url},'forums',c,now).post;
 assert.equal(forum('https://www.offshorecorptalk.com/threads/business-bank.123/').id,forum('https://www.offshorecorptalk.com/threads/business-bank.123/page-2').id);
});
test('public page targets reject unsafe protocols and private/reserved DNS addresses',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 for(const u of ['http://example.eu','https://user:pass@example.eu','https://example.eu:444','https://localhost'])await assert.rejects(publicTarget(u,async()=>[{address:'8.8.8.8',family:4}]));
 await assert.rejects(publicTarget('https://example.eu',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]),/Private/);
});
test('HTML strips scripts/navigation and RSS/Atom preserve public article identity without entity loading',()=>{
 assert.equal(htmlText('<nav>menu</nav><script>secret()</script><p>Business &amp; IBAN</p>'),'Business & IBAN');
 const rss='<rss><channel><item><title>Launch</title><link>https://example.eu/new?utm_source=rss</link><description><![CDATA[<p>'+text+'</p>]]></description><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>';
 assert.equal(feedItems(rss)[0].url,'https://example.eu/new');assert.match(feedItems(rss)[0].description,/business account/);
 const atom='<feed><entry><title>Launch</title><link rel="alternate" href="https://example.eu/atom"/><summary>'+text+'</summary></entry></feed>';
 assert.equal(feedItems(atom)[0].url,'https://example.eu/atom');
});
test('watch establishes a baseline, detects a new account feature and deduplicates unchanged pages',async()=>{
 const store=memoryStore(now);let current=text;const monitor=createMonitor({kind:'watch',store,delay:0,clock:()=>now,provider:{page:async()=>webpage(current)}});
 await monitor.startJob(config());await monitor.idle();assert.equal(monitor.findings().length,0);assert.equal([...monitor.jobs.values()][0].skipped.baseline,1);
 current=text+' Business accounts now include a German IBAN.';await monitor.startJob(config());await monitor.idle();assert.equal(monitor.findings().length,1);const entry=monitor.findings()[0];assert.equal(entry.signalType,'page_change');assert.equal(entry.discovery.euIban,'explicit_claim');assert.match(entry.added.join(' '),/German IBAN/);
 await monitor.startJob(config());await monitor.idle();assert.equal(monitor.findings().length,1);assert.equal([...monitor.jobs.values()].at(-1).skipped.unchanged,1);
});
test('unavailable pages do not replace the last successful baseline',async()=>{
 const snapshots={},c=config();const options={delay:0,clock:()=>now,readSnapshot:key=>snapshots[key],saveSnapshot:async(key,v)=>{snapshots[key]=v;}};
 await runWatch(createWatchJob('base',c),{page:async()=>webpage(text)},options);const baseline=structuredClone(snapshots);
 const failed=createWatchJob('denied',c);await runWatch(failed,{page:async()=>{throw new Error('Forbidden');}},options);assert.equal(failed.status,'failed');assert.deepEqual(snapshots,baseline);assert.equal(failed.sourceStatus[0].status,'error');
});
test('a persistence failure cannot advance the snapshot beyond an unsaved event',async()=>{
 const snapshots={},c=config(),opts={delay:0,readSnapshot:key=>snapshots[key],saveSnapshot:async(key,v)=>{snapshots[key]=v;}};
 await runWatch(createWatchJob('base',c),{page:async()=>webpage(text)},opts);const baseline=structuredClone(snapshots),job=createWatchJob('change',c);
 await runWatch(job,{page:async()=>webpage(text+' Business accounts now offer a German IBAN.')},{...opts,onMatch:async()=>{throw Object.assign(new Error('disk'),{code:'PERSISTENCE_ERROR'});}});
 assert.equal(job.status,'failed');assert.equal(job.errors[0].code,'PERSISTENCE_ERROR');assert.deepEqual(snapshots,baseline);
});
test('old apps are watched regardless of original release; version-only update is not called a new bank',async()=>{
 let version='1.0';const store=memoryStore(now),m=createMonitor({kind:'watch',store,delay:0,clock:()=>now,provider:{app:async()=>({title:'Business',genreId:'FINANCE',description:text,released:'Jan 1, 2020',version})}}),c=config({watchUrls:[],watchApps:['com.example.bank']});
 await m.startJob(c);await m.idle();version='1.1';await m.startJob(c);await m.idle();assert.equal(m.findings().length,1);assert.match(m.findings()[0].reason,/новые условия счёта не подтверждены/);assert.equal(m.findings()[0].previousVersion,'1.0');
});
test('watch rotation is bounded, excludes blocked targets and keeps direct samples',()=>{
 const known=Array.from({length:60},(_,i)=>({appId:`com.example.app${i}`,developerWebsite:`https://bank${i}.example.eu/`})),c=config({watchApps:['com.reference.bank'],autoWatchFindings:true,autoWatchSites:true,excludeAppIds:['com.example.app0'],excludeDomains:['example.eu']});
 const a=watchPlan(c,known,now);assert.equal(a.filter(t=>t.kind==='app').length,30);assert.equal(a.filter(t=>t.kind==='page').length,0);assert.ok(a.some(t=>t.appId==='com.reference.bank'));assert.ok(!a.some(t=>t.appId==='com.example.app0'));assert.notDeepEqual(a,watchPlan(c,known,new Date(+now+86400000)));
});
test('RSS records are persisted once across feeds and runs without consuming Brave requests',async()=>{
 const store=memoryStore(now),c=config({watchUrls:[],feedUrls:['https://example.eu/feed.xml']}),xml='<rss><channel><item><title>Business account launch</title><link>https://example.eu/new</link><description>'+text+'</description></item></channel></rss>';
 let calls=0;const m=createMonitor({kind:'watch',store,delay:0,clock:()=>now,provider:{page:async()=>{calls++;return {...webpage(text),body:xml,xml:true};}}});
 await m.startJob(c);await m.idle();await m.startJob(c);await m.idle();assert.equal(m.findings().length,1);assert.equal(calls,2);assert.equal(m.findings()[0].signalType,'rss_item');
});
test('upgrade adds sources and watch state while preserving history, exclusions and disabled schedules',async t=>{
 const file=await historyFile(t),old=initialState(now);delete old.watch;delete old.social.sourceCatalogVersion;old.social.schedule.enabled=false;old.social.schedule.filters.sources=['custom'];old.social.schedule.filters.watchDomains=['example.eu'];old.social.schedule.filters.queries=['my existing query'];old.findings=[{appId:'com.saved.bank',title:'Saved'}];
 await writeFile(file,JSON.stringify(old));let s=await openStore(file,now);assert.equal(s.state.social.schedule.enabled,false);assert.equal(s.state.findings.length,1);assert.ok(s.state.social.schedule.filters.sources.includes('forums'));assert.ok(s.state.social.schedule.filters.sources.includes('custom'));assert.deepEqual(s.state.social.schedule.filters.queries,['my existing query']);assert.equal(s.state.social.schedule.filters.requestBudget,8);assert.ok(s.state.watch);
 await s.update(d=>{d.watch.schedule.enabled=false;d.watch.snapshots.test={hash:'saved',text:'baseline'};});s=await openStore(file,now);assert.equal(s.state.watch.schedule.enabled,false);assert.equal(s.state.watch.snapshots.test.hash,'saved');
});
test('daily watch resumes and maintains a separate schedule and persisted baseline across restart',async t=>{
 const file=await historyFile(t);let store=await openStore(file,now),clock=now,current=text;
 let m=createMonitor({kind:'watch',store,autoSchedule:true,clock:()=>clock,delay:0,provider:{page:async()=>webpage(current)}});
 await m.saveSchedule({enabled:true,time:'09:30',filters:config()});await m.tick();await m.idle();assert.equal(store.state.watch.jobs.length,1);await m.tick();await m.idle();assert.equal(store.state.watch.jobs.length,1);await m.stop();
 store=await openStore(file,now);clock=new Date(+now+86400000);current=text+' Business accounts now offer a German IBAN.';m=createMonitor({kind:'watch',store,autoSchedule:true,clock:()=>clock,delay:0,provider:{page:async()=>webpage(current)}});await m.tick();await m.idle();assert.equal(m.findings().length,1);assert.equal(store.state.findings.length,0);assert.equal(store.state.social.findings.length,0);await m.stop();
});
test('company grouping retains one app and marks name-based associations as unconfirmed',()=>{
 const s=initialState(now);s.schedule.filters.strictBanking=false;s.findings=[{appId:'com.stablecom.app',title:'Stable.com',developerWebsite:'https://stable.com',discovery:{version:2,status:'service_match'}}];s.social.schedule.filters.eventMode='signals';s.social.findings=[{id:'post:1',title:'Stable.com launches business accounts',url:'https://finextra.com/article/1',discovery:{version:2,status:'service_match'}}];const groups=companyGroups(s);assert.equal(groups.length,1);assert.equal(groups[0].items.length,2);assert.equal(groups[0].unconfirmedAssociations,1);
});
test('one action enables all four schedules; watch API, assets and CSV respect authentication',async t=>{
 const store=memoryStore(now);for(const s of [store.state,store.state.social,store.state.web,store.state.watch])s.schedule.enabled=false;
 const server=createApp({store,password:'fixture-pass',clock:()=>now,watchDelay:0,watchProvider:{page:async()=>webpage(text)}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Basic '+Buffer.from('admin:fixture-pass').toString('base64'),'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/watch')).status,401);
 assert.equal((await fetch(base+'/api/monitoring/enable',{method:'POST',headers:{Authorization:headers.Authorization}})).status,415);
 for(const path of ['/watch','/watch.js','/source-catalog.js','/api/companies'])assert.equal((await fetch(base+path,{headers})).status,200,path);
 const response=await fetch(base+'/api/monitoring/enable',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);for(const s of [store.state,store.state.social,store.state.web,store.state.watch])assert.equal(s.schedule.enabled,true);assert.ok(store.state.social.schedule.filters.sources.includes('forums'));
 assert.equal((await fetch(base+'/api/monitoring/enable',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);
 const run=await fetch(base+'/api/watch/search',{method:'POST',headers,body:JSON.stringify(config())});assert.equal(run.status,202);await server.watchMonitor.idle();assert.equal(Object.keys(store.state.watch.snapshots).length,1);assert.equal((await fetch(base+'/api/watch/findings/export.csv',{headers})).status,200);
});

test('native page client validates redirect destinations, DNS lookup shape and unsupported response types',async()=>{
 const resolver=async host=>[{address:host==='private.example.eu'?'127.0.0.1':'8.8.8.8',family:4}];let requests=0,mode='good';
 const request=(url,options,callback)=>{requests++;const req=new EventEmitter();req.destroy=error=>{if(error)queueMicrotask(()=>req.emit('error',error));};
  options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.ok(Array.isArray(addresses));});
  queueMicrotask(()=>{const res=new EventEmitter();res.resume=()=>{};res.statusCode=mode==='redirect'?302:200;res.headers=mode==='redirect'?{location:'https://private.example.eu/'}:{'content-type':mode==='binary'?'application/pdf':'text/html'};callback(res);if(mode==='good'){res.emit('data',Buffer.from('<html><title>Business accounts</title><p>'+text+'</p></html>'));res.emit('end');}});return req;};
 const provider=pageProvider({resolve:resolver,request,proxy:''});const page=await provider.page('https://example.eu/');assert.match(page.text,/business account/i);
 mode='redirect';const before=requests;await assert.rejects(provider.page('https://example.eu/'),/Private/);assert.equal(requests,before+1);mode='binary';await assert.rejects(provider.page('https://example.eu/'),/Unsupported/);
});
