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
  scout_review_queue: {service:"scout", method:"GET", template:"/api/crm"},
  scout_review_item: {service:"scout", method:"GET", template:"/api/crm/item?id=:reviewId"},
  scout_web_candidates: {service:"scout", method:"GET", template:"/api/web/candidates"},
  scout_web_findings: {service:"scout", method:"GET", template:"/api/web/findings"},
  scout_web_monitor: {service:"scout", method:"GET", template:"/api/web/monitor"},
  scout_web_active: {service:"scout", method:"GET", template:"/api/web/active"},
  scout_social_candidates: {service:"scout", method:"GET", template:"/api/social/candidates"},
  scout_social_findings: {service:"scout", method:"GET", template:"/api/social/findings"},
  scout_social_monitor: {service:"scout", method:"GET", template:"/api/social/monitor"},
  scout_social_active: {service:"scout", method:"GET", template:"/api/social/active"},
  scout_watch_candidates: {service:"scout", method:"GET", template:"/api/watch/candidates"},
  scout_watch_findings: {service:"scout", method:"GET", template:"/api/watch/findings"},
  scout_watch_monitor: {service:"scout", method:"GET", template:"/api/watch/monitor"},
  scout_watch_active: {service:"scout", method:"GET", template:"/api/watch/active"},
  scout_ai_inbox: {service:"scout", method:"GET", template:"/api/ai/inbox"},
  scout_ai_results: {service:"scout", method:"GET", template:"/api/ai/results"},
  scout_ai_monitor: {service:"scout", method:"GET", template:"/api/ai/monitor"},
  scout_neural_monitor: {service:"scout", method:"GET", template:"/api/neural/monitor"},
  scout_companies: {service:"scout", method:"GET", template:"/api/companies"},
  scout_licences: {service:"scout", method:"GET", template:"/api/licences"},
  assistant_companies: {service:"assistant", method:"GET", template:"/api/companies"},
  assistant_profile: {service:"assistant", method:"GET", template:"/api/companies/:companyId/profile"},
  assistant_facts: {service:"assistant", method:"GET", template:"/api/companies/:companyId/facts"},
  assistant_review: {service:"assistant", method:"GET", template:"/api/companies/:companyId/review"},
  assistant_extracted: {service:"assistant", method:"GET", template:"/api/companies/:companyId/extracted"},
  assistant_documents: {service:"assistant", method:"GET", template:"/api/companies/:companyId/documents"},
  assistant_diagnostics: {service:"assistant", method:"GET", template:"/api/companies/:companyId/diagnostics"},
  assistant_corrections: {service:"assistant", method:"GET", template:"/api/companies/:companyId/corrections"},
  assistant_ai_plan: {service:"assistant", method:"GET", template:"/api/companies/:companyId/analyze-ai-plan"},
  mail_messages: {service:"mail", method:"GET", template:"/messages"},
  mail_message: {service:"mail", method:"GET", template:"/messages/:messageId"},
  mail_tasks: {service:"mail", method:"GET", template:"/tasks"},
  mail_companies: {service:"mail", method:"GET", template:"/companies"},
  mail_company_detail: {service:"mail", method:"GET", template:"/companies/:mailCompanyId"},
  mail_accounts: {service:"mail", method:"GET", template:"/accounts"},
  mail_notifications: {service:"mail", method:"GET", template:"/notifications"},
  mail_workspace: {service:"mail", method:"GET", template:"/workspace"}
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
    if (typeof params[id] !== "string" || !(id === "reviewId" ? /^[A-Za-z0-9:._-]{1,160}$/.test(params[id]) : IDENTIFIER.test(params[id])))
      throw new Error("Invalid identifier");
    path = path.replace(":" + id, encodeURIComponent(params[id]));
  }
  return Object.freeze({service:op.service, method:"GET", path});
}
