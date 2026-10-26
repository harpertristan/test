import {nigeriaEvidence} from './geography.js';
import{isManuallyHidden}from'./exclusions.js';
import { DEFAULT_EXCLUDE_TERMS, eligibleFinding, reviewCandidate } from './qualification.js';
const $ = s => document.querySelector(s);
const lines = id => $(id).value.split('\n').map(s=>s.trim()).filter(Boolean);
export function readCriteria() {
  return {...($('#event-mode')?{eventMode:$('#event-mode').value}:{}),hideEstablished:$('#hide-established')?.checked ?? false,euIbanMode:$('#eu-iban-mode')?.value ?? 'prefer',profile:$('#profile')?.value ?? 'strict',strictBanking:$('#strict-banking').checked,institutionType:$('#institution-type').value,excludeTerms:lines('#exclude-terms'),excludeAppIds:lines('#exclude-ids'),excludeDomains:lines('#exclude-domains')};
}
export function applyCriteria(config) {
  if($('#profile'))$('#profile').value=config.profile ?? 'strict';
  if($('#strict-controls'))$('#strict-controls').hidden=config.profile==='business';
  $('#strict-banking').checked=config.strictBanking ?? true;
  $('#institution-type').value=config.institutionType ?? 'bank';
  $('#exclude-terms').value=(config.excludeTerms ?? DEFAULT_EXCLUDE_TERMS).join('\n');
  $('#exclude-ids').value=(config.excludeAppIds ?? []).join('\n');
  $('#exclude-domains').value=(config.excludeDomains ?? []).join('\n');
}
export function filterRows(rows) {
  rows=rows.filter(row=>!nigeriaEvidence(row)&&!isManuallyHidden(row));
  return $('#show-archive').checked ? rows : rows.filter(row=>eligibleFinding(row,readCriteria()));
}
export function filterCandidates(rows) { return rows.filter(row => !isManuallyHidden(row)&&reviewCandidate(row,readCriteria())); }
export function renderEvidence(entry) {
  const box=document.createElement('details'); box.className='bank-evidence';
  const summary=document.createElement('summary');
  summary.textContent=entry.discovery ? (entry.discovery.status==='service_match'?'Похожий бизнес-сервис · проверить условия':'Сервис на проверку · условия не подтверждены') : entry.qualification?.status==='text_matches'?'Есть текстовые признаки · проверить':entry.qualification?.isCandidate?'Кандидат · данных недостаточно':'Критерии не подтверждены · архив';box.append(summary);
  if(entry.discovery) {
    const facts=document.createElement('p');
    const d=entry.discovery;
    facts.textContent=`Бизнес: ${d.business==='mentioned'?'упомянут':'не подтверждён'}. IBAN: ${d.iban==='mentioned'?'упомянут':'не подтверждён'}. EU IBAN: ${d.euIban==='explicit_claim'?'есть заявление источника':'не подтверждён'}. SEPA: ${d.sepa==='mentioned'?'упомянут':'не подтверждён'}.`;
    const reason=document.createElement('p');reason.textContent=d.reason;box.append(facts,reason);
    for(const [kind,items] of Object.entries(d.evidence)) for(const item of items.slice(0,1)) {const p=document.createElement('p');p.textContent=`${kind}: ${item.text}`;box.append(p);}
  }
  const names={business:'Счёт для бизнеса',euIban:'IBAN страны ЕС',licence:'Заявленная лицензия'};
  for(const [key,name] of Object.entries(names)) {
    const title=document.createElement('strong');title.textContent=name;box.append(title);
    const items=key==='licence' && entry.discovery?.licence==='unknown' ? [] : (entry.qualification?.evidence?.[key] ?? []);
    if(!items.length) {const p=document.createElement('p');p.textContent='Доказательство не найдено';box.append(p);}
    for(const item of items) {
      const p=document.createElement('p');p.textContent=item.text;const a=document.createElement('a');a.textContent=` ${item.label} ↗`;a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);box.append(p);
    }
  }
  if(entry.updatedAt){const updated=document.createElement('p');updated.textContent=`Обновление приложения: ${entry.updatedAt.slice(0,10)}. Это не дата первого выпуска или основания компании.`;box.append(updated);}
  const p=document.createElement('p');p.textContent='Проверьте организацию в реестре регулятора, выдачу собственного IBAN компании и доступность открытия для вашей юрисдикции. Текст источника может быть неточным.';box.append(p);
  return box;
}
