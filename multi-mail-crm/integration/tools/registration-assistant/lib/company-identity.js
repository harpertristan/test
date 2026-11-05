import {invoiceSource} from './source-ownership.js';
import {comparableValue} from './normalization.js';
import {REGISTRY_NOTE} from './registry-extraction.js';

// A card title is a display label, never evidence of legal ownership.
export function identifyCompany(db,companyId,documents,rows){
 rows=[...rows,...db.prepare("SELECT e.*,e.document_id AS documentId FROM extracted_fields e JOIN documents d ON d.id=e.document_id WHERE e.company_id=? AND d.status='registry' AND e.status!='dismissed'").all(companyId)];
 documents=documents.filter(doc=>!invoiceSource(doc));
 const imported=documents.filter(doc=>doc.status==='registry');
 const saved=db.prepare('SELECT values_json FROM company_profiles WHERE company_id=?').get(companyId);
 const approved=saved?JSON.parse(saved.values_json):null;
 if(approved?.company_name&&approved?.company_number)return {name:approved.company_name,number:approved.company_number,origin:'profile'};
 const tiers=[imported,documents.filter(doc=>/certificate of incorporation|proposed\s+registered|\bIN01\b/i.test(JSON.parse(doc.pages).map(page=>page.text).join('\n'))),documents.filter(doc=>doc.status==='note'||/\.txt$/i.test(doc.filename))];
 for(const docs of tiers){
  const identities=[];
  for(const doc of docs){const fields=rows.filter(row=>row.documentId===doc.id&&(doc.status!=='registry'||row.note?.includes('Дополнительный официальный источник'))),names=fields.filter(row=>row.key==='company_name'),numbers=fields.filter(row=>row.key==='company_number');
   if(new Set(names.map(row=>comparableValue('company_name',row.value))).size!==1||new Set(numbers.map(row=>comparableValue('company_number',row.value))).size!==1)continue;
   identities.push({name:names[0].value,number:numbers[0].value,documentId:doc.id,origin:doc.status==='registry'?'registry':names[0].note.startsWith(REGISTRY_NOTE)?'registration-document':'notebook'});
  }
  if(!identities.length)continue;
  if(new Set(identities.map(row=>comparableValue('company_number',row.number))).size===1)return identities[0];
  return {ambiguous:true,options:identities};
 }
 return {unresolved:true};
}
