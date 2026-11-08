// Live task-continuation recovery for a blocked Paperclip issue.
// NO database writes, direct SQL repairs, permission bypasses, token printing,
// outgoing email, or replays of old agent tool calls.
// The only mutation is native creation of one related child task in the same
// company, and a normal wakeup. The old issue and recovery evidence stay intact.
import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

export const SOURCE_ID="2d95562b-a3f8-465e-bfa9-842dbd950acb";
export const RECOVERY_TITLE="Продолжение исследования UK банков и EMI — WOR-7";
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function continuationPayload(issue, identity){
 if(!issue || issue.id!==SOURCE_ID || issue.identifier!=="WOR-7" ||
    issue.assigneeAgentId!==identity?.agentId ||
    issue.companyId!==identity?.companyId ||
    !UUID.test(identity.agentId) || !UUID.test(identity.companyId))
   throw Error("ISSUE_ASSIGNMENT_MISMATCH");
 if(issue.status!=="todo")throw Error("ISSUE_NOT_TODO");
 if(issue.executionRunId||issue.checkoutRunId)throw Error("ISSUE_STILL_LOCKED");
 const description=issue.description;
 if(typeof description!=="string"||description.length<20||description.length>25000)
   throw Error("SOURCE_DESCRIPTION_UNSAFE");
 const reminder=[
  "Продолжение исходной задачи WOR-7 после блокировки выполнения Paperclip.",
  "Исходная задача сохранена со всей историей. Не повторяй действия предыдущих запусков.",
  "Работай с публичными источниками через web_research и Scout.",
  "Проверяй официальный сайт, юридическое лицо, лицензии, UK LTD, EUR/GBP, SEPA/SWIFT.",
  "Не отправляй письма, не загружай документы наружу и не применяй изменения production.",
  "Используй begin_task для штатного checkout, затем исследование и submit_result.",
 ].join("\n");
 return {
  title:RECOVERY_TITLE,
  description:description+"\n\n---\n\n"+reminder,
  status:"todo",
  parentId:issue.id,
  assigneeAgentId:identity.agentId,
  priority:["low","medium","high","urgent"].includes(issue.priority)?issue.priority:"medium",
 };
}
export function isReplayBlocked(action){
 return action?.sourceIssueId===SOURCE_ID &&
 action.status==="resolved" && action.outcome==="blocked" &&
 action.evidence?.automaticRecovery?.replay==="blocked";
}
export function selectExisting(children,identity){
 const candidates=children.filter(x=>x.title===RECOVERY_TITLE);
 if(candidates.length>1)throw Error("MULTIPLE_RECOVERY_CHILDREN");
 if(!candidates.length)return null;
 const child=candidates[0];
 if(child.parentId!==SOURCE_ID||child.companyId!==identity.companyId||
    child.assigneeAgentId!==identity.agentId||!UUID.test(child.id))
  throw Error("RECOVERY_CHILD_MISMATCH");
 return child;
}

