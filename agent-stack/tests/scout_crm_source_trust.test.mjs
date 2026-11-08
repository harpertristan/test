import test from "node:test";
import assert from "node:assert/strict";
import {crmContainsPublicSite} from "../scout_crm_source_trust.mjs";
const rows=[{id:"company:free2move.com",developerWebsite:"https://free2move.com/",status:"new"}];
test("CRM exact hostname and www are valid read-only provenance",()=>{
 assert.equal(crmContainsPublicSite(rows,"https://www.free2move.com/"),true);
 assert.equal(crmContainsPublicSite(rows,"https://free2move.com/en/terms"),true);
});
test("CRM provenance refuses unrelated and malicious lookalike hostnames",()=>{
 for(const url of ["https://notfree2move.com/","https://free2move.com.evil.example/",
  "http://free2move.com/","https://free2move.com:8443/","https://localhost/",
  "https://free2move.com/?email=alice%40example.com"]) {
  assert.equal(crmContainsPublicSite(rows,url),false,url);
 }
});
test("No evidence means no authorization",()=>{
 assert.equal(crmContainsPublicSite([],"https://free2move.com/"),false);
 assert.equal(crmContainsPublicSite([{url:"http://free2move.com/"}],"https://free2move.com/"),false);
});

test("CRM website field authorizes its matching public HTTPS host",()=>{
 assert.equal(crmContainsPublicSite([{id:"company:free2move.com",
  website:"https://free2move.com/"}],"https://www.free2move.com/terms"),true);
});
