import test from 'node:test';import assert from 'node:assert/strict';import{cachedPageProvider}from'../lib/page-cache.js';
test('concurrent requests share one fetch and keep successful pages reusable',async()=>{
 let calls=0,release;const ready=new Promise(r=>release=r),provider=cachedPageProvider({page:async()=>{calls++;await ready;return{body:'abc',text:'def'};}});const a=provider.page('https://a.eu'),b=provider.page('https://a.eu');await Promise.resolve();assert.equal(calls,1);release();assert.deepEqual(await a,await b);await provider.page('https://a.eu');assert.equal(calls,1);
});
test('an uncooperative cancelled fetch cannot freeze later requests or poison their cache',async()=>{
 let calls=0,release;const old=new Promise(r=>release=r),controller=new AbortController(),provider=cachedPageProvider({page:async()=>{calls++;return calls===1?old:{text:'current'};}});const first=provider.page('https://a.eu',{signal:controller.signal});await Promise.resolve();controller.abort();await assert.rejects(first);assert.equal((await provider.page('https://a.eu')).text,'current');release({text:'obsolete'});await Promise.resolve();await Promise.resolve();assert.equal((await provider.page('https://a.eu')).text,'current');assert.equal(calls,2);
});
test('expired and evicted pages can be fetched again without limiting requests or returned content',async()=>{
 let now=0,calls=0;const provider=cachedPageProvider({page:async url=>{calls++;return{body:'abc',url};}},{clock:()=>now,ttlMs:10,maxBytes:6});for(const url of['a','b','c'])assert.equal((await provider.page(url)).url,url);assert.equal(calls,3);await provider.page('b');assert.equal(calls,3);await provider.page('a');assert.equal(calls,4);now=20;await provider.page('a');assert.equal(calls,5);
});
test('a rejected fetch never retains a pending cache entry',async()=>{
 let calls=0;const provider=cachedPageProvider({page:async()=>{if(++calls===1)throw Error('temporary failure');return{text:'recovered'};}});await assert.rejects(provider.page('a'));assert.equal((await provider.page('a')).text,'recovered');assert.equal(calls,2);
});
