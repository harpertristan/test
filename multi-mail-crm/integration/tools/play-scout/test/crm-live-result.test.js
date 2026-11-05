import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';
import {createApp,shutdownApp} from '../server.js';

test('CRM publishes each saved result while a batch is running and binds failures to the correct card',{timeout:20000},async t=>{
 const store=memoryStore(),text='We offer business accounts for companies. Open your business account with a German IBAN.';
 store.state.ai.config.cloudConcurrency=1;
 for(let i=0;i<2;i++)store.state.findings.push({appId:'qa.live'+i,title:'Live '+i,url:'https://play.google.com/store/apps/details?id=qa.live'+i,developerWebsite:'https://live'+i+'.example.eu/',screeningText:'A business account service for companies.'});
 const ids=['company:live0.example.eu','company:live1.example.eu'];
 let calls=0,release,entered;const nextCall=()=>new Promise(r=>entered=r);
 let ready=nextCall();
 const provider={configured:()=>true,model:'live-fixture',assess:async({documents})=>{
  calls++;const gate=new Promise(r=>release=r);entered();await gate;if(calls===2)throw Object.assign(Error('Fixture quota'),{status:429});
  const doc=documents.find(d=>d.kind==='official_page'),fact=quote=>({status:'yes',evidence:[{sourceId:doc.id,quote}]});
  return {model:'live-fixture',usage:{inputTokens:1,outputTokens:1},assessment:{business:fact('We offer business accounts for companies.'),account:fact('Open your business account with a German IBAN.'),euIban:fact('Open your business account with a German IBAN.'),utility:{status:'unknown',evidence:[]}}};
 }};
 const offline={configured:()=>false,search:async()=>{throw Error('Unexpected external request');}};
 const server=createApp({store,manual:true,provider:offline,socialProvider:offline,aiProvider:provider,aiPages:{page:async url=>({url,text,body:'<p>'+text+'</p>'})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));
 const base='http://127.0.0.1:'+server.address().port,get=async path=>(await fetch(base+path)).json(),before=await get('/api/crm');
 const response=await fetch(base+'/api/ai/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});assert.equal(response.status,202);await ready;
 const running=await get('/api/crm');assert.equal(running.ai.busy,true);assert.deepEqual(running.ai.job.candidateIds,ids);assert.equal(running.ai.job.workers[0].currentId,ids[0]);assert.match(running.ai.job.workers[0].stage,/разбирает источники/);
 ready=nextCall();release();await ready;
 const partial=await get('/api/crm'),row=partial.rows.find(r=>r.id===ids[0]);assert.equal(partial.ai.busy,true);assert.equal(partial.ai.job.done,1);assert.deepEqual(partial.ai.job.results,[ids[0]]);assert.equal(partial.ai.job.workers[0].currentId,ids[1]);
 assert.notEqual(row.detailRevision,before.rows.find(r=>r.id===ids[0]).detailRevision);assert.equal(row.facts.euIban.status,'yes');
 const detail=await get('/api/crm/item?'+new URLSearchParams({id:ids[0]}));assert.equal(detail.detailRevision,row.detailRevision);assert.equal(detail.model,'live-fixture');
 release();await server.aiReview.idle();const finished=await get('/api/crm');assert.equal(finished.ai.busy,false);assert.equal(finished.ai.job.status,'partial');assert.equal(finished.ai.job.errors[0].id,ids[1]);assert.equal(finished.ai.job.workers[0].currentId,null);assert.equal(finished.ai.job.workers[0].stage,'');
 assert.equal(finished.rows.find(r=>r.id===ids[0]).detailRevision,row.detailRevision);assert.equal(finished.rows.find(r=>r.id===ids[1]).facts,undefined);
 await get('/api/crm/item?'+new URLSearchParams({id:ids[0]}));assert.equal(calls,2);
});
