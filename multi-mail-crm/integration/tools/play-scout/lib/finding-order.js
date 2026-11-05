export const SORT_OPTIONS={event_desc:'Релиз / публикация / решение · новые сначала',release_desc:'Дата первого выпуска приложения · новые сначала',publication_desc:'Дата публикации · новые сначала',licence_desc:'Дата решения о лицензии · новые сначала',discovered_desc:'Дата обнаружения · новые сначала',event_asc:'Релиз / публикация / решение · старые сначала',name_asc:'Название · А–Я'};
function date(value){if(!value||/^\d{4}(?:-\d{2})?$/.test(String(value)))return null;const match=String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);if(match)value=match[3]+'-'+match[2]+'-'+match[1];const n=Date.parse(value);return Number.isFinite(n)?n:null;}
export function findingDates(row){
 const normalize=v=>date(v)===null?null:new Date(date(v)).toISOString();const released=normalize(row.released??row.releaseDate),published=normalize(row.publishedAt??row.dateReported??row.published);
 const licence=(row.licences??[]).map(l=>l.decisionDate).filter(Boolean).sort().at(-1)??null;
 return {released,published,licence,event:[released,published,licence].filter(v=>date(v)!==null).sort((a,b)=>date(a)-date(b)).at(-1)??null};
}
export function sortFindings(rows,sort='event_desc'){
 if(!Object.hasOwn(SORT_OPTIONS,sort))sort='event_desc';
 const key=sort.split('_')[0],ascending=sort.endsWith('_asc');
 return [...rows].sort((a,b)=>{
  if(key==='name')return String(a.serviceName??a.title??'').localeCompare(String(b.serviceName??b.title??''),'ru');
  const av=date(key==='discovered'?a.firstFoundAt:findingDates(a)[key==='release'?'released':key==='publication'?'published':key]),bv=date(key==='discovered'?b.firstFoundAt:findingDates(b)[key==='release'?'released':key==='publication'?'published':key]);
  if(av===null||bv===null)return av===bv?String(a.id??a.appId).localeCompare(String(b.id??b.appId)):av===null?1:-1;
  return (ascending?1:-1)*(av-bv)||String(a.id??a.appId).localeCompare(String(b.id??b.appId));
 });
}
