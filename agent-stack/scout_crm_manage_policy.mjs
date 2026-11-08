import {activeReadContext} from "./active_run_scope.mjs";
import {needsReview} from "./scout_review_projection.mjs";

const ID=/^[A-Za-z0-9:._-]{1,160}$/;
const DECISIONS=Object.freeze({suitable:"confirmed",not_suitable:"rejected",watch:"watch"});
export function validateScoutDecision(value){
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join(",")!=="capability,decision,evidence,reviewId,sourceUrl")
    throw Error("INVALID_CRM_DECISION");
 const {capability,decision,evidence,reviewId,sourceUrl}=value;
 if(typeof capability!=="string"||capability.length<1||capability.length>160||
    typeof decision!=="string"||!Object.hasOwn(DECISIONS,decision)||
    typeof reviewId!=="string"||!ID.test(reviewId)||
    typeof evidence!=="string"||evidence.trim().length<35||evidence.length>1800||
    typeof sourceUrl!=="string"||sourceUrl.length>1600)
    throw Error("INVALID_CRM_DECISION");
 let url;
 try{url=new URL(sourceUrl);}
 catch{throw Error("INVALID_EVIDENCE_URL");}
 if(url.protocol!=="https:"||url.username||url.password||url.port||
    url.hostname==="localhost"||!url.hostname.includes(".")||
    /(^|\.)((?:internal)|(?:local)|(?:localhost))$/i.test(url.hostname)||
    /\s/.test(sourceUrl))
    throw Error("INVALID_EVIDENCE_URL");
 return {capability,decision,evidence:evidence.trim(),reviewId,sourceUrl:url.href};
}
export function authorizeScoutDecision(policy,task) {
 if(!activeReadContext(task)||!policy||policy.version!==1||!policy.grants||
    typeof policy.grants!=="object")throw Error("CRM_NOT_AUTHORIZED");
 const specific=policy.grants[task.id];
 if(specific&&specific.issueIdentifier!==task.identifier)throw Error("CRM_ISSUE_MISMATCH");
 const defaults=policy.agentGrants?.[task.agentId];
 const valid=defaults&&defaults.agentId===task.agentId&&defaults.companyId===task.companyId;
 const grant=specific||(valid?defaults:null);
 if(!grant||grant.workspaceWide!==true||!Array.isArray(grant.operations)||
    !grant.operations.includes("scout_crm_manage"))throw Error("CRM_PERMISSION_DENIED");
 return true;
}
export function proposeStatus(item,request,verifiedUrl){
 if(!item||item.id!==request.reviewId||!needsReview(item)||
    item.worked||item.manualExcluded)throw Error("CRM_ITEM_NOT_REVIEWABLE");
 if(!verifiedUrl)throw Error("CRM_EVIDENCE_NOT_DISCOVERED");
 return {id:item.id,status:DECISIONS[request.decision]};
}
