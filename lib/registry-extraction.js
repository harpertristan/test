import {compact,isoDate,valueGrounded,countryName} from './normalization.js';
import {splitAddress} from './addresses.js';
export const REGISTRY_NOTE='Регистрационный документ компании: ';
export function registryFields(pages){
 const result=[];const add=(key,value,quote,page,note='')=>{if(value&&valueGrounded(key,value,quote)&&!result.some(r=>r.key===key&&r.value===value&&r.page===page))result.push({key,value,quote,page,note:REGISTRY_NOTE+note,automatic:true});};
 for(const page of pages){
  if(/bank statement|account statement|EUR Statement|Report lost or stolen card/i.test(page.text))continue;
  if(!/certificate of incorporation|companies house|proposed\s+registered|(?:company number|company no)[\s\S]{0,1200}(?:registered office|incorporation)|\bIN01\b/i.test(page.text))continue;
  const lines=page.text.split(/\r?\n/).map(s=>s.trim());
  for(let i=0;i<lines.length;i++){
   const line=lines[i];
   const number=line.match(/\b(?:company (?:registration )?(?:number|no\.?))\s*:?\s*([A-Z]{0,2}\d{6,8})\b/i);if(number)add('company_number',number[1],line,page.page,'Номер по явной подписи Company Number.');
   if(/^(?:company (?:registration )?(?:number|no\.?))\s*:?$/i.test(line)&&/^[A-Z]{0,2}\d{6,8}$/i.test(lines[i+1]||''))add('company_number',lines[i+1],line+'\n'+lines[i+1],page.page,'Номер со следующей строки.');
   const named=line.match(/^(?:proposed (?:company )?name|company name|name of company)\s*:?\s+(.+)$/i);if(named&&/\b(?:LTD|LIMITED|LLP|PLC)$/i.test(named[1]))add('company_name',named[1],line,page.page,'Название из регистрационной формы.');
   if(/^(?:proposed (?:company )?name|company name|name of company)\s*:?$/i.test(line)&&/\b(?:LTD|LIMITED|LLP|PLC)$/i.test(lines[i+1]||''))add('company_name',lines[i+1],line+'\n'+lines[i+1],page.page,'Название со следующей строки.');
   if(/^[A-Z\d &.,'’()-]{3,160}\b(?:LTD|LIMITED|LLP|PLC)$/.test(line)&&!/^CERTIFICATE|^PRIVATE COMPANY|^A PRIVATE|^THE COMPANIES|^COMPANY LIMITED|^PUBLIC COMPANY/.test(line))add('company_name',line,line,page.page,'Название в сертификате регистрации.');
   const date=line.match(/(?:incorporated on|given at[^\n]*? on|date of incorporation)\s*:?\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);if(date){const normal=date[1].replace(/(\d)(st|nd|rd|th)\b/i,'$1'),value=isoDate(normal);if(value)add('incorporated_on',value,line,page.page,'Дата регистрации из сертификата.');}
   const sic=line.match(/^SIC(?: codes?)?\s*:?\s*(\d{5}(?:[ ,]+\d{5})*)$/i);if(sic)add('sic_code',sic[1],line,page.page,'SIC-код деятельности. Это не регистрационный номер.');
   const activity=line.match(/^Principal activity(?: description)?\s*:?\s*(.+)$/i);if(activity&&activity[1]&&!/^description\s*:?$/i.test(activity[1])){add('business_description',activity[1],line,page.page,'Principal activity description из регистрационной формы.');add('industry',activity[1],line,page.page,'Отрасль по напечатанному описанию основной деятельности.');}
   if(/^Principal activity(?: description)?\s*:?$/i.test(line)){for(let j=i+1;j<Math.min(i+4,lines.length);j++){if(!lines[j]||/^description\s*:?$/i.test(lines[j]))continue;if(!/^(?:SIC|Directors?|Company|Registered|Share capital)\b/i.test(lines[j])){const quote=lines.slice(i,j+1).join('\n');add('business_description',lines[j],quote,page.page,'Principal activity description.');add('industry',lines[j],quote,page.page,'Описание основной деятельности.');}break;}}
   const legal=line.match(/private company limited by shares|private company limited by guarantee|public limited company/i);if(legal)add('legal_form',legal[0],line,page.page,'Правовая форма указана прямо.');
   const jurisdiction=line.match(/(?:Registrar of Companies for|registered in|incorporated in)\s+(England and Wales|Scotland|Northern Ireland)/i);if(jurisdiction)add('country',countryName(jurisdiction[1]),jurisdiction[1],page.page,'Юрисдикция регистрации указана в сертификате.');
   if(/^(?:proposed\s+registered|registered\s+office(?:\s+address)?|office\s+address)\b/i.test(line)){
    const block=[];let last=i;
    for(let j=i;j<Math.min(i+15,lines.length);j++){
     const raw=lines[j];if(j>i&&/^(?:SIC(?: codes?)?|principal activity|directors?|officers?|statement of|share capital|capital|company (?:number|name)|service address|residential address)\b/i.test(raw))break;
     let value=raw.replace(/^(?:proposed\s+registered(?:\s+office)?(?:\s+address)?|registered\s+office(?:\s+address)?|office\s+address)\s*:?\s*/i,'').trim();if(value)block.push(value);last=j;
     if(/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i.test(value))break;
    }
    if(!block.length)continue;const quote=lines.slice(i,last+1).join('\n'),full=block.join('\n'),parts=splitAddress(full);
    if(!parts.line1||!parts.city||!parts.postcode||!parts.country)continue;
    if(!/\d/.test(parts.line1)&&parts.line2&&/^\d+[A-Z]?\b/.test(parts.line2)){const chunks=parts.line2.split(', ');parts.line1+=' '+chunks.shift();parts.line2=chunks.join(', ');}
    add('registered_address',compact(full),quote,page.page,'Полный Proposed Registered Office Address.');
    for(const [component,key] of Object.entries({line1:'registered_address_line1',line2:'registered_address_line2',city:'city',postcode:'postal_code',country:'registered_country',region:'registered_region'}))if(parts[component])add(key,parts[component],quote,page.page,'Компонент многострочного Registered Office Address.');
    i=last;
   }
  }
  // Name labels are interpreted as a director only within an explicit appointment block.
  let inDirector=false;let first,last,source=[];
  const flush=()=>{if(first&&last){const quote=source.join('\n');add('director_first_name',first,quote,page.page,'Имя по подписи в блоке директора.');add('director_last_name',last,quote,page.page,'Фамилия по подписи в блоке директора.');if(valueGrounded('director_name',first+' '+last,quote))add('director_name',first+' '+last,quote,page.page,'Имя директора.');}first=last=undefined;source=[];};
  for(let i=0;i<lines.length;i++){const line=lines[i];if(/^(?:proposed )?directors?\b|^appointment of (?:a )?director/i.test(line)){flush();inDirector=true;continue;}if(/^secretary|^subscriber|^person.*significant control|^beneficial owner|^corporate director/i.test(line)){flush();inDirector=false;}
   if(!inDirector)continue;const match=line.match(/^(?:(?:full\s+)?forename(?:s|\(s\))?|first name(?:s)?|given name(?:s)?|surname|last name|family name)\s*:?\s*(.*)$/i);if(!match)continue;
   const label=line.match(/^[^:]+/)[0],value=match[1].trim()||lines[i+1];if(!value||!/^\p{L}[\p{L}'’ .-]+$/u.test(value))continue;if(/surname|last name|family name/i.test(label))last=value;else first=value;source.push(line);if(!match[1].trim())source.push(value);
  }flush();
 }
 return result;
}
