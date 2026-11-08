// Read-only, bounded projections of Play Scout's existing CRM "На проверку" view.
// No decisions, mutations, private account information or outgoing messages.
const INACTIVE=new Set(["excluded","auto_excluded","rejected","source_archive","reference","known"]);
const SUITABLE=new Set(["approved","confirmed","selected"]);
export function needsReview(row) {
  if(!row||typeof row!=="object"||Array.isArray(row))return false;
  if(INACTIVE.has(row.status)||row.worked||row.manualExcluded)return false;
  if(SUITABLE.has(row.status))return false;
  return row.screening?.eligible!==false||Boolean(row.manualStatusAt);
}
function plain(v,n=200){
  return typeof v==="string"?v.slice(0,n):null;
}
export function reviewItem(row,{detail=false}={}) {
  if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.id!=="string")
    throw Error("INVALID_CRM_ROW");
  const facts={};
  for(const k of ["business","account","euIban"]){
    const f=row.facts?.[k];
    facts[k]=f?.status==="yes"?"yes":f?.status==="no"?"no":"unknown";
  }
  const base={
    id:plain(row.id,160),revision:plain(row.detailRevision,70),
    title:plain(row.title||row.name||row.serviceName,180),
    website:plain(row.developerWebsite||row.url,700),
    appId:plain(row.appId,180),
    status:plain(row.status,40),
    sources:Array.isArray(row.sources)?row.sources.filter(x=>typeof x==="string").slice(0,8):[],
    facts,screeningEligible:row.screening?.eligible===false?false:true,
    manualReview:!!row.needsManualReview,
    question:plain(row.reviewRouting?.reason||row.autoExclusion,250),
  };
  if(!detail)return base;
  const docs=Array.isArray(row.documents)?row.documents:[];
  const evidence=docs.slice(0,10).map(doc=>({
    source:plain(doc.url||doc.source||doc.website,700),
    title:plain(doc.title,170),
    excerpt:plain(doc.text||doc.quote||doc.snippet,850),
  }));
  return {...base,licenceTypes:Array.isArray(row.licenceTypes)?row.licenceTypes.slice(0,12):[],
    evidence,reviewRouting:plain(row.reviewRouting?.reason,500),
    webPresence:{website:plain(row.webPresence?.officialWebsite||row.webPresence?.website,700)},
    totalDocuments:docs.length};
}
export function reviewQueue(snapshot,limit=30){
  if(!snapshot||typeof snapshot!=="object"||!Array.isArray(snapshot.rows))
    throw Error("CRM_SNAPSHOT_INVALID");
  const candidates=snapshot.rows.filter(needsReview);
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error("INVALID_LIMIT");
  return {
    view:"needs_review",title:"Play Scout CRM — На проверку",
    count:candidates.length,items:candidates.slice(0,limit).map(r=>reviewItem(r)),
    truncated:candidates.length>limit,
    checkedAt:new Date().toISOString(),
    instructions:"For each item, inspect item details, verify official URLs and regulatory facts. Never auto-approve or reject without grounded evidence."
  };
}
