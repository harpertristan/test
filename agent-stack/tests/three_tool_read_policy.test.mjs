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
    assert.ok(!out.path.includes("?"));
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
