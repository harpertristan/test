import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveReadOperation} from "../three_tool_read_policy.mjs";
test("safe gateway routing is read only",()=>{
  assert.deepEqual(resolveReadOperation("scout_candidates"),{service:"scout",method:"GET",path:"/api/candidates"});
  assert.deepEqual(resolveReadOperation("assistant_companies"),{service:"assistant",method:"GET",path:"/api/companies"});
  assert.deepEqual(resolveReadOperation("mail_messages"),{service:"mail",method:"GET",path:"/messages"});
});
