import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import ResponseLike from 'responselike';
import {parse,parseServiceRequests,extractor} from '../lib/play-store/utils/scriptData.js';
import {liveProvider} from '../lib/provider.js';
import playApp from '../lib/play-store/app.js';
import playDeveloper from '../lib/play-store/developer.js';
const execute=promisify(execFile);
const script=value=>'<script>'+value+'</script>';
const callback=(key,data)=>script('AF_initDataCallback('+JSON.stringify({key,hash:'h',data,sideChannel:{}})+');');
const service=literal=>script('var AF_dataServiceRequests = '+literal+'; var AF_initDataChunkQueue = [];');
const put=(root,path,value)=>{let current=root;for(const key of path.slice(0,-1))current=current[key]??=[];current[path.at(-1)]=value;return root;};
function regular(i){const row=[];put(row,[0,0],'co.fixture.bank'+i);row[3]='Bank '+i;put(row,[10,4,2],'/store/apps/details?id=co.fixture.bank'+i);row[14]='Bank Developer';put(row,[8,1,0,0],0);return row;}
function paged(i){const row=[];row[2]='Bank '+i;put(row,[12,0],'co.fixture.bank'+i);put(row,[9,4,2],'/store/apps/details?id=co.fixture.bank'+i);put(row,[4,0,0,0],'Bank Developer');put(row,[4,0,0,1,4,2],'/store/apps/developer?id=fixture');return row;}

test('Play literal parser accepts real data syntax, comments, escaped strings and existing field mappings',()=>{
 const html=service("{'ds:0':{id:'abc',request:[null,true,3,'brace } and \\' quote'],},}")+callback('ds:5',[null,[null,null,['Business Bank']]]);
 const data=parse(html);assert.equal(data['ds:5'][1][2][0],'Business Bank');assert.equal(data.serviceRequestData['ds:0'].id,'abc');
 assert.deepEqual(parseServiceRequests(service("{/* harmless */'ds:2': {id:'rpc',request:[false,null]}}")),{'ds:2':{id:'rpc',request:[false,null]}});
 assert.deepEqual(extractor({name:['ds:5',1,2,0]})(data),{name:'Business Bank'});
 assert.deepEqual(parse('<html>No embedded data</html>'),{serviceRequestData:{}});
});

test('website expressions, getters and prototype keys are rejected without executing them',()=>{
 globalThis.__scoutUnsafeProbe=0;
 try{for(const text of [
  "{'ds:0':{id:'rpc',request:(globalThis.__scoutUnsafeProbe=1,[])}}",
  "{'ds:0':{id:'rpc',request:(()=>{globalThis.__scoutUnsafeProbe=2;return []})()}}",
  "{'ds:0':{get request(){globalThis.__scoutUnsafeProbe=3;return []}}}",
  "{'ds:0':{id:'rpc',request:new Array()}}",
  "{'ds:0':{id:'rpc',request:undefined}}",
  "{'ds:0':{id:'rpc',request:NaN}}",
  "{'ds:0':{id:'rpc',request:Infinity}}",
  "{'ds:0':{__proto__:{polluted:true}}}",
  "{'ds:0':{constructor:{prototype:{polluted:true}}}}",
  "{'ds:0':{id:'rpc'}};globalThis.__scoutUnsafeProbe=4"
 ]){
  // A valid declaration after a complete literal is data outside our parser's
  // scope, and is never executed. All embedded expressions must be rejected.
  if(text.includes(';globalThis'))assert.equal(parseServiceRequests(service(text))['ds:0'].id,'rpc');
  else assert.throws(()=>parseServiceRequests(service(text)),{code:'PLAY_DATA_INVALID'});
  assert.equal(globalThis.__scoutUnsafeProbe,0);assert.equal({}.polluted,undefined);
 }
 assert.throws(()=>parse(script("AF_initDataCallback({key:'ds:5',data:(globalThis.__scoutUnsafeProbe=5,[])});")),{code:'PLAY_DATA_INVALID'});
 assert.equal(globalThis.__scoutUnsafeProbe,0);
 }finally{delete globalThis.__scoutUnsafeProbe;}
});

test('malformed and excessively nested Play data fails closed without a code-execution fallback',()=>{
 for(const text of ["{'ds:0':{request:[1,2}","{'ds:0':{request:'unterminated}}","{'ds:0':{request:"+'['.repeat(140)+'0'+']'.repeat(140)+'}}'])assert.throws(()=>parseServiceRequests(service(text)),{code:'PLAY_DATA_INVALID'});
 assert.throws(()=>parse('x'.repeat(8*1024*1024+1)),{code:'PLAY_DATA_INVALID'});
 assert.throws(()=>parse(script("AF_initDataCallback({key:'__proto__',data:[]});")),{code:'PLAY_DATA_INVALID'});
});

