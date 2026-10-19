import { DEFAULT_EXCLUDE_TERMS, eligibleFinding } from './qualification.js';
const $ = s => document.querySelector(s);
const lines = id => $(id).value.split('\n').map(s=>s.trim()).filter(Boolean);
export function readCriteria() {
  return {strictBanking:$('#strict-banking').checked,institutionType:$('#institution-type').value,excludeTerms:lines('#exclude-terms'),excludeAppIds:lines('#exclude-ids'),excludeDomains:lines('#exclude-domains')};
}
export function applyCriteria(config) {
  $('#strict-banking').checked=config.strictBanking ?? true;
  $('#institution-type').value=config.institutionType ?? 'bank';
  $('#exclude-terms').value=(config.excludeTerms ?? DEFAULT_EXCLUDE_TERMS).join('\n');
  $('#exclude-ids').value=(config.excludeAppIds ?? []).join('\n');
  $('#exclude-domains').value=(config.excludeDomains ?? []).join('\n');
}
export function filterRows(rows) {
  return $('#show-archive').checked ? rows : rows.filter(row=>eligibleFinding(row,readCriteria()));
}
export function renderEvidence(entry) {
  const box=document.createElement('details'); box.className='bank-evidence';
  const summary=document.createElement('summary');
  summary.textContent=entry.qualification?.status==='text_matches'?'Есть текстовые признаки · проверить':'Критерии не подтверждены · архив';box.append(summary);
  const names={business:'Счёт для бизнеса',euIban:'IBAN страны ЕС',licence:'Заявленная лицензия'};
  for(const [key,name] of Object.entries(names)) {
    const title=document.createElement('strong');title.textContent=name;box.append(title);
    const items=entry.qualification?.evidence?.[key] ?? [];
    if(!items.length) {const p=document.createElement('p');p.textContent='Доказательство не найдено';box.append(p);}
    for(const item of items) {
      const p=document.createElement('p');p.textContent=item.text;const a=document.createElement('a');a.textContent=` ${item.label} ↗`;a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);box.append(p);
    }
  }
  const p=document.createElement('p');p.textContent='Проверьте банк в реестре регулятора, выдачу собственного IBAN компании и доступность открытия для вашей юрисдикции. Текст источника может быть неточным.';box.append(p);
  return box;
}
