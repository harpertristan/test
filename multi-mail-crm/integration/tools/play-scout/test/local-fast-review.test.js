import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {LOCAL_REVIEW_SCHEMA,localEvidence,expandLocalAssessment} from '../lib/local-analysis.js';
import {ollamaProvider,localRequest} from '../lib/ollama-provider.js';
import {validateAssessment} from '../lib/ai-review.js';
import {validateLicences} from '../lib/licences.js';
import {memoryStore} from '../lib/store.js';
import {createNeuralSearch} from '../lib/neural-search.js';
import {groupedCandidates} from '../lib/neural-inbox.js';

const text='Acme offers business accounts for companies. Open a business account with a German IBAN. Our dashboard is live.';
const docs=[{id:'s1',url:'https://acme.example.eu/',text,kind:'official_page'}];
const unknown={status:'unknown',evidence:[]};
const raw=()=>({business:{status:'yes',evidence:['p1']},account:{status:'yes',evidence:['p2']},euIban:{status:'yes',evidence:['p2']},utility:unknown,availability:{status:'live',evidence:['p3']},service:{name:'Acme',evidence:['p1']},summaryRu:'Есть предложение бизнес-счёта с немецким IBAN.',translations:[{ref:'p2',translationRu:'Откройте бизнес-счёт с немецким IBAN.'}],licences:[]});
async function service(t,handle){
 const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return server.address().port;
}

test('local packet selects bounded original passages including positive and negative account claims',()=>{
 const long='General marketing with no product evidence. '.repeat(500)+' We do not issue EU IBANs. '+text;
 const packet=localEvidence([{...docs[0],text:long}]);
 assert.ok(packet.passages.size<=16);assert.ok([...packet.passages.values()].reduce((n,p)=>n+p.text.length,0)<=3600);
 for(const p of packet.passages.values())assert.ok(long.includes(p.text));
 assert.ok([...packet.passages.values()].some(p=>p.text.includes('do not issue EU IBANs')));
 assert.ok([...packet.passages.values()].some(p=>p.text.includes('German IBAN')));
});

test('compact references expand to exact source quotes and pass the existing EU IBAN validator',()=>{
 const packet=localEvidence(docs),expanded=expandLocalAssessment(raw(),packet.passages),result=validateAssessment(expanded,docs);
 assert.equal(expanded.euIban.evidence[0].quote,'Open a business account with a German IBAN.');
 assert.equal(expanded.euIban.evidence[0].sourceId,'s1');assert.equal(result.decision,'match');assert.equal(result.serviceName,'Acme');
 assert.equal(expanded.translations[0].sourceId,'s1');
});

test('invalid evidence IDs, EUR/SEPA alone and non-EU IBAN cannot become confirmed EU business accounts',()=>{
 for(const text of ['Open a business account with EUR and SEPA payments.','Open a business account with a GB IBAN.','We do not offer business accounts with a German IBAN.']){
  const source=[{...docs[0],text}],packet=localEvidence(source),r=raw();r.euIban.evidence=['p1'];
  assert.notEqual(validateAssessment(expandLocalAssessment(r,packet.passages),source).facts.euIban.status,'yes');
 }
 const r=raw();r.euIban.evidence=['p999'];assert.equal(validateAssessment(expandLocalAssessment(r,localEvidence(docs).passages),docs).facts.euIban.status,'unknown');
});

test('compact regulator quotes still require an official issuer and a literal decision date',()=>{
 const quote='On 24 October 2026, Bank of Lithuania authorised Acme UAB as an electronic money institution in Lithuania.';
 const source=[{id:'s1',url:'https://www.lb.lt/en/news/acme',kind:'official_page',text:quote}],packet=localEvidence(source);
 const r={...raw(),licences:[{type:'emi',organisation:'Acme UAB',authority:'Bank of Lithuania',country:'Lithuania',decisionDate:'2026-10-24',ref:'p1'}]};
 const expanded=expandLocalAssessment(r,packet.passages);assert.equal(validateLicences(expanded,source)[0].status,'authorised');
 assert.deepEqual(validateLicences(expanded,[{...source[0],url:'https://acme.example.eu/blog'}]),[]);
});

test('economy local requests use smaller context/output and thinking is disabled for Qwen3 only',async()=>{
 const bodies=[],p=ollamaProvider({request:async(_path,body)=>{bodies.push(body);return{message:{content:JSON.stringify(body.options.num_ctx===4096?raw():{})}};}});
 await p.assess({title:'Acme',documents:docs});await p.assess({title:'Acme',documents:docs,mode:'full'});
 assert.equal(bodies[0].stream,true);assert.equal(bodies[0].format,LOCAL_REVIEW_SCHEMA);assert.equal(bodies[0].options.num_ctx,4096);assert.equal(bodies[0].options.num_predict,1200);assert.equal(bodies[0].think,undefined);
 assert.equal(bodies[1].options.num_ctx,16384);assert.equal(p.timeoutMs('economy'),180000);assert.equal(p.timeoutMs('full'),300000);
 await p.forModel('qwen3.5:4b').assess({title:'Acme',documents:docs});assert.equal(bodies[2].think,false);
});