test('real app and both developer parsers still extract product details through the literal parser',async()=>{
 const app=[];app[0]=['Fixture Business'];put(app,[12,0,0,1],'<b>Business accounts</b> with German IBAN.');put(app,[68,0],'Fixture Developer');put(app,[68,1,4,2],'/store/apps/developer?id=fixture');put(app,[69,0,5,2],'https://fixture.eu/');put(app,[79,0,0],['Finance',null,'FINANCE']);put(app,[57,0,0,0,0,1,0,0],0);put(app,[10,0],'Oct 1, 2026');
 const data=[];put(data,[1,2],app);
 const html=callback('ds:5',data)+service("{'ds:5':{id:'rpc',request:[]}}");
 const options={hooks:{beforeRequest:[opts=>new ResponseLike(200,{'content-type':'text/html'},Buffer.from(html),opts.url.href)]}};
 const card=await playApp({appId:'co.fixture.business',requestOptions:options});assert.equal(card.title,'Fixture Business');assert.equal(card.developerWebsite,'https://fixture.eu/');assert.equal(card.genreId,'FINANCE');assert.equal(card.free,true);assert.match(card.description,/Business accounts/);
 for(const devId of ['fixture','123456']){
  const dev=[];put(dev,[0,1,0,devId==='fixture'?22:21,0],devId==='fixture'?[[regular(1)]]:[regular(1)]);
  const requestOptions={hooks:{beforeRequest:[opts=>new ResponseLike(200,{},Buffer.from(callback('ds:3',dev)),opts.url.href)]}};
  const rows=await playDeveloper({devId,requestOptions});assert.equal(rows.length,1);assert.equal(rows[0].appId,'co.fixture.bank1');
 }
});

test('actual catalogue pagination crosses 250 records and emits batches without executing page scripts',async()=>{
 let pages=0;const batches=[];
 const section=[];put(section,[22,0],[[regular(0)]]);put(section,[22,1,3,1],'T0');const data=[];put(data,[0,1],[section]);
 // Use got's supported synthetic Response hook; no external requests are made.
 const hook=opts=>{
  if(opts.url.hostname!=='play.google.com')return;
  let body;if(opts.url.pathname==='/store/search')body=callback('ds:4',data)+service("{'ds:4':{id:'rpc',request:[]}}");
  else{const first=pages*100+1;pages++;const page=[];put(page,[0,0,0],Array.from({length:100},(_,i)=>paged(first+i)));put(page,[0,0,7,1],pages<3?'T'+pages:null);body=")]}'\n"+JSON.stringify([['wrb.fr','qnKhOb',JSON.stringify(page)]]);}
  return new ResponseLike(200,{'content-type':'text/html'},Buffer.from(body),opts.url.href);
 };
 const client=liveProvider({requestIntervalMs:0,requestHooks:{beforeRequest:[hook]}});
 const rows=await client.search({term:'business account',country:'de',lang:'en',onBatch:batch=>batches.push(batch.length)});assert.equal(rows.length,301);assert.equal(new Set(rows.map(r=>r.appId)).size,301);assert.equal(pages,3);assert.ok(batches.length>=4);
});

test('Play parsing and startup imports work with V8 string code generation disabled',async()=>{
 const module=new URL('../lib/play-store/utils/scriptData.js',import.meta.url).href;
 const provider=new URL('../lib/provider.js',import.meta.url).href;
 const source=`import {parseServiceRequests} from ${JSON.stringify(module)};import {liveProvider} from ${JSON.stringify(provider)};if(parseServiceRequests("<script>var AF_dataServiceRequests={'ds:0':{id:'rpc',request:[]}}; var AF_initDataChunkQueue=[];</script>")['ds:0'].id!=='rpc')throw Error('missing data');if(!liveProvider().app)throw Error('missing provider');console.log('literal-only OK');`;
 const result=await execute(process.execPath,['--disallow-code-generation-from-strings','--input-type=module','-e',source]);assert.match(result.stdout,/literal-only OK/);
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.ok(!Object.keys(lock.packages).some(name=>/google-play-scraper|es5-ext/.test(name)));
});

test('desktop launcher reports an unexpected server signal as a failure',{timeout:10000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'Scout signal '));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'scripts'));
 await copyFile(resolve('scripts/start-desktop.js'),join(root,'scripts/start-desktop.js'));await writeFile(join(root,'package.json'),JSON.stringify({type:'module',version:'4.6.1'}));
 await writeFile(join(root,'server.js'),"try{Function('return 1')();process.exit(99);}catch(e){if(!(e instanceof EvalError))throw e;console.log('code generation blocked');}setTimeout(()=>process.kill(process.pid,'SIGKILL'),100);");
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 await assert.rejects(execute(process.execPath,[join(root,'scripts/start-desktop.js')],{env:{...process.env,PORT:String(port),PLAY_SCOUT_NO_BROWSER:'1'},timeout:7000}),error=>error.code===1&&/SIGKILL/.test(error.stderr)&&/code generation blocked/.test(error.stdout));
});
