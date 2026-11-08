export const CRM_VIEW_LABELS={active:'Рабочий список',approved:'Подтверждено мной',new:'Впервые найденные',review:'Проверить вручную',worked:'В работе / был в работе',known:'Уже известные',confirmed:'Совпадения ИИ',watch:'Наблюдать',selected:'Итоговый список',licences:'Лицензии',excluded:'Исключены вручную',rejected:'Не подходит',auto_excluded:'Автоисключения',reference:'Материалы источников',source_archive:'Архив источников',all:'Все'};
export const CRM_MAIN_VIEWS={suitable:'Подходят',needs_review:'На проверку',known_work:'Уже в работе',archive:'Отсеяно'};
Object.assign(CRM_VIEW_LABELS,CRM_MAIN_VIEWS,{archive:'Архив отсева'});
const inactive=new Set(['excluded','auto_excluded','rejected','source_archive','reference','known']);
export function matchesCRMView(row,view){
 const active=!inactive.has(row.status);
 if(view==='suitable')return active&&!row.worked&&['approved','confirmed','selected'].includes(row.status);
 if(view==='known_work')return Boolean(row.worked||row.status==='known'||row.manualExcluded&&['worked','known'].includes(row.exclusionReason));
 if(view==='needs_review')return active&&!matchesCRMView(row,'suitable')&&!row.worked&&(row.screening?.eligible!==false||Boolean(row.manualStatusAt));
 if(view==='archive')return !matchesCRMView(row,'suitable')&&!matchesCRMView(row,'known_work')&&!matchesCRMView(row,'needs_review');
 if(view==='active'||view==='all')return active;
 if(view==='worked')return Boolean(row.worked||row.manualExcluded&&row.exclusionReason==='worked');
 if(view==='review')return active&&(row.needsManualReview||['review','watch'].includes(row.status));
 if(view==='new')return active&&Boolean(row.isNew);
 if(view==='licences')return active&&Boolean(row.licenceLead);
 return row.status===view;
}
export function reviewQuestion(row){
 if(matchesCRMView(row,'suitable'))return row.approval?'Отмечено вами как подходящий провайдер.':row.status==='selected'?'Сохранён в вашем итоговом списке.':['business','account','euIban'].every(k=>row.facts?.[k]?.status==='yes')?'Источниками подтверждены бизнес-счёт и IBAN страны ЕС.':'Сохранён как подходящий; подтверждения критериев смотрите в карточке.';
 if(matchesCRMView(row,'known_work'))return 'Не участвует в повторном поиске и разборе.';
 if(row.autoExclusion)return row.autoExclusion;
 if(!row.model||['pre_ai_screen','registry_event'].includes(row.analysisMethod))return 'Проверить бизнес-счёт, предоставление реквизитов и страну IBAN.';
 const missing=[];if(row.facts?.business?.status!=='yes')missing.push('обслуживание компаний');if(row.facts?.account?.status!=='yes')missing.push('предоставление счёта');if(row.facts?.euIban?.status!=='yes')missing.push('IBAN страны ЕС');
 return missing.length?'Нужно подтвердить: '+missing.join(', ')+'.':'Уточнить противоречия в источниках.';
}
