import {createHash,randomUUID} from 'node:crypto';
import {REGISTRY_NOTE} from './registry-extraction.js';
import {knownPeople,personalProofFields} from './personal-proof.js';
import {extractFields,splitLegacyNames} from './extraction-fields.js';
import {FIELDS} from './fields.js';
import {valueGrounded,comparableValue} from './normalization.js';

export function reanalyze(db,companyId){
  const company=db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
  const documents=db.prepare('SELECT * FROM documents WHERE company_id=?').all(companyId);
  const previous=db.prepare('SELECT * FROM facts WHERE company_id=?').all(companyId);
  const preliminary=documents.flatMap(doc=>extractFields(JSON.parse(doc.pages),company.name).map(candidate=>({...candidate,documentId:doc.id})));
  const master=db.prepare('SELECT values_json FROM company_profiles WHERE company_id=?').get(companyId);const masterPeople=[];if(master){const v=JSON.parse(master.values_json),role=v.applicant_role||'contact';if(v.contact_first_name&&v.contact_last_name)masterPeople.push({key:role+'_name',value:v.contact_first_name+' '+v.contact_last_name});}
  const people=knownPeople([...previous,...preliminary,...masterPeople]);
  for(const doc of documents){
    const candidates=[...preliminary.filter(row=>row.documentId===doc.id),...personalProofFields(JSON.parse(doc.pages),people).map(candidate=>({...candidate,documentId:doc.id}))];
    const registry=candidates.filter(row=>row.note.startsWith(REGISTRY_NOTE));
    const cleanup=(key,page)=>{db.prepare("DELETE FROM extracted_fields WHERE company_id=? AND document_id=? AND page=? AND key=? AND automatic=1 AND note NOT LIKE ? AND status NOT IN ('resolved','dismissed')").run(companyId,doc.id,page,key,REGISTRY_NOTE+'%');db.prepare('DELETE FROM facts WHERE company_id=? AND document_id=? AND page=? AND key=? AND confirmed=2').run(companyId,doc.id,page,key);};
    for(const row of registry)cleanup(row.key,row.page);
    for(const row of candidates.filter(row=>row.note.startsWith('Документ личности: ')))cleanup(row.key,row.page);
    for(const page of new Set(registry.filter(row=>row.key.startsWith('director_')).map(row=>row.page)))for(const key of ['contact_name','contact_first_name','contact_last_name','contact_birth_date','contact_residential_address'])cleanup(key,page);
    candidates.push(...splitLegacyNames(previous).filter(candidate=>candidate.documentId===doc.id));
    for(const candidate of candidates){
      const id=createHash('sha256').update(JSON.stringify([companyId,doc.id,candidate.key,candidate.value,candidate.page,candidate.quote])).digest('hex');
      db.prepare('INSERT OR IGNORE INTO extracted_fields VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,companyId,candidate.key,candidate.value,doc.id,candidate.page,candidate.quote,candidate.note,candidate.automatic?'auto':'review',candidate.automatic?1:0);
    }
  }
  refreshAutoFacts(db,companyId);
  return listExtracted(db,companyId);
}
export function listExtracted(db,companyId){return db.prepare('SELECT extracted_fields.*,documents.filename FROM extracted_fields JOIN documents ON documents.id=extracted_fields.document_id WHERE extracted_fields.company_id=? AND extracted_fields.status NOT IN (\'dismissed\',\'resolved\') ORDER BY extracted_fields.key').all(companyId);}
export function refreshAutoFacts(db,companyId){
  const candidates=listExtracted(db,companyId),groups=new Map();
  for(const candidate of candidates){if(!groups.has(candidate.key))groups.set(candidate.key,[]);groups.get(candidate.key).push(candidate);}
  for(const [key,entries] of groups){
    const fact=db.prepare('SELECT * FROM facts WHERE company_id=? AND key=?').get(companyId,key);
    // Candidates explicitly attributed to another company remain available for review,
    // but cannot veto facts from the selected company's documents.
    const eligible=entries.filter(entry=>!entry.note.startsWith('Название в документе отличается от выбранной компании.'));
    if(!eligible.length){if(fact?.confirmed===2)db.prepare('DELETE FROM facts WHERE id=?').run(fact.id);continue;}
    const values=new Set(eligible.map(entry=>comparableValue(key,entry.value)));
    if(values.size>1||(fact?.confirmed===1&&eligible.some(entry=>comparableValue(key,entry.value)!==comparableValue(key,fact.value)))){
      db.prepare("UPDATE extracted_fields SET status='conflict' WHERE company_id=? AND key=? AND status NOT IN ('dismissed','resolved')").run(companyId,key);
      if(fact?.confirmed===2)db.prepare('DELETE FROM facts WHERE id=?').run(fact.id);
      continue;
    }
    const entry=eligible.find(entry=>entry.automatic);
    if(!entry||fact?.confirmed===1)continue;
    db.prepare('INSERT INTO facts(id,company_id,key,value,document_id,page,quote,confirmed) VALUES(?,?,?,?,?,?,?,2) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value,document_id=excluded.document_id,page=excluded.page,quote=excluded.quote,confirmed=2').run(randomUUID(),companyId,key,entry.value,entry.document_id,entry.page,entry.quote);
    db.prepare("UPDATE extracted_fields SET status='auto' WHERE company_id=? AND key=? AND automatic=1 AND status NOT IN ('dismissed','resolved')").run(companyId,key);
  }
}
export function resolveExtracted(db,companyId,selections){
  if(!Array.isArray(selections)||!selections.length||selections.length>100)throw Object.assign(new Error('Выберите до 100 значений.'),{status:400});
  const prepared=selections.map(selection=>{
    const candidate=db.prepare('SELECT * FROM extracted_fields WHERE id=? AND company_id=?').get(selection.id,companyId);
    if(!candidate||!Object.hasOwn(FIELDS,selection.key)||typeof selection.value!=='string'||!selection.value.trim()||selection.value.length>2000||!valueGrounded(selection.key,selection.value.trim(),candidate.quote))throw Object.assign(new Error('Проверьте выбранные значения: они должны соответствовать источнику.'),{status:400});
    return {...candidate,key:selection.key,value:selection.value.trim()};
  });
  if(new Set(prepared.map(row=>row.key)).size!==prepared.length)throw Object.assign(new Error('Для одного типа данных выберите одно значение.'),{status:400});
  db.exec('BEGIN IMMEDIATE');try{
    for(const row of prepared){
      db.prepare('INSERT INTO facts(id,company_id,key,value,document_id,page,quote,confirmed) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value,document_id=excluded.document_id,page=excluded.page,quote=excluded.quote,confirmed=1').run(randomUUID(),companyId,row.key,row.value,row.document_id,row.page,row.quote);
      db.prepare("UPDATE extracted_fields SET status='resolved' WHERE company_id=? AND key IN (?,?)").run(companyId,row.key,db.prepare('SELECT key FROM extracted_fields WHERE id=?').get(row.id).key);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
