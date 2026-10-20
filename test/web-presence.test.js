import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWebPresence,dashboardLinks,webPresenceLabel} from '../lib/web-presence.js';
import {collectEvidence} from '../lib/ai-review.js';
import {memoryStore} from '../lib/store.js';
import {inboxEntry} from '../lib/neural-inbox.js';
import {buildReport,reportCSV,reportHTML} from '../lib/report.js';
const url='https://bank.example.eu/';
test('a site or Android account screen does not establish a web service or web cabinet',()=>{
 for(const text of ['We offer business accounts with a German IBAN.','Our Android app has a dashboard. Log in to your account.']){
  const result=assessWebPresence([{url:'https://play.google.com/store/apps/details?id=com.bank',text,kind:'listing'}],{productURL:url});assert.equal(result.service.status,'unknown');assert.equal(result.cabinet.status,'unknown');
 }
});
test('web service and web cabinet are distinct evidence-based markers, including unknown and future products',()=>{
 const platform=assessWebPresence([{url,text:'Our web platform provides business accounts.',kind:'official_page'}],{productURL:url});assert.equal(platform.service.status,'mentioned');assert.equal(platform.cabinet.status,'unknown');
 const access=assessWebPresence([{url,text:'Manage your accounts through our web dashboard in your browser.',kind:'official_page'}],{productURL:url});assert.equal(access.service.status,'mentioned');assert.equal(access.cabinet.status,'mentioned');
 const future=assessWebPresence([{url,text:'Our web app is coming soon. Online banking is not available.',kind:'official_page'}],{productURL:url});assert.equal(future.service.status,'unknown');assert.equal(future.cabinet.status,'unknown');
 for(const text of ['We do not provide web banking.','Web banking is not supported.']){const absent=assessWebPresence([{url,text,kind:'official_page'}],{productURL:url});assert.equal(absent.service.status,'unknown');assert.equal(absent.cabinet.status,'unknown');}
 const publisher=assessWebPresence([{url:'https://publisher.example/news',text:'Bank offers online banking.',kind:'third_party'}],{productURL:url});assert.equal(publisher.cabinet.status,'unknown');
});
test('cabinet links come from actual same-site anchors without guessing paths or logging in',()=>{
 const links=dashboardLinks('<a href="https://app.bank.example.eu/login">Log in</a><a href="https://evil.example/login">Log in</a><a href="javascript:alert(1)">Log in</a><a href="/sign-up">Register</a>',url);assert.deepEqual(links,['https://app.bank.example.eu/login']);
 const result=assessWebPresence([{url,text:'We offer business accounts.',kind:'official_page',dashboardLinks:links}],{productURL:url});assert.equal(result.cabinet.status,'link_found');assert.equal(result.service.status,'mentioned');assert.match(webPresenceLabel(result.cabinet),/вход не проверен/);
});
test('AI research retains web access text and actual login links from the public page, without visiting the cabinet',async()=>{
 const calls=[],controller=new AbortController();const evidence=await collectEvidence({title:'Bank',section:'web',url,developerWebsite:url},{signal:controller.signal,pages:{page:async link=>{calls.push(link);return{url,text:'Business account.\nProduct details.\nOur web platform.\nUse the web dashboard.',body:'<a href="/login">Log in</a>'};}}});
 assert.deepEqual(calls,[url]);const result=assessWebPresence(evidence.documents,{productURL:url});assert.equal(result.service.status,'mentioned');assert.equal(result.cabinet.status,'link_found');assert.deepEqual(result.cabinet.links,[url+'login']);
});
test('reports and CSV include both independent web markers and their supporting sources',()=>{
 const now=new Date('2026-10-20T10:00:00Z'),s=memoryStore(now).state;s.ai.inbox.push(inboxEntry({url,title:'Test bank',snippet:'Our web platform provides business accounts.'},'web',now));
 const report=buildReport(s,{},now),html=reportHTML(report),csv=reportCSV(report);assert.match(html,/Веб-сервис/);assert.match(html,/Веб-кабинет/);assert.match(csv,/Веб-сервис/);assert.equal(report.rows[0].webPresence.service.status,'mentioned');assert.equal(report.rows[0].webPresence.cabinet.status,'unknown');
});
