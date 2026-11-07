/**
 * Explicit read-only operation catalog for a future task-bound Hermes adapter.
 * This module performs validation ONLY. It performs no network requests and
 * grants no authorization. A caller MUST additionally authenticate the task
 * run, enforce company scope, and route through a restricted sidecar.
 */
const OPERATIONS = Object.freeze({
  scout_candidates: {service:"scout", method:"GET", template:"/api/candidates"},
  scout_findings: {service:"scout", method:"GET", template:"/api/findings"},
  scout_monitor: {service:"scout", method:"GET", template:"/api/monitor"},
  scout_active: {service:"scout", method:"GET", template:"/api/active"},
  assistant_companies: {service:"assistant", method:"GET", template:"/api/companies"},
  assistant_profile: {service:"assistant", method:"GET", template:"/api/companies/:companyId/profile"},
  assistant_facts: {service:"assistant", method:"GET", template:"/api/companies/:companyId/facts"},
  assistant_review: {service:"assistant", method:"GET", template:"/api/companies/:companyId/review"},
  assistant_extracted: {service:"assistant", method:"GET", template:"/api/companies/:companyId/extracted"},
  mail_messages: {service:"mail", method:"GET", template:"/messages"},
  mail_message: {service:"mail", method:"GET", template:"/messages/:messageId"},
  mail_tasks: {service:"mail", method:"GET", template:"/tasks"},
  mail_companies: {service:"mail", method:"GET", template:"/companies"}
});
const IDENTIFIER = /^[A-Za-z0-9_-]{1,80}$/;
export function listReadOperations() {
  return Object.entries(OPERATIONS).map(([name, value]) => ({name, ...value}));
}
export function resolveReadOperation(name, params = {}) {
  if (typeof name !== "string" || !Object.hasOwn(OPERATIONS, name))
    throw new Error("Unknown read operation");
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new Error("Invalid parameters");
  const op = OPERATIONS[name];
  const placeholders = [...op.template.matchAll(/:([A-Za-z]+Id)/g)].map(m => m[1]);
  if (Object.keys(params).sort().join(",") !== [...placeholders].sort().join(","))
    throw new Error("Unexpected or missing parameters");
  let path = op.template;
  for (const id of placeholders) {
    if (typeof params[id] !== "string" || !IDENTIFIER.test(params[id]))
      throw new Error("Invalid identifier");
    path = path.replace(":" + id, encodeURIComponent(params[id]));
  }
  return Object.freeze({service:op.service, method:"GET", path});
}
