export const CRM_VIEW_LABELS={active:'Рабочий список',approved:'Подтверждено мной',new:'Впервые найденные',review:'Проверить вручную',worked:'В работе / был в работе',known:'Уже известные',confirmed:'Совпадения ИИ',watch:'Наблюдать',selected:'Итоговый список',licences:'Лицензии',excluded:'Исключены вручную',rejected:'Не подходит',auto_excluded:'Автоисключения',reference:'Материалы источников',source_archive:'Архив источников',all:'Все'};
const inactive=new Set(['excluded','auto_excluded','rejected','source_archive','reference','known']);
export function matchesCRMView(row,view){
 const active=!inactive.has(row.status);
 if(view==='active'||view==='all')return active;
 if(view==='worked')return Boolean(row.worked||row.manualExcluded&&row.exclusionReason==='worked');
 if(view==='review')return active&&(row.needsManualReview||['review','watch'].includes(row.status));
 if(view==='new')return active&&Boolean(row.isNew);
 if(view==='licences')return active&&Boolean(row.licenceLead);
 return row.status===view;
}
