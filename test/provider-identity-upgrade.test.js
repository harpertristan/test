import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {memoryStore,openStore} from '../lib/store.js';
import {StateStore} from '../lib/state-journal.js';
import {providerHost} from '../lib/provider-host.js';
import {candidateIdentity} from '../lib/candidate-identity.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,excludeCRM} from '../lib/crm.js';
import {manuallyExcluded,effectiveExclusions} from '../lib/manual-exclusions.js';
import {validateAssessment,dueReviews} from '../lib/ai-review.js';
import {consolidateProviderIdentities} from '../lib/provider-identity-upgrade.js';
const now=new Date('2026-11-03T08:00:00Z');
const app=(id,site,title)=>({appId:id,title,developerWebsite:site,url:'https://play.google.com/store/apps/details?id='+id,screeningText:'We offer business accounts for companies. Account details require verification.',firstFoundAt:now.toISOString()});
test('service subdomains consolidate the shown Satispay variants and prefer the business listing without dropping source targets',()=>{
 const s=memoryStore(now).state;s.findings.push(app('co.qa.personal','https://support.satispay.com/','Satispay: Pay and Invest'),app('co.qa.business','https://www.satispay.com/','Satispay Business'));
 const groups=groupedCandidates(s,{includeExcluded:true,allSources:true});assert.equal(groups.length,1);assert.equal(groups[0].id,'company:satispay.com');assert.equal(groups[0].title,'Satispay Business');assert.equal(groups[0].appId,'co.qa.business');assert.equal(groups[0].targets.length,2);assert.equal(groups[0].documents.length,2);
 assert.equal(candidateIdentity({developerWebsite:'https://help.bank.co.uk/'}),'company:bank.co.uk');
});
test('arbitrary brands, BaaS customer subdomains and hosted help tenants remain separate',()=>{
 assert.notEqual(providerHost('https://alpha.swan.io'),providerHost('https://beta.swan.io'));
 assert.equal(providerHost('https://support.zendesk.com'),'support.zendesk.com');
 assert.equal(providerHost('https://support.co.uk'),'support.co.uk');assert.equal(providerHost('https://help.netlify.app'),'help.netlify.app');assert.equal(providerHost('https://support.customer.github.io'),'customer.github.io');
 assert.equal(providerHost('https://help.bank.co.uk'),'bank.co.uk');
 assert.notEqual(candidateIdentity({developerWebsite:'https://alpha.example.eu'}),candidateIdentity({developerWebsite:'https://beta.example.eu'}));
});
test('a worked decision made on a support website protects the root provider and all app variants',()=>{
 const s=memoryStore(now).state;s.findings.push(app('co.qa.personal','https://support.qa-bank.eu/','QA Bank'),app('co.qa.business','https://qa-bank.eu/','QA Bank Business'));
 s.manualExclusions.push({key:'old-support',kind:'domain',value:'support.qa-bank.eu',reason:'worked',title:'QA Bank'});
 assert.equal(groupedCandidates(s).length,0);assert.ok(crmRows(s)[0].worked);assert.ok(manuallyExcluded({developerWebsite:'https://qa-bank.eu/'},effectiveExclusions(s)));
});
test('4.7 duplicate identities upgrade locally with notes, decisions, queue and original analyses retained; reopening is idempotent',async t=>{
 const root=await mkdtemp('/tmp/scout-identity-');t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'state.json'),state=memoryStore(now).state;
 state.findings.push(app('co.qa.personal','https://support.qa-bank.eu/','QA Bank'),app('co.qa.business','https://qa-bank.eu/','QA Bank Business'));
 state.providerCRMUpgrade=true;state.ai.validationPolicyVersion=7;state.focusedSearchV1={at:now.toISOString()};state.crm.records['company:support.qa-bank.eu']={status:'selected',exclusionReason:'worked',notes:'Old support note',manualStatusAt:'2026-11-01T00:00:00Z'};state.crm.records['company:qa-bank.eu']={status:'review',notes:'Business note',manualStatusAt:'2026-11-02T00:00:00Z'};
 state.manualExclusions.push({key:'support',kind:'domain',value:'support.qa-bank.eu',reason:'worked'});state.ai.shortlist=['company:support.qa-bank.eu'];state.ai.manualBatch={id:'batch',candidateIds:['company:support.qa-bank.eu','company:qa-bank.eu'],remainingIds:['company:support.qa-bank.eu']};
 const doc={id:'s1',url:'https://support.qa-bank.eu/faq',kind:'official_page',text:'We offer business accounts for companies.'},raw={business:{status:'yes',evidence:[{sourceId:'s1',quote:doc.text}]},account:{status:'unknown',evidence:[]},euIban:{status:'unknown',evidence:[]},utility:{status:'unknown',evidence:[]}};
 state.ai.results.push({...validateAssessment(raw,[doc]),id:'company:support.qa-bank.eu',version:2,model:'fixture',inputHash:'old',sourceDocuments:[doc],checkedAt:now.toISOString(),analysisMethod:'ai'});
 const usage=structuredClone(state.ai.usage),schedules=structuredClone(state.schedule);const first=new StateStore(file,state);await first.flush();const upgraded=await openStore(file,now);const row=crmRows(upgraded.state).find(r=>r.id==='company:qa-bank.eu');assert.ok(row.worked);assert.match(row.notes,/Old support note/);assert.match(row.notes,/Business note/);assert.equal(crmRows(upgraded.state).filter(r=>r.id.startsWith('company:')).length,1);
 assert.deepEqual(upgraded.state.ai.manualBatch.remainingIds,['company:qa-bank.eu']);assert.deepEqual(upgraded.state.ai.manualBatch.candidateIds,['company:qa-bank.eu']);assert.equal(upgraded.state.crm.identityArchive['company:support.qa-bank.eu'].analyses.length,1);assert.equal(upgraded.state.crm.identityArchive['company:support.qa-bank.eu'].record.notes,'Old support note');assert.equal(dueReviews(upgraded.state,'fixture').length,0);assert.deepEqual(upgraded.state.ai.usage,usage);assert.deepEqual(upgraded.state.schedule,schedules);
 assert.equal(upgraded.state.crm.identityArchive['company:qa-bank.eu'].record.notes,'Business note');assert.equal(upgraded.state.crm.identityArchive['company:qa-bank.eu'].record.status,'review');await upgraded.flush();const reopened=await openStore(file,now);assert.deepEqual(reopened.state.crm.identityArchive,upgraded.state.crm.identityArchive);assert.equal(crmRows(reopened.state).find(r=>r.id==='company:qa-bank.eu').notes,row.notes);
});
test('a new worked mark consolidates both variants into one restorable record with both app aliases',()=>{
 const s=memoryStore(now).state;s.findings.push(app('co.qa.personal','https://support.qa-bank.eu/','QA Bank'),app('co.qa.business','https://qa-bank.eu/','QA Bank Business'));excludeCRM(s,'company:qa-bank.eu',now,'worked');const rule=s.manualExclusions[0];assert.equal(new Set(rule.appIds).size,2);assert.equal(crmRows(s).filter(r=>r.worked).length,1);
});
test('an unanalysed old provider retains its discovery baseline and pending queue after its support-domain ID changes',()=>{
 const s=memoryStore(now).state;s.crm.reviewCycle={id:'cycle',baseline:['company:support.qa-bank.eu'],protectedIds:[]};s.ai.manualBatch={id:'pending',candidateIds:['company:support.qa-bank.eu'],remainingIds:['company:support.qa-bank.eu']};consolidateProviderIdentities(s,now);assert.deepEqual(s.crm.reviewCycle.baseline,['company:qa-bank.eu']);assert.deepEqual(s.ai.manualBatch.remainingIds,['company:qa-bank.eu']);assert.equal(s.crm.identityAliases['company:support.qa-bank.eu'],'company:qa-bank.eu');
});
