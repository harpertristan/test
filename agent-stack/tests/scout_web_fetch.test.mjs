import test from "node:test";
import assert from "node:assert/strict";
import {parsePage,publicOpen,publicSearch,rankResearchResults,pinnedLookup} from "../scout_web_fetch.mjs";
import https from "node:https";
import net from "node:net";
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
 assert.equal(result.providerErrors.length,4);
});

test("DNS pin returns the Node 22 all:true lookup record list, never an invalid undefined IP",()=>{
 const lookup=pinnedLookup("93.184.215.14");
 lookup("example.com",{all:true,family:4},(error,records)=>{
   assert.equal(error,null);
   assert.deepEqual(records,[{address:"93.184.215.14",family:4}]);
 });
 lookup("example.com",{all:false,family:4},(error,address,family)=>{
   assert.equal(error,null);
   assert.equal(address,"93.184.215.14");
   assert.equal(family,4);
 });
});
test("Actual Node HTTPS socket uses DNS pin without ERR_INVALID_IP_ADDRESS",async()=>{
 let accepted=0;
 const server=net.createServer(socket=>{accepted++;socket.destroy();});
 await new Promise((resolve,reject)=>{
  server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
 });
 try{
  const outcome=await new Promise((resolve,reject)=>{
   const req=https.get({hostname:"example.com",port:server.address().port,path:"/",
     lookup:pinnedLookup("127.0.0.1"),timeout:3000},res=>{
      res.resume();res.on("end",()=>resolve("response"));
    });
   req.on("error",error=>{
     if(error.code==="ERR_INVALID_IP_ADDRESS")return reject(error);
     resolve(error.code||"connection-closed");
   });
   req.on("timeout",()=>req.destroy(Error("TEST_TIMEOUT")));
  });
  assert.equal(accepted,1,"The HTTPS request must reach the pinned TCP socket");
  assert.notEqual(outcome,"ERR_INVALID_IP_ADDRESS");
 }finally{
  await new Promise(resolve=>server.close(resolve));
 }
});

test("RSS search feed yields actual publisher links, not navigation links",()=>{
 const feed='<?xml version="1.0"?><rss><channel>'+
 '<item><title>Bank Alpha</title><link>https://bankalpha.example/business/</link></item>'+
 '<item><title>Bank Beta</title><link>https://bankbeta.example/uk/</link></item>'+
 '</channel></rss>';
 const parsed=parsePage(feed,"https://www.bing.com/search?format=rss",180);
 assert.deepEqual(parsed.links,["https://bankalpha.example/business/","https://bankbeta.example/uk/"]);
});

test("Search ranking rejects unrelated pages instead of presenting them as findings",()=>{
  const links=[
    "https://zhihu.com/question/123",
    "https://github.com/unrelated/project",
    "https://www.free2move.com/en-US/",
    "https://www.reddit.com/r/cars"
  ];
  assert.deepEqual(rankResearchResults(links,"Free2move official website UK LTD"),
    ["https://www.free2move.com/en-US/"]);
  assert.deepEqual(rankResearchResults(["https://zhihu.com/question/123"],"Free2move legal entity"),[]);
});
test("Public search continues to a later provider if first results are irrelevant",async()=>{
 let calls=0;
 const network={
   resolve:async()=>"8.8.8.8",
   get:async()=>({status:200,html:++calls===1?
      '<a href="https://zhihu.com/question/123">Forum</a>':
      '<a href="https://free2move.com/">Free2move</a>'})
 };
 const result=await publicSearch("Free2move UK legal entity",network);
 assert.deepEqual(result.results,["https://free2move.com/"]);
 assert.ok(calls>=2);
});
