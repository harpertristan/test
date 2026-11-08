import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {llamaCppProvider,serverRequest} from '../lib/llamacpp-provider.js';
import {reviewConfig,HARDWARE_PROFILES} from '../lib/ai-config.js';
import {workerPlan} from '../scripts/start-gpu-agent.js';
import {validateAssessment,createAIReview} from '../lib/ai-review.js';
import {reviewRouter} from '../lib/ollama-provider.js';
import {memoryStore} from '../lib/store.js';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import net from 'node:net';
const text='Acme offers business accounts for companies. Open a business account with a German IBAN.',documents=[{id:'s1',url:'https://acme.example.eu/',kind:'official_page',text}],unknown={status:'unknown',evidence:[]};
const answer=()=>({business:{status:'yes',evidence:['p1']},account:{status:'yes',evidence:['p2']},euIban:{status:'yes',evidence:['p2']},utility:unknown,summaryRu:'Бизнес-счёт с немецким IBAN через провайдера.',translations:[],licences:[],service:{name:'Acme',evidence:['p1']},availability:{status:'unknown',evidence:[]}});
async function service(t,handle){const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return'http://127.0.0.1:'+server.address().port;}
test('profiles distinguish Windows GPU, Mac shared memory and six independent workers',()=>{
 assert.equal(HARDWARE_PROFILES['mac-m5-16gb'].localEndpoints.length,1);assert.equal(HARDWARE_PROFILES['farm-6gpu'].localEndpoints.length,6);assert.notEqual(HARDWARE_PROFILES['farm-6gpu'].localModel,HARDWARE_PROFILES['windows-8gb'].localModel);
 const c=reviewConfig({...HARDWARE_PROFILES['farm-6gpu']});assert.equal(c.engine,'llamacpp');assert.equal(c.mode,'economy');assert.equal(c.enabled,false);assert.throws(()=>reviewConfig({localEndpoints:['file:///etc/passwd']}));assert.throws(()=>reviewConfig({localEndpoints:['http://user:secret@127.0.0.1:8081']}));assert.throws(()=>reviewConfig({localEndpoints:['http://127.0.0.1:8081/v1']}));
});
test('launcher pins one CUDA device per process and uses one 4096-token slot; Mac uses Metal',()=>{
 const plan=workerPlan({server:'C:/llama/llama-server.exe',model:'C:/models/qwen2.5-7b-instruct-q4_k_m.gguf',gpus:'0,1,2,3,4,5',platform:'win32'});assert.equal(plan.length,6);for(const [i,w]of plan.entries()){assert.equal(w.env.CUDA_VISIBLE_DEVICES,String(i));assert.equal(w.port,8081+i);assert.equal(w.args[w.args.indexOf('--parallel')+1],'1');assert.equal(w.args[w.args.indexOf('--ctx-size')+1],'4096');assert.equal(w.args[w.args.indexOf('--split-mode')+1],'none');}
 const mac=workerPlan({server:'/Applications/llama/llama-server',model:'/tmp/model.gguf',platform:'darwin'});assert.equal(mac.length,1);assert.equal(mac[0].gpu,null);assert.throws(()=>workerPlan({server:'x',model:'m.gguf',gpus:'0,0'}));assert.throws(()=>workerPlan({server:'x',model:'m.gguf',gpus:'0',platform:'darwin'}));
});
test('GPU pool leases different endpoints concurrently and releases them after errors',async()=>{
 let release;const gate=new Promise(r=>release=r),entered=[];const p=llamaCppProvider({endpoints:['http://127.0.0.1:8081','http://127.0.0.1:8082'],request:async(endpoint,_path,body)=>{entered.push(endpoint);assert.equal(body.stream,true);assert.ok(body.response_format.json_schema.schema.properties.euIban);await gate;return{content:JSON.stringify(answer()),finishReason:'stop',usage:{prompt_tokens:100,completion_tokens:50}};}});
 const first=p.assess({title:'Acme',documents}),second=p.assess({title:'Acme',documents});await assert.rejects(p.assess({title:'Acme',documents}),{code:'LOCAL_POOL'});assert.equal(new Set(entered).size,2);release();const results=await Promise.all([first,second]);assert.equal(validateAssessment(results[0].assessment,documents).decision,'match');await p.assess({title:'Acme',documents});assert.equal(p.concurrency,2);
 const broken=llamaCppProvider({request:async()=>{throw Error('offline');}});await assert.rejects(broken.assess({documents}));await assert.rejects(broken.assess({documents}),/offline/);
});
test('real SSE handles split Russian UTF-8, usage, schema and model readiness',async t=>{
 const endpoint=await service(t,async(req,res)=>{if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'play-scout-local'}]}));return;}let raw='';for await(const b of req)raw+=b;assert.equal(JSON.parse(raw).response_format.json_schema.strict,true);assert.equal(req.headers.authorization,undefined);res.writeHead(200,{'Content-Type':'text/event-stream'});const line=Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(answer())},finish_reason:null}]})+'\n\n');const split=line.findIndex(b=>b>=0xc0)+1;res.write(line.subarray(0,split));res.write(line.subarray(split));res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');});
 const progress=[],p=llamaCppProvider({endpoints:[endpoint]});assert.equal((await p.status()).installed,true);const r=await p.assess({title:'Acme',documents},{onProgress:e=>progress.push(e)});assert.equal(r.usage.inputTokens,20);assert.equal(r.assessment.summaryRu,answer().summaryRu);assert.ok(progress.some(e=>e.outputChars>0));
});
test('truncation, broken JSON, timeout and cancellation cannot produce completed assessments',async t=>{
 const p=llamaCppProvider({request:async()=>({content:JSON.stringify(answer()),finishReason:'length'})});await assert.rejects(p.assess({documents}),{code:'LOCAL_LENGTH'});
 const endpoint=await service(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"{"}}]}\n\n');});
 await assert.rejects(serverRequest(endpoint,'/v1/chat/completions',{}, {timeoutMs:500,idleTimeoutMs:25}),{code:'LOCAL_TIMEOUT'});const c=new AbortController(),pending=serverRequest(endpoint,'/v1/chat/completions',{}, {signal:c.signal});c.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('review pool processes once per candidate, respects exclusions and never calls paid AI',async()=>{
 const store=memoryStore(),calls=[];for(let i=0;i<5;i++)store.state.findings.push({appId:'co.acme.'+i,title:'Acme '+i,url:'https://play.google.com/store/apps/details?id=co.acme.'+i,developerWebsite:'https://acme'+i+'.example.eu/',screeningText:text});store.state.manualExclusions.push({key:'blocked',kind:'app',value:'co.acme.0'});store.state.ai.config=reviewConfig({...HARDWARE_PROFILES['farm-6gpu'],localEndpoints:['http://127.0.0.1:8081','http://127.0.0.1:8082']});let inFlight=0,peak=0,paid=0;
 const local=llamaCppProvider({endpoints:store.state.ai.config.localEndpoints,model:store.state.ai.config.localModel,request:async(endpoint,_path,body)=>{calls.push(JSON.parse(body.messages[1].content).title);inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,20));inFlight--;return{content:JSON.stringify(answer()),finishReason:'stop',usage:{prompt_tokens:1,completion_tokens:1}};}});
 const provider=reviewRouter({store,llamacpp:local,openai:{configured:()=>true,model:'paid',assess:async()=>{paid++;}}}),review=createAIReview({store,provider,pages:{page:async url=>({url,text,body:''})}});await review.startJob();await review.idle();assert.equal(paid,0);assert.equal(calls.length,4);assert.equal(new Set(calls).size,4);assert.equal(peak,2);assert.equal(review.results().length,4);assert.equal(review.summary().usage.attempts,4);assert.equal(review.summary().openAIUsage.attempts,0);assert.equal(review.summary().due,0);
});
test('launcher waits for each model to become ready before loading the next and stops the whole pool', {timeout:15000,skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'gpu-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));const binary=join(root,'fake-server'),model=join(root,'model.gguf'),log=join(root,'events.jsonl');
 await writeFile(model,'fixture');await writeFile(binary,`#!/usr/bin/env node
const http=require('http'),fs=require('fs'),args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1]),gpu=process.env.CUDA_VISIBLE_DEVICES;
const event=kind=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({gpu,kind,at:Date.now()})+'\\n');let ready=false;event('start');
const server=http.createServer((q,r)=>{r.statusCode=ready?200:503;r.end('{}');});server.listen(port,'127.0.0.1',()=>setTimeout(()=>{ready=true;event('ready');},100));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`,{mode:0o755});
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const second=net.createServer();await new Promise((r,j)=>{second.once('error',j);second.listen(port+1,'127.0.0.1',r);});await new Promise(r=>second.close(r));
 const child=spawn(process.execPath,['scripts/start-gpu-agent.js','--server',binary,'--model',model,'--gpus','0,1','--port',String(port)],{stdio:['ignore','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const exited=new Promise(r=>child.once('exit',r));
 const deadline=Date.now()+7000;while(!output.includes('Обработчик готов: '+(port+1))&&Date.now()<deadline&&child.exitCode===null)await new Promise(r=>setTimeout(r,30));assert.ok(output.includes('Обработчик готов: '+(port+1)),output);
 const events=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(events.find(e=>e.gpu==='1'&&e.kind==='start').at>=events.find(e=>e.gpu==='0'&&e.kind==='ready').at);child.kill('SIGTERM');assert.equal(await exited,0);
});
