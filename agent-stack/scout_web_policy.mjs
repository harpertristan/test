// Public research only. No authenticated sessions, uploads, arbitrary ports or intranet URLs.
import net from "node:net";

const PRIVATE_HOST=/(^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.lan$|\.home$|\.docker$|\.svc$)/i;
const OPAQUE=/(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._=-]{12,}|(?:[A-Za-z0-9_-]{80,}))/i;
const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const IBAN=/\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){11,30}\b/i;

export function publicIPv4(value){
  if(net.isIP(value)!==4)return false;
  const n=value.split(".").map(Number);
  const [a,b,c]=n;
  if(a===0||a===10||a===127||a>=224)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&(b===168||b===0||b===88&&c===99||b===0&&c===2))return false;
  if(a===192&&b===0&&c===2)return false;
  if(a===198&&(b===18||b===19||b===51&&c===100))return false;
  if(a===203&&b===0&&c===113)return false;
  return true;
}

function expand(value){
  let text=value;
  for(let i=0;i<3;i++){
    try{const decoded=decodeURIComponent(text);if(decoded===text)break;text=decoded;}
    catch{break;}
  }
  return text;
}
export function safePublicText(value, max=180){
  if(typeof value!=="string"||!value.trim()||value.length>max)throw Error("PUBLIC_QUERY_INVALID");
  const text=expand(value);
  if(EMAIL.test(text)||IBAN.test(text)||OPAQUE.test(text)||
     /[\x00-\x08\x0b-\x1f]/.test(text))throw Error("PRIVATE_DATA_IN_QUERY");
  return value.trim();
}
export function safeWebUrl(value){
  if(typeof value!=="string"||value.length>1600||!value)throw Error("URL_REJECTED");
  let u;
  try{u=new URL(value);}catch{throw Error("URL_REJECTED");}
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash)
    throw Error("URL_REJECTED");
  const host=u.hostname.toLowerCase();
  if(!host.includes(".")||host.length>250||PRIVATE_HOST.test(host)||
     net.isIP(host)||!/^[-a-z0-9.]+$/.test(host)||host.split(".").some(x=>!x||x.length>63))
    throw Error("URL_REJECTED");
  if(!/^[a-z]{2,63}$/.test(host.split(".").at(-1))&&
     !host.endsWith(".xn--"))throw Error("URL_REJECTED");
  safePublicText(expand(u.pathname+" "+u.search),1550);
  return u;
}
export function validateWebAction(body){
  if(!body||typeof body!=="object"||Array.isArray(body))throw Error("INVALID_WEB_REQUEST");
  if(body.action==="search"){
    if(Object.keys(body).sort().join(",")!=="action,capability,query")throw Error("INVALID_WEB_REQUEST");
    if(typeof body.capability!=="string"||body.capability.length<10||body.capability.length>160)
      throw Error("INVALID_WEB_REQUEST");
    return {action:"search",query:safePublicText(body.query,180)};
  }
  if(body.action==="open"){
    if(Object.keys(body).sort().join(",")!=="action,capability,url")throw Error("INVALID_WEB_REQUEST");
    if(typeof body.capability!=="string"||body.capability.length<10||body.capability.length>160)
      throw Error("INVALID_WEB_REQUEST");
    return {action:"open",url:safeWebUrl(body.url).href};
  }
  throw Error("INVALID_WEB_REQUEST");
}
export function webReadScope(scope,task){
  if(!scope||scope.version!==1||!scope.grants||typeof scope.grants!=="object")
    throw Error("SCOPE_DENIED");
  if(!task||task.status!=="in_progress"||typeof task.id!=="string"||
     typeof task.identifier!=="string")throw Error("TASK_NOT_ACTIVE");
  const specific=scope.grants[task.id];
  if(specific&&specific.issueIdentifier!==task.identifier)throw Error("SCOPE_DENIED");
  const fallback=scope.agentGrants?.[task.agentId];
  const global=(fallback?.agentId===task.agentId&&
    fallback?.companyId===task.companyId)?fallback:null;
  const grant=specific??global;
  if(!grant||grant.workspaceWide!==true||
     !Array.isArray(grant.operations)||!grant.operations.includes("scout_web"))
    throw Error("SCOPE_DENIED");
  return true;
}
