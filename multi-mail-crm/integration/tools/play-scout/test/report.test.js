import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {memoryStore,openStore,initialState} from '../lib/store.js';
import {inboxEntry} from '../lib/neural-inbox.js';
import {buildReport,reportRows,reportCSV,reportHTML,reportDOCX,updateShortlist} from '../lib/report.js';
import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-20T10:00:00Z');
function fixture(count=3){
 const store=memoryStore(now);
 for(const s of[store.state,store.state.web,store.state.social,store.state.watch])s.schedule.enabled=false;
 for(let i=0;i<count;i++)store.state.ai.inbox.push(inboxEntry({title:'Банк '+i,url:`https://bank${i}.example.eu/`,snippet:'Open a business account with a German IBAN.'},'web',now));
 const id='company:bank0.example.eu',proof={quote:'Open a business account with a German IBAN.',url:'https://bank0.example.eu/',kind:'official_page'};
 store.state.ai.results.push({id,title:'Банк 0',url:proof.url,section:'inbox',targetId:store.state.ai.inbox[0].id,facts:Object.fromEntries(['business','account','euIban','utility'].map(name=>[name,{status:name==='utility'?'unknown':'yes',evidence:name==='utility'?[]:[proof]}])),decision:'match',summary:'Есть предложение счёта компании; проверьте условия открытия.',model:'fixture-model',checkedAt:now.toISOString(),availability:{status:'live',evidence:[proof]}});
 store.state.ai.newIds=[id];return store;
}
test('unified report includes every remaining row, available analyses, quotes and explicit unknowns without external calls',()=>{
 const store=fixture(45);store.state.findings.push({appId:'com.bank0.app',title:'Банк 0 Android',url:'https://play.google.com/store/apps/details?id=com.bank0.app',developerWebsite:'https://bank0.example.eu/'});
 const r=buildReport(store.state,{},now);assert.equal(r.rows.length,45);assert.equal(r.rows[0].targets.length,2);assert.ok(reportHTML(r).includes('Банк 44'));assert.ok(reportHTML(r).includes('Есть предложение счёта компании'));assert.ok(reportHTML(r).includes('Open a business account'));assert.ok(reportHTML(r).includes('Не подтверждено'));assert.ok(reportHTML(r).includes('20.10.2026, 12:00'));assert.match(reportCSV(r),/fixture-model/);
 assert.deepEqual(store.state.ai.usage,{});assert.equal(store.state.ai.jobs.length,0);
});
test('manual exclusions always override a saved shortlist, and undo restores the chosen record',()=>{
 const store=fixture();updateShortlist(store.state,{action:'add',ids:['company:bank0.example.eu','company:bank1.example.eu']});
 store.state.manualExclusions.push({kind:'domain',value:'bank0.example.eu'});
 const report=buildReport(store.state,{scope:'selected'},now);assert.equal(report.rows.length,1);for(const data of[reportHTML(report),reportCSV(report),reportDOCX(report).toString('utf8')]){assert.ok(!data.includes('Банк 0'));assert.ok(!data.includes('bank0.example.eu'));assert.ok(data.includes('Банк 1'));}
 assert.equal(store.state.ai.shortlist.length,2);store.state.manualExclusions=[];assert.equal(reportRows(store.state,{scope:'selected'}).length,2);
});
test('an excluded cited publication cannot remain evidence of a confirmed match in an export',()=>{
 const store=fixture(),r=store.state.ai.results[0];for(const f of Object.values(r.facts))for(const p of f.evidence)p.url='https://finextra.com/newsarticle/excluded';
 store.state.manualExclusions=[{kind:'url',value:'https://finextra.com/newsarticle/excluded'}];
 const report=buildReport(store.state,{},now),row=report.rows[0];assert.equal(row.decision,'review');assert.equal(row.facts.euIban.status,'unknown');assert.equal(reportHTML(report).includes('https://finextra.com/newsarticle/excluded'),false);assert.ok(row.warnings.some(s=>s.includes('исключена')));
});
test('export filters select new, pending and reviewed entries independently of pagination',()=>{
 const state=fixture().state;assert.equal(reportRows(state,{filter:'new'}).length,1);assert.equal(reportRows(state,{filter:'pending'}).length,2);assert.equal(reportRows(state,{filter:'match'}).length,1);assert.throws(()=>reportRows(state,{filter:'__proto__'}));assert.throws(()=>reportRows(state,{scope:'everything'}));
});
test('HTML escapes source content, does not load remote assets, and CSV protects spreadsheet formulas',()=>{
 const store=fixture();store.state.ai.inbox[1].title='=HYPERLINK("https://evil.example", "run")';store.state.ai.results[0].summary='<script>alert(1)</script> & текст';
 const r=buildReport(store.state,{},now),html=reportHTML(r),csv=reportCSV(r);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('sha256-'));assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('""https://evil.example""'));assert.equal(reportDOCX(r).readUInt32LE(0),0x04034b50);
});
test('shortlist migration and manual edits survive a real file restart without altering histories, usage or schedules',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'report-selection-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),s=fixture().state;delete s.ai.shortlist;await writeFile(file,JSON.stringify(s));
 const store=await openStore(file,now),before=structuredClone(store.state.schedule);assert.deepEqual(store.state.ai.shortlist,[]);await store.update(d=>updateShortlist(d,{action:'add',ids:['company:bank0.example.eu']}));
 const again=await openStore(file,now);assert.deepEqual(again.state.ai.shortlist,['company:bank0.example.eu']);assert.deepEqual(again.state.schedule,before);assert.equal(again.state.ai.inbox.length,3);assert.equal(again.state.ai.results.length,1);
 await again.update(d=>updateShortlist(d,{action:'clear'}));assert.equal(buildReport(again.state,{scope:'selected'},now).rows.length,0);assert.equal(again.state.ai.results.length,1);
 const malformed=initialState(now);malformed.ai.shortlist='invalid';await writeFile(file,JSON.stringify(malformed));await assert.rejects(openStore(file,now));assert.equal(JSON.parse(await readFile(file,'utf8')).ai.shortlist,'invalid');
});
test('protected export APIs apply current exclusions at download time and shortlist writes are validated and atomic',async t=>{
 const store=fixture();store.state.findings.push({appId:'com.bank0.app',title:'Банк 0 Android',url:'https://play.google.com/store/apps/details?id=com.bank0.app',developerWebsite:'https://bank0.example.eu/'});const server=createApp({store,password:'fixture-report',clock:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Basic '+Buffer.from('admin:fixture-report').toString('base64'),'Content-Type':'application/json'},post=body=>fetch(base+'/api/ai/shortlist',{method:'POST',headers,body:JSON.stringify(body)});
 for(const path of['/api/ai/export.docx','/api/ai/export.csv','/api/ai/report.html'])assert.equal((await fetch(base+path)).status,401);
 assert.equal((await post({action:'add',ids:['company:bank0.example.eu','not-a-real-find']})).status,400);assert.deepEqual(store.state.ai.shortlist,[]);
 assert.equal((await post({action:'add',ids:['company:bank0.example.eu']})).status,200);assert.equal((await(await fetch(base+'/api/ai/monitor',{headers})).json()).shortlistIds.length,1);
 const word=await fetch(base+'/api/ai/export.docx?scope=selected',{headers});assert.equal(word.status,200);assert.match(word.headers.get('content-type'),/wordprocessingml/);assert.match(word.headers.get('content-disposition'),/2026-10-20.docx/);assert.equal(Buffer.from(await word.arrayBuffer()).readUInt32LE(0),0x04034b50);
 const html=await fetch(base+'/api/ai/report.html?scope=selected',{headers});assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);assert.ok((await html.text()).includes('Банк 0'));
 const excluded=await fetch(base+'/api/exclusions',{method:'POST',headers,body:JSON.stringify({section:'company',id:'company:bank0.example.eu'})});assert.equal(excluded.status,200);assert.equal((await excluded.json()).rule.kind,'domain');assert.equal((await(await fetch(base+'/api/ai/inbox',{headers})).json()).some(e=>e.id==='company:bank0.example.eu'),false);const csv=await fetch(base+'/api/ai/export.csv?scope=selected',{headers});assert.ok(!(await csv.text()).includes('Банк 0'));
 assert.equal((await fetch(base+'/api/ai/export.csv?scope=oops',{headers})).status,400);assert.equal((await fetch(base+'/api/ai/shortlist',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:'{"action":"clear"}'})).status,403);
 const real=store.update.bind(store);store.update=async()=>{throw Object.assign(new Error('disk'),{code:'PERSISTENCE_ERROR'});};assert.equal((await post({action:'clear'})).status,500);assert.equal(store.state.ai.shortlist.length,1);store.update=real;
});
