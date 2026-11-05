import {ownershipIssue} from './source-ownership.js';
import {createHash} from 'node:crypto';
import {comparableValue,valueGrounded} from './normalization.js';
import {addressIssue,cleanPostcode,providerAddress} from '../public/address-rules.js';
import {REGISTRY_NOTE} from './registry-extraction.js';

const registryKey=/^(?:company_name|company_number|incorporated_on|legal_form|country|registered_|city$|postal_code$|director_)/;
function priority(key,row){
 if(registryKey.test(key)&&row.note?.includes('Дополнительный официальный источник'))return 4;
 if(registryKey.test(key)&&row.note?.startsWith(REGISTRY_NOTE))return 3;
 if(/^contact_(?:first|last)_name$/.test(key)&&row.note?.startsWith('Документ личности:'))return 3;
 return row.automatic?2:1;
}

// Repeated pages, parser outputs and identical uploads do not add votes.
// All recommendations remain a draft until the operator confirms the sheet.
export function profileSelections(candidates,documents){
 const identities=new Map(documents.map(doc=>[doc.id,createHash('sha256').update(JSON.stringify(JSON.parse(doc.pages).map(page=>page.text.trim().replace(/\s+/g,' ')))).digest('hex')]));
 const registeredKey=key=>/^(?:registered_address(?:_line[12])?|city|postal_code|registered_country)$/.test(key);
 const invoiceIds=new Set(documents.filter(doc=>/invoice/i.test(doc.filename||'')||/^\s*(?:(?:tax|vat)\s+)?invoice(?:\s*(?:no\b|number\b|#|date\b|:)|\s*$)/im.test(JSON.parse(doc.pages).map(page=>page.text).join('\n'))).map(doc=>doc.id));
 const usable=candidates.filter(row=>!ownershipIssue(row,documents.find(doc=>doc.id===row.document_id))&&!addressIssue(row.key,row.value)&&!(registeredKey(row.key)&&(invoiceIds.has(row.document_id)||providerAddress.test(row.quote))));
 candidates=usable.map(row=>/postal_code$/.test(row.key)?{...row,value:cleanPostcode(row.value)||row.value}:row);
 const output={};
 const identityOf=row=>identities.get(row.document_id)||row.document_id;
 for(const key of new Set(candidates.map(row=>row.key))){
  const rows=candidates.filter(row=>row.key===key&&!row.note?.startsWith('Название в документе отличается от выбранной компании.')&&valueGrounded(key,row.value,row.quote));
  const groups=new Map();
  for(const row of rows){const value=comparableValue(key,row.value);if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);}
  const ranked=[...groups.values()].map(rows=>({rows,votes:new Set(rows.map(row=>identities.get(row.document_id)||row.document_id)).size,priority:Math.max(...rows.map(row=>priority(key,row)))})).sort((a,b)=>b.votes-a.votes||b.priority-a.priority||comparableValue(key,a.rows[0].value).localeCompare(comparableValue(key,b.rows[0].value),'en'));
  if(!ranked.length)continue;
  const best=ranked[0],row=[...best.rows].sort((a,b)=>priority(key,b)-priority(key,a)||String(a.document_id).localeCompare(String(b.document_id))||a.page-b.page)[0];
  const total=new Set(rows.map(row=>identities.get(row.document_id)||row.document_id)).size;
  const tied=ranked.length>1&&ranked[1].votes===best.votes;
  output[key]={...row,votes:best.votes,total,alternatives:ranked.length,tied,reason:ranked.length===1?`Единственный найденный вариант · ${best.votes} док.`:tied?best.priority>ranked[1].priority?`Совпадений поровну · выбран более подходящий источник · ${best.votes} из ${total} док.`:`Совпадений поровну · предварительный вариант, проверьте · ${best.votes} из ${total} док.`:`Больше всего совпадений · ${best.votes} из ${total} док.`};
 }
 // Name components must describe the same person in one document.
 for(const role of ['contact','director','beneficiary']){
  const firstKey=role+'_first_name',lastKey=role+'_last_name',pairs=[];
  for(const doc of documents){const rows=candidates.filter(row=>row.document_id===doc.id&&!row.note?.startsWith('Название в документе отличается от выбранной компании.')&&valueGrounded(row.key,row.value,row.quote));const first=rows.filter(row=>row.key===firstKey),last=rows.filter(row=>row.key===lastKey);if(new Set(first.map(row=>comparableValue(firstKey,row.value))).size!==1||new Set(last.map(row=>comparableValue(lastKey,row.value))).size!==1)continue;pairs.push({first:first[0],last:last[0]});}
  const groups=new Map();for(const pair of pairs){const key=JSON.stringify([comparableValue(firstKey,pair.first.value),comparableValue(lastKey,pair.last.value)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(pair);}
  const ranked=[...groups.values()].map(pairs=>({pairs,votes:new Set(pairs.map(pair=>identityOf(pair.first))).size,priority:Math.max(...pairs.map(pair=>Math.min(priority(firstKey,pair.first),priority(lastKey,pair.last))))})).sort((a,b)=>b.votes-a.votes||b.priority-a.priority||JSON.stringify([a.pairs[0].first.value,a.pairs[0].last.value]).localeCompare(JSON.stringify([b.pairs[0].first.value,b.pairs[0].last.value]),'en'));
  if(!ranked.length)continue;const best=ranked[0],pair=[...best.pairs].sort((a,b)=>priority(firstKey,b.first)-priority(firstKey,a.first)||String(a.first.document_id).localeCompare(String(b.first.document_id)))[0],total=new Set(pairs.map(pair=>identityOf(pair.first))).size,tied=ranked.length>1&&ranked[1].votes===best.votes;
  const reason=`Имя и фамилия из одного документа · ${best.votes} из ${total} док.${tied?' · совпадений поровну, проверьте':''}`;
  for(const [key,row] of [[firstKey,pair.first],[lastKey,pair.last]])output[key]={...row,votes:best.votes,total,alternatives:ranked.length,tied,reason};
 }
 // Keep address components from the same selected address block.
 const addressGroups={registered_address:['registered_address_line1','registered_address_line2','city','postal_code','registered_country'],operating_address:['operating_address_line1','operating_address_line2','operating_city','operating_postal_code','operating_country']};
 for(const role of ['contact','director','beneficiary'])addressGroups[role+'_residential_address']=['address_line1','address_line2','city','postal_code','country'].map(suffix=>role+'_'+suffix);
 for(const [fullKey,components] of Object.entries(addressGroups)){
  const full=output[fullKey];if(!full)continue;
  for(const key of components){const matches=candidates.filter(row=>row.key===key&&row.document_id===full.document_id&&row.page===full.page&&row.quote===full.quote);const unique=new Set(matches.map(row=>comparableValue(key,row.value)));if(unique.size===1)output[key]={...full,...matches[0],reason:full.reason+' · компоненты одного адреса'};else if(key.endsWith('line2')&&!matches.length)output[key]={...full,key,value:'',reason:full.reason+' · вторая строка не указана'};else delete output[key];}
 }
 return output;
}
