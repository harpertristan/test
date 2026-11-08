// One-shot live Paperclip wakeup diagnosis. Invoked only in the trusted task-control
// container, using its existing DB and loopback auth. Never prints tokens, mail or task body.
import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";

export function classifyReason(raw) {
  const value=String(raw||"").toLowerCase().slice(0,2500);
  if(/wakeondemand\.disabled/.test(value))return "ON_DEMAND_WAKE_DISABLED";
  if(/heartbeat\.disabled/.test(value))return "HEARTBEAT_DISABLED";
  if(/budget\.blocked|insufficient budget|budget exceeded/.test(value))return "BUDGET_BLOCKED";
  if(/execution_reconciliation_required|requires.reconciliation|legacy_execution_requires_reconciliation/.test(value))
    return "EXECUTION_RECOVERY_HOLD";
  if(/environment lease|released its environment/.test(value))return "ENVIRONMENT_LEASE_HOLD";
  if(/deferred_issue_execution|issue_execution_deferred|execution_recovery/.test(value))
    return "ISSUE_EXECUTION_DEFERRED";
  if(/issue_tree_hold|issue.*blocked|unresolved blocker/.test(value))return "ISSUE_DEPENDENCY_HOLD";
  if(/company\.inactive/.test(value))return "COMPANY_INACTIVE";
  if(/scheduling_suppressed/.test(value))return "SCHEDULING_SUPPRESSED";
  if(/worktree_execution_cutoff/.test(value))return "WORKTREE_EXECUTION_CUTOFF";
  if(/wakeup_skipped/.test(value))return "WAKEUP_SKIPPED_UNSPECIFIED";
  if(/paused|terminated|pending approval/.test(value))return "AGENT_LIFECYCLE_NOT_READY";
  if(/retry is waiting for execution checks/.test(value))return "EXECUTION_CHECKS_WAIT";
  return null;
}
export function projectWake(w,issueId) {
  const payload=w?.payload && typeof w.payload==="object" ? w.payload : {};
  const nested=payload?._paperclipWakeContext??{};
  const id=[payload.issueId,payload.taskId,payload?.executionWait?.issueId,
     nested.issueId,nested.taskId].find(v=>typeof v==="string");
  return {
    status:typeof w?.status==="string"?w.status:null,
    source:typeof w?.source==="string"?w.source:null,
    reasonCode:classifyReason(w?.reason)||classifyReason(w?.error)||"UNCLASSIFIED",
    issueMatches:id===issueId,
    errorClass:classifyReason(w?.error),
    hasRun:!!w?.runId,
    requestedAt:w?.requestedAt??null
  };
}
export function projectAgent(agent) {
 const heartbeat=agent?.runtimeConfig?.heartbeat||{};
 return {
   status:typeof agent?.status==="string"?agent.status:null,
   lifecycle:typeof agent?.lifecycleState==="string"?agent.lifecycleState:null,
   heartbeatEnabled:typeof heartbeat.enabled==="boolean"?heartbeat.enabled:null,
   wakeOnDemand:typeof heartbeat.wakeOnDemand==="boolean"?heartbeat.wakeOnDemand:null,
   maxConcurrentRuns:Number.isSafeInteger(heartbeat.maxConcurrentRuns)?heartbeat.maxConcurrentRuns:null
 };
}
export function projectIssue(issue) {
 const blocker=issue?.executionBlocker;
 return {
  status:issue?.status??null,assigned:!!issue?.assigneeAgentId,
  hasExecutionLock:!!issue?.executionRunId,hasCheckoutLock:!!issue?.checkoutRunId,
  hasExecutionBlocker:!!blocker,blockerCause:classifyReason(blocker?.cause)||
    (typeof blocker?.cause==="string"&&/^[a-z0-9_.-]{1,90}$/i.test(blocker.cause)?
      blocker.cause:null),
  recoveryActionPresent:!!blocker?.recoveryActionId,
  blockerActionClass:classifyReason(blocker?.nextAction)
 };
}
const ISSUE_ID="2d95562b-a3f8-465e-bfa9-842dbd950acb";
async function getAPI(token,route){
 return new Promise(resolve=>{
  const req=http.request({hostname:"127.0.0.1",port:3100,method:"GET",path:route,
   timeout:7000,headers:{"authorization":"Bearer "+token,accept:"application/json"}},
  response=>{
   let text="";response.on("data",x=>{text+=x;if(text.length>250_000)response.destroy();});
   response.on("end",()=>{try{resolve({status:response.statusCode,
     data:JSON.parse(text)})}catch{resolve({status:response.statusCode,data:null})}});
  });
  req.on("error",()=>resolve({status:0,data:null}));
  req.on("timeout",()=>req.destroy());
  req.end();
 });
}
async function main(){
 const require=createRequire("/app/server/package.json");
 const mod=await import(require.resolve("@paperclipai/db"));
 const {eq,desc}=await import(require.resolve("drizzle-orm"));
 const identity=JSON.parse(fs.readFileSync("/run/secrets/task-control.json","utf8"));
 const db=mod.createDb(process.env.DATABASE_URL);
 const [issue]=await db.select().from(mod.issues).where(eq(mod.issues.id,ISSUE_ID)).limit(1);
 if(!issue){console.log("ISSUE_NOT_FOUND");return;}
 console.log("=== ISSUE DB METADATA ===");
 console.log(JSON.stringify({issue:"WOR-7",status:issue.status,
  assignedToHermes:issue.assigneeAgentId===identity.agentId,
  correctCompany:issue.companyId===identity.companyId,
  executionLock:!!issue.executionRunId,checkoutLock:!!issue.checkoutRunId}));
 if(mod.agents){
  try{
   const [agent]=await db.select().from(mod.agents).where(eq(mod.agents.id,identity.agentId)).limit(1);
   console.log("=== AGENT RUNTIME POLICY ===");
   console.log(JSON.stringify(projectAgent(agent)));
  }catch{console.log("AGENT_POLICY_DB_UNAVAILABLE");}
 }
 if(mod.agentWakeupRequests){
  try{
   const wakes=await db.select().from(mod.agentWakeupRequests)
    .where(eq(mod.agentWakeupRequests.agentId,identity.agentId))
    .orderBy(desc(mod.agentWakeupRequests.requestedAt)).limit(16);
   console.log("=== RECENT WAKEUPS (NO RAW ERRORS OR PAYLOADS) ===");
   for(const w of wakes){
    const projection=projectWake(w,ISSUE_ID);
    if(projection.issueMatches||w.status==="skipped")console.log(JSON.stringify(projection));
   }
  }catch{console.log("WAKEUP_DB_DIAGNOSTIC_UNAVAILABLE");}
 }else{console.log("WAKEUP_DB_TABLE_UNAVAILABLE");}
 for(const [label,route] of [
  ["ISSUE_API","/api/issues/"+ISSUE_ID],
  ["WAKE_DIAGNOSTIC","/api/issues/"+ISSUE_ID+"/diagnostics/wakes"],
  ["BLOCKER_DIAGNOSTIC","/api/issues/"+ISSUE_ID+"/diagnostics/blockers"],
  ["RECOVERY_ACTIONS","/api/issues/"+ISSUE_ID+"/recovery-actions"],
  ["AGENT_API","/api/agents/"+identity.agentId],
  ["AGENT_RUNTIME","/api/agents/"+identity.agentId+"/runtime-state"]
 ]){
   const response=await getAPI(identity.token,route);
   console.log("=== "+label+" HTTP "+response.status+" ===");
   const data=response.data;
   if(!data)continue;
   if(label==="ISSUE_API")console.log(JSON.stringify(projectIssue(data)));
   if(label==="WAKE_DIAGNOSTIC")console.log(JSON.stringify({
    diagnosisClass:classifyReason(data.diagnosis),wakeCount:data.wakeRequestCount,
    latestEvents:Array.isArray(data.events)?data.events.slice(0,5).map(x=>({
     kind:x.kind,status:x.status,reason:classifyReason(x.reason)||x.reason,
     failureClass:x.failureClass
    })):[]}));
   if(label==="BLOCKER_DIAGNOSTIC")console.log(JSON.stringify({
    diagnosisClass:classifyReason(data.diagnosis),readiness:data.readiness,
    blockerCount:Array.isArray(data.blockers)?data.blockers.length:null}));
   if(label==="RECOVERY_ACTIONS")console.log(JSON.stringify({
    hasActive:!!data.active,activeKind:data.active?.kind??data.active?.type??null,
    activeStatus:data.active?.status??null,
    actionsCount:Array.isArray(data.actions)?data.actions.length:null}));
   if(label==="AGENT_API")console.log(JSON.stringify(projectAgent(data)));
   if(label==="AGENT_RUNTIME")console.log(JSON.stringify({
    status:data.status??null,currentRunPresent:!!data.currentRunId,
    lastErrorClass:classifyReason(data.lastError),runStatus:data.currentRun?.status??null}));
 }
 console.log("=== READ ONLY. NO RETRY OR MUTATION WAS PERFORMED ===");
}
if(process.env.HERMES_DIAG_LIVE==="1") await main();
