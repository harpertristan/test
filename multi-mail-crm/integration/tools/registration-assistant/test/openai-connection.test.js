import test from 'node:test';
import assert from 'node:assert/strict';
import {requestOpenAI,openAIBody} from '../lib/openai-request.js';
import {environmentAI} from '../lib/ai-settings.js';
import {playScoutSettings} from '../scripts/import-play-scout.mjs';
const config={AI_API_KEY:'synthetic-test-key-not-real',AI_MODEL:'gpt-5-mini'};
test('Play Scout aliases and default model work without changing project environment',()=>{
 const original={OPENAI_API_KEY:config.AI_API_KEY};const resolved=environmentAI(original);
 assert.equal(resolved.AI_API_KEY,config.AI_API_KEY);assert.equal(resolved.AI_MODEL,'gpt-5-mini');assert.equal(original.AI_API_KEY,undefined);
 assert.equal(environmentAI({...original,AI_MODEL:'chosen-model'}).AI_MODEL,'chosen-model');
 assert.deepEqual(playScoutSettings(`OPENAI_API_KEY='${config.AI_API_KEY}'\nOTHER_SECRET=must-not-copy`),{key:config.AI_API_KEY,model:'gpt-5-mini'});
 assert.throws(()=>playScoutSettings('BRAVE_SEARCH_API_KEY=unrelated'),/OPENAI_API_KEY/);
});
test('OpenAI errors disclose predefined diagnostics without provider messages or keys',async()=>{
 for(const [status,code,pattern] of [[401,'invalid_api_key',/ключ/],[403,'',/регион/],[404,'model_not_found',/Модель/],[429,'insufficient_quota',/средств/],[429,'rate_limit',/частоту/],[400,'unsupported_parameter',/параметры/],[500,'',/недоступен/]]){
  await assert.rejects(requestOpenAI(async()=>({ok:false,status,json:async()=>({error:{code,message:'provider echoed '+config.AI_API_KEY}})}),config,{}),e=>{assert.match(e.publicMessage,pattern);assert.equal(e.publicMessage.includes(config.AI_API_KEY),false);return true;});
 }
 await assert.rejects(requestOpenAI(async()=>{throw Error(config.AI_API_KEY);},config,{}),e=>e.publicMessage.includes('интернет')&&!e.publicMessage.includes(config.AI_API_KEY));
});
test('GPT-5 requests use low reasoning and preserve output limits',async()=>{
 assert.equal(openAIBody('gpt-5-mini',{max_completion_tokens:2048}).reasoning_effort,'low');assert.equal(openAIBody('gpt-4.1-mini',{}).reasoning_effort,undefined);
 let body;const result=await requestOpenAI(async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})};},config,{max_completion_tokens:2048,messages:[{role:'user',content:'Reply OK'}]});
 assert.equal(body.max_completion_tokens,2048);assert.equal(result.choices[0].message.content,'OK');
});
test('connection endpoint returns useful safe errors and never exposes credentials',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {once}=await import('node:events');const {createApp}=await import('../server.js');const {digest}=await import('../lib/security.js');
 const directory=mkdtempSync(join(tmpdir(),'assistant-connect-')),ai={...config};let reply={ok:false,status:401,json:async()=>({error:{message:config.AI_API_KEY}})};
 const {app,db}=createApp({dataDir:directory,ai,aiFetch:async()=>reply});db.prepare('INSERT INTO users VALUES(1,?,?)').run('test','unused');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest('test-session'),1,Date.now()+60000,'web');
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(directory,{recursive:true,force:true});});
 const call=()=>fetch(`http://127.0.0.1:${server.address().port}/api/ai-settings/test`,{method:'POST',headers:{Origin:'http://127.0.0.1:3100','X-Assistant-Request':'1',Cookie:'ra_session=test-session'}});
 let response=await call();let result=await response.json();assert.equal(response.status,502);assert.match(result.error,/ключ/);assert.equal(JSON.stringify(result).includes(config.AI_API_KEY),false);
 reply={ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})};response=await call();assert.equal(response.status,200);
 ai.AI_API_KEY='';response=await call();result=await response.json();assert.equal(response.status,503);assert.match(result.error,/Ключ OpenAI не подключён/);
});
