import test from "node:test";
import assert from "node:assert/strict";
import {needsReview,reviewQueue,reviewItem} from "../scout_review_projection.mjs";
const base={id:"app:com.example.bank",title:"Acme UK Business Account",status:"review",
  url:"https://bank.example/business",appId:"com.example.bank",sources:["play"],
  facts:{business:{status:"yes"},account:{status:"unknown"},euIban:{status:"unknown"}},
  screening:{eligible:true},detailRevision:"a".repeat(64),worked:false,manualExcluded:false,
  documents:[{url:"https://bank.example/terms",title:"Terms",text:"Business accounts provided to UK incorporated limited companies."}],
  notes:"CONFIDENTIAL PRIVATE NOTE alice@example.com",password:"NEVER_EXPOSE_SECRET"};
test("Exact Play Scout CRM needs_review criteria keep actionable unknowns",()=>{
 assert.equal(needsReview(base),true);
 for(const status of ["rejected","excluded","auto_excluded","known","reference","source_archive","approved","confirmed","selected"])
   assert.equal(needsReview({...base,status}),false,status);
 assert.equal(needsReview({...base,worked:true}),false);
 assert.equal(needsReview({...base,manualExcluded:true}),false);
 assert.equal(needsReview({...base,screening:{eligible:false}}),false);
 assert.equal(needsReview({...base,screening:{eligible:false},manualStatusAt:"2026-11-08"}),true);
});
test("Queue returns bounded, filtered candidates without confidential CRM notes or raw snapshot",()=>{
 const snapshot={rows:[base,{...base,id:"x",title:"Another"},
   {...base,id:"excluded",status:"excluded"}],privateData:"PRIVATE_DETAILS"};
 const q=reviewQueue(snapshot,1);
 assert.equal(q.count,2);assert.equal(q.items.length,1);assert.equal(q.truncated,true);
 assert.equal(q.items[0].facts.business,"yes");assert.equal(q.items[0].facts.euIban,"unknown");
 assert.ok(!JSON.stringify(q).includes("CONFIDENTIAL"));
 assert.ok(!JSON.stringify(q).includes("alice@example.com"));
 assert.ok(!JSON.stringify(q).includes("NEVER_EXPOSE_SECRET"));
 assert.throws(()=>reviewQueue({},20));
 assert.throws(()=>reviewQueue(snapshot,300));
});
test("Scoped item projection carries documentary evidence but never arbitrary app data",()=>{
 const row=reviewItem(base,{detail:true});
 assert.equal(row.id,base.id);
 assert.equal(row.evidence[0].source,"https://bank.example/terms");
 assert.equal(row.evidence[0].excerpt,"Business accounts provided to UK incorporated limited companies.");
 assert.equal(row.totalDocuments,1);
 assert.ok(!JSON.stringify(row).includes("PRIVATE NOTE"));
 assert.ok(!JSON.stringify(row).includes("alice@example.com"));
});
