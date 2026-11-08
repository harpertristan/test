// Restricted task-scoped Scout launch policy: no caller-controlled network, IDs or paid sources.
export const ISSUE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function authorizeScoutStart(scope,task) {
  if (!scope || scope.version !== 1 || !scope.grants || Array.isArray(scope.grants))
    throw Error("INVALID_SCOPE");
  if (!task || !ISSUE_ID.test(task.id||"") || task.status !== "in_progress" ||
      typeof task.identifier !== "string") throw Error("TASK_NOT_ACTIVE");
  const grant=scope.grants[task.id];
  if (!grant || grant.issueIdentifier !== task.identifier ||
      grant.workspaceWide !== true || !Array.isArray(grant.operations) ||
      !grant.operations.includes("scout_start"))
    throw Error("SCOUT_START_NOT_AUTHORIZED");
  const ids=grant.scoutSourceIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 ||
      new Set(ids).size !== ids.length ||
      !ids.every(x=>typeof x==="string" && /^web:[a-z0-9:_./-]{1,115}$/.test(x)))
    throw Error("SCOUT_SOURCE_SCOPE_INVALID");
  return Object.freeze({issueId:task.id, sourceIds:[...ids], requestId:task.id});
}
export function validateStartRequest(body){
  if (!body || typeof body!=="object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",")!=="capability" ||
      typeof body.capability!=="string" || body.capability.length<1 ||
      body.capability.length>160) throw Error("INVALID_REQUEST");
  return body.capability;
}
export function scoutPayload(grant){
  return Object.freeze({
    ids:[...grant.sourceIds],
    analyse:false,
    allowPaid:false,
    requestId:grant.requestId
  });
}
