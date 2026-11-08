// Read-only authorization from exact active task or explicitly configured trusted agent.
// Task identity is validated by task_control first; callers cannot choose agent/task IDs.
import {listReadOperations} from "./three_tool_read_policy.mjs";
const catalog=new Map(listReadOperations().map(x=>[x.name,x]));
const ID=/^[a-zA-Z0-9_-]{1,80}$/;
export function authorizeReadScope(policy,issue,operation,params={}){
  if(!policy||typeof policy!=="object"||Array.isArray(policy)||policy.version!==1)throw Error("Invalid policy");
  if(!issue||typeof issue!=="object"||typeof issue.id!=="string"||typeof issue.identifier!=="string")throw Error("Invalid issue");
  const grants=policy.grants;
  if(!grants||typeof grants!=="object"||Array.isArray(grants))throw Error("Missing grants");
  const specific=grants[issue.id];
  if(specific && (typeof specific!=="object"||Array.isArray(specific)||specific.issueIdentifier!==issue.identifier))
    throw Error("Issue grant mismatch");
  // Issue-specific grants take priority. Agent defaults apply only when the
  // trusted controller positively authenticated the agent and the task.
  const defaults=policy.agentGrants;
  const fallback=(!specific && defaults && typeof defaults==="object" && !Array.isArray(defaults) &&
    typeof issue.agentId==="string" && typeof issue.companyId==="string" &&
    typeof defaults[issue.agentId]==="object" &&
    defaults[issue.agentId]?.agentId===issue.agentId &&
    defaults[issue.agentId]?.companyId===issue.companyId)
      ? defaults[issue.agentId] : null;
  const grant=specific||fallback;
  if(!grant||typeof grant!=="object"||Array.isArray(grant))throw Error("No task or agent authorization");
  const entry=catalog.get(operation);
  if(!entry||!Array.isArray(grant.operations)||!grant.operations.includes(operation))throw Error("Operation not granted");
  if(typeof params!=="object"||!params||Array.isArray(params))throw Error("Invalid params");
  if(entry.template.includes(":companyId")){
    if(typeof params.companyId!=="string"||!ID.test(params.companyId))
      throw Error("Company identifier invalid");
    const explicitlyAllowed=Array.isArray(grant.companyIds)&&grant.companyIds.includes(params.companyId);
    const wholeAssistant=entry.service==="assistant"&&grant.workspaceWide===true&&
      grant.assistantConsent===true&&grant.assistantAllCompanies===true;
    if(!explicitlyAllowed&&!wholeAssistant)throw Error("Company scope denied");
  }else if(grant.workspaceWide!==true){
    throw Error("Workspace-wide consent required");
  }
  if(entry.service==="mail"&&grant.mailConsent!==true)throw Error("Mail consent required");
  if(entry.service==="assistant"&&grant.assistantConsent!==true)throw Error("Assistant consent required");
  return true;
}
