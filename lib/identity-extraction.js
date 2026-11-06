import {mrzRecords} from './mrz.js';
import {compact,valueGrounded,isoDate,mrzBirthDate,countryName} from './normalization.js';

// Printed field labels establish name order. A passport does not establish a
// company role; these values therefore belong to the contact person only.
export function identityFields(pages){
 const result=[];
 const label=/^(?:(?:\d{1,2}[. )]+)?)(surname(?:s|\(s\))?|family name(?:s|\(s\))?|last name|given name(?:s|\(s\))?|first name(?:s|\(s\))?|forename(?:s|\(s\))?|uzvārds|vārds|фамилия|имя)(?:\s*\/\s*(?:surname|given names?|uzvārds|vārds|фамилия|имя))*\s*[:：.-]?\s*(.*)$/iu;
 const valid=value=>value.length<=120&&/^\p{L}[\p{L}\p{M}'’ -]*$/u.test(value)&&!label.test(value)&&! /^(?:passport|identity card|nationality|sex|date of birth|signature)$/i.test(value);
 for(const page of pages){
  if(!/passport|identity card|\bid card\b|identity document|personas apliecība|pase\b|паспорт|удостоверение личности|(?:^|\n)[PACI][A-Z<][A-Z<]{3}[A-Z0-9<]{25,39}(?:\n|$)/iu.test(page.text))continue;
  const lines=page.text.split(/\r?\n/).map(s=>s.trim()),found=[];
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(label);if(!match)continue;
   const value=compact(match[2]||lines[i+1]||'');if(!valid(value))continue;
   const key=/surname|family|last|uzvārds|фамилия/i.test(match[1])?'contact_last_name':'contact_first_name';
   const quote=match[2]?lines[i]:lines[i]+'\n'+lines[i+1];
   if(valueGrounded(key,value,quote))found.push({key,value,quote,page:page.page,note:'Документ личности: имя по явной подписи поля. Роль в компании требует отдельной сверки.',automatic:true});
  }
  const birthLabel=/^(?:(?:\d{1,2}[. )]+)?)(?:date of birth|birth date|dob|dzimšanas datums|дата рождения)(?:\s*\/\s*(?:date of birth|birth date|dzimšanas datums|дата рождения))*\s*[:：.-]?\s*(.*)$/iu;
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(birthLabel);if(!match)continue;
   const raw=compact(match[1]||lines[i+1]||''),value=isoDate(raw),quote=match[1]?lines[i]:lines[i]+'\n'+lines[i+1];
   if(value&&value<=new Date().toISOString().slice(0,10)&&valueGrounded('contact_birth_date',value,quote))found.push({key:'contact_birth_date',value,quote,page:page.page,note:'Документ личности: дата рождения по явной подписи поля. Сверьте владельца документа.',automatic:true});
  }
  for(const line of lines){const value=mrzBirthDate(line);if(value)found.push({key:'contact_birth_date',value,quote:line,page:page.page,note:'Документ личности: дата рождения из MRZ с верной контрольной цифрой. Проверьте век и владельца по печатным полям.',automatic:true});}
  const passport=/passport|pase\b|паспорт|(?:^|\n)[PACI][A-Z<][A-Z<]{3}[A-Z0-9<]{25,39}(?:\n|$)/iu.test(page.text),prefix=passport?'contact_passport':'contact_id';
  const labels=[
   [prefix+'_number',/^(?:passport(?:\s*(?:number|no\.?|#))?|document\s*(?:number|no\.?)|identity card\s*(?:number|no\.?)|id card\s*(?:number|no\.?)|pases (?:numurs|nr\.?)|dokumenta (?:numurs|nr\.?)|номер паспорта|номер документа)(?:\s*\/\s*(?:passport no\.?|document number|pases (?:numurs|nr\.?)|dokumenta (?:numurs|nr\.?)))*\s*[:：-]?\s*(.*)$/iu,'number'],
   [prefix+'_expiry',/^(?:passport expiry date|passport expiration date|date of expiry|date of expiration|expiry date|valid until|derīga līdz|срок действия)(?:\s*\/\s*(?:date of expiry|derīga līdz))*\s*[:：.-]?\s*(.*)$/iu,'date'],
   [prefix+'_issued_on',/^(?:date of issue|issue date|issued on|izdošanas datums|дата выдачи)(?:\s*\/\s*(?:date of issue|izdošanas datums))*\s*[:：.-]?\s*(.*)$/iu,'date'],
   ['contact_nationality',/^(?:nationality|citizenship|pilsonība|гражданство)(?:\s*\/\s*(?:nationality|citizenship|pilsonība))*\s*[:：.-]?\s*(.*)$/iu,'country'],
   ['contact_issuing_country',/^(?:country of issue|issuing country|issuing state|code of issuing state|valsts|страна выдачи)\s*[:：.-]?\s*(.*)$/iu,'country'],
   ['contact_personal_id',/^(?:personal (?:identification )?(?:number|code)|personal id|personas kods|личный код|персональный код)\s*[:：.-]?\s*(.*)$/iu,'personal'],
   ['contact_gender',/^(?:sex|gender|dzimums|пол)(?:\s*\/\s*(?:sex|gender|dzimums))*\s*[:：.-]?\s*(.*)$/iu,'gender']
  ];
  for(let i=0;i<lines.length;i++)for(const [key,pattern,kind] of labels){const match=lines[i].match(pattern);if(!match)continue;const raw=compact(match[1]||lines[i+1]||''),quote=match[1]?lines[i]:lines[i]+'\n'+lines[i+1];let value;
   if(kind==='number'){const number=raw.toUpperCase().replace(/\s/g,'');if(/^[A-Z0-9][A-Z0-9-]{4,24}$/.test(number)&&/\d/.test(number))value=number;}
   if(kind==='date')value=isoDate(raw);
   if(kind==='country')value=countryName(raw);
   if(kind==='personal'&&/^[A-Z0-9][A-Z0-9 -]{4,29}$/i.test(raw)&&/\d{3}/.test(raw))value=raw;
   if(kind==='gender')value=/^(?:m|male|vīrietis|мужской)$/iu.test(raw)?'M':/^(?:f|female|sieviete|женский)$/iu.test(raw)?'F':/^x$/i.test(raw)?'X':undefined;
   if(value)found.push({key,value,quote,page:page.page,note:'Документ личности: реквизит по явной подписи поля. Сверьте владельца документа.',automatic:true});
  }
  for(const record of mrzRecords(lines))for(const [key,value] of Object.entries(record.values)){
   if(found.some(row=>row.key===key))continue;
   found.push({key,value,quote:record.quote,page:page.page,note:'Документ личности: MRZ; контрольные цифры номера и дат проверяются отдельно. Сверьте печатные поля и владельца.',automatic:true});
  }
  // Conflicting printed alternatives are deliberately retained: reconciliation
  // will require a choice rather than silently selecting the first person.
  for(const row of found)if(!result.some(other=>other.key===row.key&&other.value===row.value&&other.page===row.page))result.push(row);
 }
 return result;
}
