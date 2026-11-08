// Fixed, non-paid Scout source menu for one verified Hermes agent.
// No caller-supplied source URLs, payment flags, credentials or API methods.
const MODES=Object.freeze({
  play: {id:"play",monitor:"/api/monitor"},
  web: {id:"web",monitor:"/api/web/monitor"},
  watch: {id:"watch",monitor:"/api/watch/monitor"},
  ecb: {id:"social:ecb",monitor:"/api/social/monitor"},
  finextra: {id:"social:finextra",monitor:"/api/social/monitor"},
  linkedin: {id:"social:linkedin",monitor:"/api/social/monitor"},
  facebook: {id:"social:facebook",monitor:"/api/social/monitor"},
  sifted: {id:"social:sifted",monitor:"/api/social/monitor"}
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const collectionModes=()=>Object.keys(MODES);
export function validateCollection(body){
 if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).sort().join(",")!=="capability,source"||
    typeof body.capability!=="string"||body.capability.length<1||body.capability.length>160||
    typeof body.source!=="string"||!Object.hasOwn(MODES,body.source))
   throw Error("INVALID_COLLECT_REQUEST");
 return {capability:body.capability,mode:body.source};
}
export function authorizeCollection(policy,task,mode){
 if(!policy||policy.version!==1||!policy.grants||typeof policy.grants!=="object"||
    !task||!UUID.test(task.id||"")||task.status!=="in_progress"||
    typeof task.identifier!=="string"||!Object.hasOwn(MODES,mode))
    throw Error("COLLECT_NOT_AUTHORIZED");
 const specific=policy.grants[task.id];
 if(specific&&specific.issueIdentifier!==task.identifier)throw Error("COLLECT_ISSUE_MISMATCH");
 const agent=policy.agentGrants?.[task.agentId];
 const fallback=!specific&&agent?.agentId===task.agentId&&agent?.companyId===task.companyId
   ?agent:null;
 const grant=specific||fallback;
 if(!grant||grant.workspaceWide!==true||!Array.isArray(grant.operations)||
    !grant.operations.includes("scout_collect"))throw Error("COLLECT_NOT_GRANTED");
 return Object.freeze({issueId:task.id,sourceId:MODES[mode].id,monitor:MODES[mode].monitor,mode});
}
export function collectionPayload(grant,requestId){
 return Object.freeze({ids:[grant.sourceId],analyse:false,allowPaid:false,requestId});
}
