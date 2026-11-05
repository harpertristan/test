import {REFERENCE_DOMAINS} from './references.js';
import {seedKnownProjects} from './known-projects.js';
import {FOCUSED_DISCOVERY_KEYWORDS,DISCOVERY_KEYWORDS} from './discovery.js';
import {WEB_QUERIES} from './web-services.js';
import {LAUNCH_QUERIES,BUSINESS_SOCIAL_QUERIES,SOCIAL_QUERIES} from './source-catalog.js';
import {validateMarketPolicy,DEFAULT_BLOCKED_JURISDICTIONS} from './market-scope.js';
export const FOCUSED_WEB_QUERIES=[
 '("business account" OR "corporate account") ("EU IBAN" OR "European IBAN" OR SEPA)',
 '("business account" OR "corporate account") ("German IBAN" OR "Lithuanian IBAN" OR "French IBAN")',
 '("IBAN provider" OR "virtual IBAN") (business OR corporate) (EUR OR SEPA)',
 '("IBAN as a service" OR "white label IBAN") (business OR corporate)',
 '("crypto business account" OR "stablecoin business account") (IBAN OR SEPA)',
 '("business IBAN" OR "EUR business account") (launch OR waitlist OR "early access")',
];
export const FOCUSED_PUBLICATION_QUERIES=[
 '("business account" OR "corporate account") (IBAN OR SEPA) (launches OR launched OR introduces OR "now available")',
 '("IBAN provider" OR "business IBAN") (launch OR partnership OR authorisation)',
 '("crypto business account" OR "stablecoin business account") (IBAN OR SEPA) (launch OR new)',
];
export const FOCUSED_SIGNAL_QUERIES=[
 '("business account" OR "corporate account" OR "IBAN provider") (IBAN OR SEPA)',
 '("business IBAN" OR "virtual IBAN") (EUR OR Europe OR European)',
];
// Reviews and directories are valuable before a press release exists. Keep
// product criteria, but do not require a launch announcement on those sources.
export function signalSearchQueries(queries){
 const launchDefaults=[...LAUNCH_QUERIES,...FOCUSED_PUBLICATION_QUERIES];
 return queries.some(q=>launchDefaults.includes(q))?[...new Set([...queries.filter(q=>!launchDefaults.includes(q)),...FOCUSED_SIGNAL_QUERIES])]:queries;
}
const legacyWeb=[...WEB_QUERIES,'("IBAN provider" OR "IBAN as a service") (business OR corporate) (EUR OR SEPA)','("white label" OR BaaS OR "embedded banking") (IBAN OR "business account")'];
const merge=(old,legacy,next,max=Infinity)=>{const custom=old.filter(q=>!legacy.includes(q)&&!next.includes(q));return [...new Set([...custom,...(!old.length||old.some(q=>legacy.includes(q)||next.includes(q))?next:[])])].slice(0,max);};
export function tuneFocusedSearch(state,now=new Date()){
 seedKnownProjects(state,now);
 if(state.focusedSearchV1)return false;
 state.searchTuningBackup={at:now.toISOString(),play:structuredClone(state.schedule.filters),web:structuredClone(state.web.schedule.filters),social:structuredClone(state.social.schedule.filters),marketPolicy:structuredClone(state.crm?.settings?.marketPolicy??null)};
 const policy=validateMarketPolicy({marketScope:'eu_business',blockedJurisdictions:DEFAULT_BLOCKED_JURISDICTIONS});
 state.crm??={records:{},settings:{}};state.crm.settings.marketPolicy=policy;
 state.schedule.filters.keywords=merge(state.schedule.filters.keywords,DISCOVERY_KEYWORDS,FOCUSED_DISCOVERY_KEYWORDS);
 state.schedule.filters.referenceDiscovery=true;
 state.schedule.filters.referenceDomains=[...new Set([...state.schedule.filters.referenceDomains??[],...REFERENCE_DOMAINS])];
 state.schedule.filters.countries=[...new Set([...state.schedule.filters.countries,'RO','SK','SI'])];
 state.web.schedule.filters.referenceDomains=[...new Set([...state.web.schedule.filters.referenceDomains??[],...REFERENCE_DOMAINS])];
 state.web.schedule.filters.queries=merge(state.web.schedule.filters.queries,legacyWeb,FOCUSED_WEB_QUERIES,48);
 state.social.schedule.filters.queries=merge(state.social.schedule.filters.queries,[...LAUNCH_QUERIES,...BUSINESS_SOCIAL_QUERIES,...SOCIAL_QUERIES],FOCUSED_PUBLICATION_QUERIES,24);
 // Existing schedules, dates, API engines, keys, models and manual exclusions
 // retain their values; this changes criteria and queries, not authorization.
 for(const section of[state,state.web,state.social,state.watch,state.apple])Object.assign(section.schedule.filters,structuredClone(policy));
 state.focusedSearchV1={at:now.toISOString(),countriesRetained:['RO','SK','SI'],policyVersion:1};return true;
}
