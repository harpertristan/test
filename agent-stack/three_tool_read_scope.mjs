// Explicit operator-approved issue scope. No implicit workspace permissions.
import {listReadOperations} from "./three_tool_read_policy.mjs";
const catalog=new Map(listReadOperations().map(x=>[x.name,x]));
const ID=/^[a-zA-Z0-9_-]{1,80}$/;
export function authorizeReadScope(policy,issue,operation,params={}){
  if(!policy||typeof policy!=="object"||Array.isArray(policy)||policy.version!==1)throw Error("Invalid policy");
  if(!issue||typeof issue!=="object"||typeof issue.id!=="string"||typeof issue.identifier!=="string")throw Error("Invalid issue");
  const grants=policy.grants;
  if(!grants||typeof grants!=="object"||Array.isArray(grants))throw Error("Missing grants");
  const grant=grants[issue.id];
  if(!grant||typeof grant!=="object"||Array.isArray(grant)||grant.issueIdentifier!==issue.identifier)throw Error("No issue authorization");
  const entry=catalog.get(operation);
  if(!entry||!Array.isArray(grant.operations)||!grant.operations.includes(operation))throw Error("Operation not granted");
  if(typeof params!=="object"||!params||Array.isArray(params))throw Error("Invalid params");
  if(entry.template.includes(":companyId")){
    if(typeof params.companyId!=="string"||!ID.test(params.companyId)||!Array.isArray(grant.companyIds)||!grant.companyIds.includes(params.companyId))
      throw Error("Company scope denied");
  }else if(grant.workspaceWide!==true){
    // List/global endpoints cannot guarantee per-company filtering.
    throw Error("Workspace-wide consent required");
  }
  if(entry.service==="mail"&&grant.mailConsent!==true)throw Error("Mail consent required");
  return true;
}
