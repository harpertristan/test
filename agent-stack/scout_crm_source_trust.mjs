// Recognize only public HTTPS websites already recorded in Scout CRM.
// A match authorizes an unauthenticated GET through existing DNS/private-IP protections.
// It never authorizes arbitrary hosts, HTTP, credentialed URLs, ports or writes.
import {safeWebUrl} from "./scout_web_policy.mjs";

function canonicalHost(host) {
  return host.toLowerCase().replace(/^www\./, "");
}
export function crmContainsPublicSite(rows, requested) {
  if(!Array.isArray(rows) || rows.length > 100000) return false;
  let url;
  try { url=safeWebUrl(requested); } catch { return false; }
  const host=canonicalHost(url.hostname);
  // Preserve a narrow provenance relation to the source's registered website.
  for(const row of rows) {
    if(!row || typeof row!=="object" || Array.isArray(row)) continue;
    const candidates=[
      row.developerWebsite, row.url, row.website,
      row.webPresence?.officialWebsite, row.webPresence?.website
    ];
    for(const value of candidates) {
      if(typeof value!=="string" || value.length>1600) continue;
      let known;
      try { known=safeWebUrl(value); } catch { continue; }
      if(canonicalHost(known.hostname)===host) return true;
    }
  }
  return false;
}
