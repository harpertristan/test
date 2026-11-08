import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveReadOperation,listReadOperations} from "../three_tool_read_policy.mjs";

test("every catalog operation resolves to GET without a query or URL", () => {
  for (const op of listReadOperations()) {
    const params = Object.fromEntries(
      [...op.template.matchAll(/:([A-Za-z]+Id)/g)].map(m => [m[1], "123abc-ABC"])
    );
    const out = resolveReadOperation(op.name, params);
    assert.equal(out.method, "GET");
    assert.ok(out.path.startsWith("/"));
    if (op.name==="scout_review_item") assert.match(out.path,/^\/api\/crm\/item\?id=/);
    else assert.ok(!out.path.includes("?"));
    assert.ok(!out.path.includes("://"));
  }
});
test("rejects unknown operations and parameter injections", () => {
  assert.throws(() => resolveReadOperation("scout_shutdown"));
  assert.throws(() => resolveReadOperation("assistant_profile", {companyId:"../../etc"}));
  assert.throws(() => resolveReadOperation("assistant_profile", {companyId:"abc", url:"https://evil.test"}));
  assert.throws(() => resolveReadOperation("mail_messages", {query:"all"}));
  assert.throws(() => resolveReadOperation("__proto__"));
});

test("review operations allow exact CRM row identifiers, not arbitrary URLs or paths",()=>{
 assert.deepEqual(resolveReadOperation("scout_review_queue",{}),{
  service:"scout",method:"GET",path:"/api/crm"});
 const op=resolveReadOperation("scout_review_item",{reviewId:"app:com.example.bank"});
 assert.equal(op.path,"/api/crm/item?id=app%3Acom.example.bank");
 for(const malicious of ["../../admin","https://evil.test","id=other&secret=x","app:%2fetc%2fpasswd"])
  assert.throws(()=>resolveReadOperation("scout_review_item",{reviewId:malicious}));
});
