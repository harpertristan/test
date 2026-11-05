import {compact,valueGrounded} from './normalization.js';

// Printed field labels establish name order. A passport does not establish a
// company role; these values therefore belong to the contact person only.
export function identityFields(pages){
 const result=[];
 const label=/^(?:(?:\d{1,2}[. )]+)?)(surname(?:s|\(s\))?|family name(?:s|\(s\))?|last name|given name(?:s|\(s\))?|first name(?:s|\(s\))?|forename(?:s|\(s\))?|uzvārds|vārds|фамилия|имя)(?:\s*\/\s*(?:surname|given names?|uzvārds|vārds|фамилия|имя))*\s*[:：.-]?\s*(.*)$/iu;
 const valid=value=>value.length<=120&&/^\p{L}[\p{L}\p{M}'’ -]*$/u.test(value)&&!label.test(value)&&! /^(?:passport|identity card|nationality|sex|date of birth|signature)$/i.test(value);
 for(const page of pages){
  if(!/passport|identity card|identity document|personas apliecība|pase\b|паспорт|удостоверение личности|\bP<[A-Z]{3}/iu.test(page.text))continue;
  const lines=page.text.split(/\r?\n/).map(s=>s.trim()),found=[];
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(label);if(!match)continue;
   const value=compact(match[2]||lines[i+1]||'');if(!valid(value))continue;
   const key=/surname|family|last|uzvārds|фамилия/i.test(match[1])?'contact_last_name':'contact_first_name';
   const quote=match[2]?lines[i]:lines[i]+'\n'+lines[i+1];
   if(valueGrounded(key,value,quote))found.push({key,value,quote,page:page.page,note:'Документ личности: имя по явной подписи поля. Роль в компании требует отдельной сверки.',automatic:true});
  }
  // Conflicting printed alternatives are deliberately retained: reconciliation
  // will require a choice rather than silently selecting the first person.
  for(const row of found)if(!result.some(other=>other.key===row.key&&other.value===row.value&&other.page===row.page))result.push(row);
 }
 return result;
}
