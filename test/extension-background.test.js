import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('extension service worker limits destinations, sender access and API scope',async()=>{
  let listener,settings={},calls=[];
  const extensionId='a'.repeat(32),optionsUrl=`chrome-extension://${extensionId}/options.html`;
  const chrome={runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,openOptionsPage:async()=>{},onMessage:{addListener:fn=>{listener=fn;}}},action:{onClicked:{addListener:()=>{}}},storage:{session:{get:async()=>settings,set:async value=>{settings={...settings,...value};},clear:async()=>{settings={};}}},permissions:{contains:async()=>true},tabs:{get:async()=>({url:'https://bank.example/application'})}};
  vm.runInNewContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),{chrome,URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({companies:[]})};}});
  const send=(message,sender={id:extensionId,url:optionsUrl})=>new Promise(resolve=>listener(message,sender,resolve));
  let result=await send({type:'settings',origin:'http://public.example',token:'a'.repeat(43)});assert.equal(result.ok,false);
  result=await send({type:'settings',origin:'https://assistant.example',token:'a'.repeat(43)});assert.equal(result.ok,true);
  result=await send({type:'settings',disconnect:true},{id:extensionId,url:'https://bank.example/application',tab:{id:1}});assert.equal(result.ok,false);
  result=await send({type:'api',path:'/companies'},{id:extensionId,url:'https://bank.example/application',tab:{id:1}});assert.equal(result.ok,true);assert.equal(calls[0].url,'https://assistant.example/api/companies');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.headers.Authorization,'Bearer '+'a'.repeat(43));assert.equal(result.token,undefined);
  result=await send({type:'api',path:'/extension-token',method:'POST'},{id:extensionId,tab:{id:1}});assert.equal(result.ok,false);
  result=await send({type:'api',path:'/propose',method:'POST',body:{host:'another.example'}},{id:extensionId,tab:{id:1}});assert.equal(result.ok,false);
  result=await send({type:'api',path:'/companies'},{id:'other-extension',tab:{id:1}});assert.equal(result.ok,false);
  assert.equal(calls.length,1);
  result=await send({type:'settings',origin:'https://scout.example/assistant/',token:'a'.repeat(43)});assert.equal(result.ok,true);
  result=await send({type:'api',path:'/companies'},{id:extensionId,url:'https://bank.example/application',tab:{id:1}});assert.equal(result.ok,true);assert.equal(calls.at(-1).url,'https://scout.example/assistant/api/companies');
  result=await send({type:'settings',origin:'https://scout.example/other/',token:'a'.repeat(43)});assert.equal(result.ok,false);
});

test('action requests only embedded origins and chooses the form frame; API requests stay bound to sender frame',async()=>{
 let action,listener;const scripts=[],id='b'.repeat(32),frames=[{frameId:0,url:'https://bank.example/app'},{frameId:7,url:'https://verify.example/flow'}];let requested;
 const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:{addListener:f=>listener=f},openOptionsPage:async()=>{throw Error('unexpected options')}},action:{onClicked:{addListener:f=>action=f}},webNavigation:{getAllFrames:async()=>frames,getFrame:async()=>frames[1]},permissions:{request:async v=>{requested=v;return true}},scripting:{executeScript:async arg=>{scripts.push(arg);if(arg.files?.[0]==='dom.js'&&arg.files.length===1)return [{frameId:0},{frameId:7}];if(arg.func&&arg.target.frameIds?.length===2&&String(arg.func).includes('entries'))return [{frameId:0,result:{fields:15}},{frameId:7,result:{fields:5}}];return [];}},storage:{session:{get:async()=>({origin:'https://assistant.example',token:'synthetic-token'})}},tabs:{get:async()=>({url:frames[0].url})}};
 vm.runInNewContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),{chrome,URL,AbortSignal,fetch:async()=>({ok:true,json:async()=>({})})});
 await action({id:1,url:frames[0].url});assert.equal(requested.origins.join(','),'https://bank.example/*,https://verify.example/*');assert.equal(scripts.at(-1).target.frameIds[0],7);assert.equal(scripts.at(-1).files.join(','),'dom.js,panel.js');
 const send=body=>new Promise(resolve=>listener({type:'api',path:'/propose',method:'POST',body},{id,tab:{id:1},frameId:7,url:frames[1].url},resolve));
 assert.equal((await send({host:'verify.example'})).ok,true);assert.equal((await send({host:'bank.example'})).ok,false);
});