const API="127.0.0.1";
function request(token,path,method="GET",payload=null){
 return new Promise((resolve,reject)=>{
  const body=payload===null?null:Buffer.from(JSON.stringify(payload));
  const options={
   hostname:API,port:3100,path,method,timeout:12000,
   headers:{
    authorization:"Bearer "+token,
    accept:"application/json",
    ...(body?{"content-type":"application/json","content-length":body.length}:{})
   }
  };
  const req=http.request(options,res=>{
   let size=0;const chunks=[];
   res.on("data",chunk=>{
    size+=chunk.length;if(size>100_000){res.destroy(Error("RESPONSE_TOO_LARGE"));return;}
    chunks.push(chunk);
   });
   res.on("error",reject);
   res.on("end",()=>{
    let value=null;
    try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{}
    resolve({status:res.statusCode,body:value});
   });
  });
  req.on("timeout",()=>req.destroy(Error("API_TIMEOUT")));
  req.on("error",reject);
  req.end(body||undefined);
 });
}
function failureCode(value){
 const code=value?.details?.code??value?.code??value?.reason??"API_REJECTED";
 return typeof code==="string"&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(code)?
  code:"API_REJECTED";
}
async function main(){
 const require=createRequire("/app/server/package.json");
 const {createDb,issues,issueRecoveryActions,heartbeatRuns}=await import(require.resolve("@paperclipai/db"));
 const {eq,and,desc}=await import(require.resolve("drizzle-orm"));
 const identity=JSON.parse(fs.readFileSync("/run/secrets/task-control.json","utf8"));
 const db=createDb(process.env.DATABASE_URL);
 const [issue]=await db.select().from(issues).where(eq(issues.id,SOURCE_ID)).limit(1);
 const payload=continuationPayload(issue,identity);
 const recovered=await db.select().from(issueRecoveryActions)
    .where(eq(issueRecoveryActions.sourceIssueId,SOURCE_ID));
 if(recovered.filter(isReplayBlocked).length!==1)
  throw Error("EXPECTED_SINGLE_RECOVERY_HOLD");
 console.log("SOURCE: WOR-7 todo with settled execution-recovery no-replay hold");
 console.log("Original history will NOT be modified.");

 const children=await db.select().from(issues).where(eq(issues.parentId,SOURCE_ID));
 let child=selectExisting(children,identity);
 if(child?.status==="done"||child?.status==="cancelled"){
   console.log("RECOVERY_CHILD_ALREADY_TERMINAL",child.identifier);return;
 }
 if(!child){
  const created=await request(identity.token,
   "/api/companies/"+identity.companyId+"/issues","POST",payload);
  if(![200,201].includes(created.status)){
    console.log("CHILD_CREATE_HTTP="+created.status,
     "REASON="+failureCode(created.body));
    console.log("BOARD_ACTION_REQUIRED: API did not authorize task creation; no DB bypass attempted.");
    process.exitCode=4;return;
  }
  const id=created.body?.id??created.body?.issue?.id;
  if(!UUID.test(id))throw Error("CHILD_CREATE_UNCONFIRMED");
  const [record]=await db.select().from(issues).where(eq(issues.id,id)).limit(1);
  if(!record||record.parentId!==SOURCE_ID||
      record.assigneeAgentId!==identity.agentId)throw Error("CREATED_CHILD_BINDING_UNCONFIRMED");
  child=record;
  console.log("CHILD_CREATED="+child.identifier);
 }else{
  console.log("CHILD_REUSED="+child.identifier);
 }
 if(child.status!=="todo"&&child.status!=="in_progress"){
  console.log("CHILD_NOT_READY="+child.status);return;
 }
 const fresh=await request(identity.token,
  "/api/agents/"+identity.agentId+"/wakeup","POST",{
   source:"on_demand",triggerDetail:"manual",
   reason:"New remaining-work continuation task created with native Paperclip API",
   payload:{issueId:child.id},
   idempotencyKey:"wor7-research-continuation-"+child.id
  });
 const status=fresh.body?.status??null;
 const reason=fresh.body?.reason??fresh.body?.code??null;
 console.log("CHILD_WAKE_HTTP="+fresh.status,
  "STATUS="+String(status||"unknown").slice(0,70),
  "REASON="+(typeof reason==="string"?reason.slice(0,90):"none"));
 if(fresh.status!==202){
  console.log("CHILD_WOKE_NOT_CONFIRMED: native API refused; child remains in Paperclip.");
  process.exitCode=5;return;
 }
 if(status==="skipped"){
  console.log("CHILD_WAKE_SKIPPED: normal Paperclip execution checks refused the fresh child.");
  process.exitCode=6;return;
 }
 if(!["queued","accepted","coalesced","running","completed"].includes(status)){
  console.log("CHILD_WAKE_PENDING: wake response not proof of execution.");
 }
 console.log("=== LIVE CHILD RUNS (METADATA ONLY) ===");
 const runs=await db.select().from(heartbeatRuns)
  .where(eq(heartbeatRuns.agentId,identity.agentId))
  .orderBy(desc(heartbeatRuns.createdAt)).limit(10);
 for(const run of runs){
  const bound=run.issueId??run.contextSnapshot?.issueId??run.contextSnapshot?.taskId;
  if(bound===child.id)console.log(JSON.stringify({issue:child.identifier,
    runStatus:run.status,started:!!run.startedAt,finished:!!run.finishedAt}));
 }
 console.log("Continuation link: child "+child.identifier+" of original WOR-7.");
 console.log("No mail sent and no original task/recovery row was changed.");
}
if(process.env.HERMES_CONTINUE_WOR7==="1"){
 try{await main();}
 catch(error){
  const message=error?.message??"UNKNOWN";
  const safe=/^[A-Z_]{4,90}$/.test(message)?message:"CONTINUATION_FAILED";
  console.error("SAFE_STOP:",safe);
  process.exitCode=3;
 }
}
