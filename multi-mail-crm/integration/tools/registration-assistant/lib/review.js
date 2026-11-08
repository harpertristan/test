import {createHash} from 'node:crypto';
export function reviewState(db,companyId){
  const documents=db.prepare('SELECT id,pages FROM documents WHERE company_id=? ORDER BY id').all(companyId);
  const facts=db.prepare('SELECT key,value,document_id,page,quote,confirmed FROM facts WHERE company_id=? ORDER BY key').all(companyId);
  const unresolved=db.prepare("SELECT id,key,value,status FROM extracted_fields WHERE company_id=? AND status IN ('review','conflict') ORDER BY id").all(companyId);
  const signature=createHash('sha256').update(JSON.stringify({documents,facts,unresolved})).digest('hex');
  const stored=db.prepare('SELECT * FROM company_confirmations WHERE company_id=?').get(companyId);
  return {signature,approved:Boolean(stored&&stored.signature===signature&&facts.length&&!unresolved.length),factsCount:facts.length,unresolvedCount:unresolved.length,confirmedAt:stored?.confirmed_at||null};
}
export function confirmReview(db,companyId,signature){
  const current=reviewState(db,companyId);
  if(current.signature!==signature)throw Object.assign(new Error('Документы или данные изменились. Обновите итоговую карточку и проверьте её заново.'),{status:409});
  if(!current.factsCount||current.unresolvedCount)throw Object.assign(new Error('Сначала выберите итоговые значения для всех расхождений и проверьте данные.'),{status:409});
  db.prepare('INSERT INTO company_confirmations VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET signature=excluded.signature,confirmed_at=excluded.confirmed_at').run(companyId,signature,new Date().toISOString());
  return reviewState(db,companyId);
}
