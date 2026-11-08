import test from "node:test";
import assert from "node:assert/strict";
import {parsePage,publicOpen,publicSearch} from "../scout_web_fetch.mjs";
test("Google Play page exposes official linked website for investigation",()=>{
 const html='<html><head><title>Acme Bank — Apps on Google Play</title>'+
 '<meta name="description" content="Mobile banking app for UK businesses"></head>'+
 '<body><p>Developer: ACME Bank LTD</p>'+
 '<a href="https://acmebank.example/business">Developer website</a>'+
 '<a href="/store/apps/details?id=acme.bank">Play listing</a></body></html>';
 const result=parsePage(html,"https://play.google.com/store/apps/details?id=acme.bank");
 assert.match(result.title,/Acme Bank/);
 assert.match(result.text,/ACME Bank LTD/);
 assert.ok(result.links.includes("https://acmebank.example/business"));
 assert.ok(result.links.some(x=>x.startsWith("https://play.google.com/")));
});
test("Redirect always revalidates protocol and public address",async()=>{
 const network={
  resolve:async host=>host==="bank.example"?"8.8.8.8":"127.0.0.1",
  get:async()=>({status:301,redirect:"https://localhost/admin"})
 };
 await assert.rejects(()=>publicOpen("https://bank.example/",network));
 const privateRedirect={
  resolve:async host=>host==="bank.example"?"8.8.8.8":"127.0.0.1",
  get:async()=>({status:301,redirect:"https://intranet.example/"})
 };
 await assert.rejects(()=>publicOpen("https://bank.example/",privateRedirect),/NON_PUBLIC_ADDRESS/);
});
test("Public open resolves and fetches using pinned public address",async()=>{
 let checked=false;
 const network={
  resolve:async host=>{assert.equal(host,"official.example");return "8.8.8.8";},
  get:async(url,ip)=>{
    assert.equal(ip,"8.8.8.8");
    assert.equal(url.hostname,"official.example");checked=true;
    return {status:200,html:"<title>UK Business Accounts</title><p>GBP and EUR account support</p>"};
  }
 };
 const page=await publicOpen("https://official.example/business",network);
 assert.ok(checked);
 assert.match(page.text,/GBP and EUR/);
 assert.equal(page.status,200);
 assert.equal(page.sourceUrl,"https://official.example/business");
});
test("Search discovers direct candidate links but does not label them verified",async()=>{
 const network={
  resolve:async()=>"8.8.8.8",
  get:async()=>({status:200,html:'<title>Results</title>'+
    '<a href="/url?q=https%3A%2F%2Fdirect-bank.example%2Fbusiness">Official candidate</a>'+
    '<a href="https://google.com/">Search</a>'})
 };
 const result=await publicSearch("Bank App official developer website UK",network);
 assert.ok(result.results.includes("https://direct-bank.example/business"));
 assert.ok(!result.results.includes("https://google.com/"));
 assert.equal(result.provider,"www.google.com");
});
test("Provider search failures are explicit, never invented findings",async()=>{
 const network={
  resolve:async()=>"8.8.8.8",
  get:async()=>{throw Error("REMOTE_HTTP_429");}
 };
 const result=await publicSearch("UK EMI banks",network);
 assert.deepEqual(result.results,[]);
 assert.equal(result.code,"SEARCH_RESULTS_UNAVAILABLE");
 assert.equal(result.providerErrors.length,2);
});