test('real NDJSON streaming reports progress, preserves split UTF-8, and returns final timings',async t=>{
 let first;const progressed=new Promise(r=>first=r),events=[],json=JSON.stringify(raw());
 const port=await service(t,async(req,res)=>{
  assert.equal(req.headers.authorization,undefined);let body='';for await(const chunk of req)body+=chunk;assert.equal(JSON.parse(body).stream,true);
  res.writeHead(200,{'Content-Type':'application/x-ndjson'});
  const cut=json.indexOf('предложение')+3;assert.ok(cut>3);
  const line=Buffer.from(JSON.stringify({message:{content:json.slice(0,cut)},done:false})+'\n');
  const split=line.findIndex(byte=>byte>=0xc0)+1;assert.ok(split>0);res.write(line.subarray(0,split));await new Promise(r=>setTimeout(r,10));res.write(line.subarray(split));
  await progressed;
  res.end(JSON.stringify({message:{content:json.slice(cut)},done:true,done_reason:'stop',eval_count:100,prompt_eval_count:200,eval_duration:2000000000,load_duration:500000000})+'\n');
 });
 const p=ollamaProvider({request:(path,body,options)=>localRequest(path,body,{...options,port})});
 const result=await p.assess({title:'Acme',documents:docs},{onProgress:e=>{events.push(e);if(e.outputChars)first();}});
 assert.ok(events.some(e=>e.outputChars>0&&!e.done));assert.equal(result.assessment.summaryRu,raw().summaryRu);assert.equal(result.metrics.tokensPerSecond,50);assert.equal(result.metrics.loadMs,500);
 assert.equal(validateAssessment(result.assessment,docs).decision,'match');
});

test('stream inactivity and absolute deadlines close the local connection',async t=>{
 const port=await service(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.write(JSON.stringify({message:{content:'{'},done:false})+'\n');});
 await assert.rejects(localRequest('/api/chat',{stream:true},{port,timeoutMs:1000,idleTimeoutMs:25}),{code:'LOCAL_TIMEOUT'});
 await assert.rejects(localRequest('/api/chat',{stream:true},{port,timeoutMs:25,idleTimeoutMs:1000}),{code:'LOCAL_TIMEOUT'});
});

test('cancel closes the local stream and incomplete or truncated replies cannot become assessments',async t=>{
 let entered;const ready=new Promise(r=>entered=r);
 const port=await service(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.write(JSON.stringify({message:{content:'{'},done:false})+'\n');entered();});
 const controller=new AbortController(),pending=localRequest('/api/chat',{stream:true},{port,signal:controller.signal});await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});
 const truncated=ollamaProvider({request:async()=>({done_reason:'length',message:{content:JSON.stringify(raw())}})});await assert.rejects(truncated.assess({title:'Acme',documents:docs}),{code:'LOCAL_LENGTH'});
});

test('a local failure pauses further automatic attempts while the collector retains new discoveries',async()=>{
 const store=memoryStore(),bank={appId:'co.acme.first',title:'Acme',developerWebsite:'https://acme.example.eu',url:'https://play.google.com/store/apps/details?id=co.acme.first',screeningText:text};store.state.findings.push(bank);store.state.ai.config.sources=['play'];store.state.ai.config.engine='ollama';
 let release,calls=0;const failed=new Promise(r=>release=r),job={id:'source',status:'complete',results:[]},jobs=new Map([['source',job]]);
 const control={jobs,summary:()=>({schedule:store.state.schedule,busy:false}),active:()=>null,startJob:async()=>job,idle:async()=>{await failed;store.state.findings.push({...bank,appId:'co.other.second',title:'Second',developerWebsite:'https://second.example.eu',url:'https://play.google.com/store/apps/details?id=co.other.second'});},cancel:async()=>{}};
 const review={summary:()=>({configured:true,busy:false,due:groupedCandidates(store.state).length}),startJob:async()=>{calls++;return{id:'failed-ai',candidateIds:['company:acme.example.eu'],candidateInputs:{}};},idle:async()=>{release();},job:()=>({engine:'ollama',status:'failed',errors:[{code:'LOCAL_TIMEOUT'}]}),cancel:async()=>{}};
 const neural=createNeuralSearch({store,review,monitors:{play:control}});await neural.start();await neural.idle();
 assert.equal(calls,1);assert.equal(neural.summary().aiPaused,true);assert.equal(neural.summary().status,'partial');assert.equal(store.state.findings.length,2);assert.equal(groupedCandidates(store.state).length,2);await neural.stop();
});
