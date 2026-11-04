import {compact,isoDate,countryName,phoneParts,valueGrounded} from './normalization.js';
import {FIELDS} from './fields.js';
import {registryFields} from './registry-extraction.js';
import {addressFacts} from './addresses.js';

const legal=/\b(?:LTD|LIMITED|LLC|INC|GMBH|OU|OÜ|SIA|UAB|SARL)\.?$/iu;
const person=/^[\p{Script=Latin}][\p{Script=Latin}'’.-]*(?:[ -][\p{Script=Latin}][\p{Script=Latin}'’.-]*)+$/u;
const labels=[
  ['company_name',/^(?:company name|legal name|название компании)\s*[:：=-]\s*(.+)$/i],
  ['company_number',/^(?:company (?:registration )?number|registration number|регистрационный номер)\s*[:：=-]?\s+([A-Z\d -]+)$/i],
  ['tax_number',/^(?:UTR|TIN|unique taxpayer reference(?: number)?|corporation tax reference|tax number|company tax number|tax identification number|ИНН)\s*[:：=-]?\s+([A-Z\d -]{5,30})$/i],
  ['vat_number',/^(?:VAT(?: registration| identification)?(?: number| no\.?| id)?|value added tax registration number|номер НДС)\s*[:：=-]?\s+([A-Z\d .-]{5,30})$/i],
  ['tax_residence_country',/^(?:country of tax residence|tax residence country|tax residency|страна налогового резидентства)\s*[:：=-]\s*(.+)$/i],
  ['trading_name',/^(?:trading name|trade name|doing business as|DBA)\s*[:：=-]\s*(.+)$/i],
  ['legal_form',/^(?:company legal form|company type|legal form|type of company)\s*[:：=-]\s*(.+)$/i],
  ['lei_code',/^(?:LEI(?: code)?|legal entity identifier)\s*[:：=-]?\s+([A-Z\d]{20})$/i],
  ['incorporated_on',/^(?:incorporated on|date of incorporation|incorporation date|дата регистрации)\s*[:：=-]?\s+(.+)$/i],
  ['country',/^(?:country of incorporation|country of registration|страна регистрации)\s*[:：=-]?\s+(.+)$/i],
  ['registered_address',/^(?:registered (?:office |company )?address|юридический адрес)\s*[:：=-]\s*(.+)$/i],
  ['operating_address',/^(?:operating address|principal place of business|адрес деятельности)\s*[:：=-]\s*(.+)$/i],
  ['city',/^(?:registered (?:office )?city|registered town|postal town)\s*[:：=-]\s*(.+)$/i],
  ['postal_code',/^(?:registered postal code|registered postcode)\s*[:：=-]\s*(.+)$/i],
  ['company_email',/^(?:work email|company email|business email|email компании)\s*[:：=-]\s*(.+)$/i],
  ['company_phone',/^(?:company phone|business phone|phone number|телефон)\s*[:：=-]\s*(.+)$/i],
  ['website',/^(?:web\s*site|company website|url|сайт)\s*[:：=-]\s*(https?:\/\/\S+)$/i],
  ['director_name',/^(?:director(?: full)? name|director|имя директора|директор)\s*[:：=-]\s*(.+)$/i],
  ['beneficiary_name',/^(?:beneficiary(?: full)? name|beneficial owner|ubo|бенефициар)\s*[:：=-]\s*(.+)$/i],
  ['contact_first_name',/^(?:first name|given name|имя)\s*[:：=-]\s*(.+)$/i],
  ['contact_last_name',/^(?:last name|surname|family name|фамилия)\s*[:：=-]\s*(.+)$/i],
  ['contact_birth_date',/^(?:date of birth|birth date|dob|дата рождения)\s*[:：=-]\s*(.+)$/i],
  ['contact_passport_number',/^(?:passport number|passport no|номер паспорта)\s*[:：=-]\s*(.+)$/i],
  ['contact_passport_expiry',/^(?:passport expiry date|passport expiration date|date of expiry|expiry date)\s*[:：=-]\s*(.+)$/i],
  ['contact_residential_address',/^(?:residential address|home address|адрес проживания)\s*[:：=-]\s*(.+)$/i],
  ['industry',/^(?:industry|sector|отрасль)\s*[:：=-]\s*(.+)$/i],
  ['annual_transaction_volume',/^(?:annual(?:ized)? transaction volume(?: \(EUR\))?|годовой объем операций)\s*[:：=-]\s*(.+)$/i],
  ['account_purpose',/^(?:account purpose|purpose of account|цель открытия сч[её]та)\s*[:：=-]\s*(.+)$/i],
  ['product_interest',/^(?:product interest|интересующий продукт)\s*[:：=-]\s*(.+)$/i],
  ['director_first_name',/^(?:director first name|director given name)\s*[:：=-]\s*(.+)$/i],
  ['director_last_name',/^(?:director last name|director surname)\s*[:：=-]\s*(.+)$/i]
];

export function extractFields(pages,companyName='') {
  const output=[];
  function add(key,value,quote,page,note='',automatic=true){
    value=compact(value);quote=quote.trim();
    if(key==='company_phone')value=phoneParts(value)?.company_phone||value;
    if(['tax_number','vat_number','lei_code'].includes(key))value=value.replace(/\s+/g,'');
    if(!value||value.length>2000||quote.length>5000||!valueGrounded(key,value,quote))return;
    if(['tax_number','vat_number'].includes(key)&&(!/\d/.test(value)||!/^([A-Z]{0,3})[A-Z\d][A-Z\d.-]{4,25}$/i.test(value)))return;
    if(output.some(c=>c.key===key&&c.value===value&&c.page===page))return;
    output.push({key,value,quote,page,note,automatic});
  }
  function nameParts(prefix,name,quote,page,automatic=true){
    const parts=compact(name).split(/\s+/);
    if(parts.length===2&&parts.every(p=>/^[\p{Script=Latin}][\p{Script=Latin}'’.-]*$/u.test(p))){
      const note='Двухчастное латинское имя разделено в порядке «имя → фамилия». Проверьте порядок по документу; при необходимости поменяйте значения.';
      add(prefix+'_first_name',parts[0],quote,page,note,automatic);
      add(prefix+'_last_name',parts[1],quote,page,note,automatic);
    }
  }
  for(const page of pages){
    const lines=page.text.split(/\r?\n/).map(line=>line.trim());
    const statement=/\b(?:bank statement|account statement|EUR Statement|Generated on|Report lost or stolen card)\b/i.test(page.text);
    // A bank's regulatory footer belongs to its issuer, not the applicant.
    if(statement||/utility bill|electricity bill|elektrum|summa apmaksai|council tax bill|water bill|gas bill/i.test(page.text))continue;
    let registeredAddress;
    for(let i=0;i<lines.length;i++){
      const line=lines[i];if(!line||/password|парол|secret|api.?key|access.?token/i.test(line))continue;
      for(const [key,title] of Object.entries(FIELDS)){
        if(line.startsWith(title+':')){
          const raw=line.slice(title.length+1).trim();let value=raw;
          if(/(?:_on|_birth_date|_expiry)$/.test(key))value=isoDate(raw)||raw;
          if(key==='country'||key.endsWith('_country'))value=countryName(raw)||raw;
          add(key,value,line,page.page,'Структурированная анкета оператора.');
          if(['contact_name','director_name','beneficiary_name'].includes(key))nameParts(key.replace(/_name$/,''),value,line,page.page);
          if(key==='company_phone')for(const [part,partValue] of Object.entries(phoneParts(raw)||{}))if(partValue)add(part,partValue,line,page.page);
        }
      }
      for(const [key,pattern] of labels){
        const match=line.match(pattern);if(!match)continue;
        let value=match[1];
        if(/(?:_on|_birth_date|_expiry)$/.test(key))value=isoDate(value)||'';
        if(key==='country'||key.endsWith('_country'))value=countryName(value)||value;
        add(key,value,line,page.page);
        if(['director_name','beneficiary_name'].includes(key))nameParts(key.replace(/_name$/,''),value,line,page.page);
        if(key==='registered_address')registeredAddress={value,quote:line};
        if(key==='company_phone')for(const [part,partValue] of Object.entries(phoneParts(value)||{}))if(partValue)add(part,partValue,line,page.page);
      }
      const headings={'first name':'contact_first_name','given name':'contact_first_name','given names':'contact_first_name','surname':'contact_last_name','last name':'contact_last_name','family name':'contact_last_name','date of birth':'contact_birth_date','passport number':'contact_passport_number','passport no':'contact_passport_number','date of expiry':'contact_passport_expiry','expiry date':'contact_passport_expiry','vat registration number':'vat_number','vat number':'vat_number','tax number':'tax_number','unique taxpayer reference':'tax_number','utr':'tax_number','tin':'tax_number','company legal form':'legal_form','company type':'legal_form','country of tax residence':'tax_residence_country'};
      const heading=headings[line.replace(/[.:]$/,'').toLowerCase()];
      if(heading&&lines[i+1]){const raw=lines[i+1],value=/(?:_birth_date|_expiry)$/.test(heading)?isoDate(raw):raw;if(value)add(heading,value,line+'\n'+raw,page.page,'Сведения по подписи поля документа.');}
      if(i===0&&legal.test(line)&&line.length<180&&!labels.some(([,pattern])=>pattern.test(line))&&!Object.values(FIELDS).some(title=>line.startsWith(title+':')))add('company_name',line,line,page.page,'Название из шапки документа.');
      if(/^(?:registered (?:office )?address|юридический адрес)\s*:?$/i.test(line)){
        const next=[];for(let j=i+1;j<Math.min(lines.length,i+5)&&lines[j]&&!labels.some(([,pattern])=>pattern.test(lines[j]));j++)next.push(lines[j]);
        if(next.length){registeredAddress={value:next.join(' '),quote:lines.slice(i,i+1+next.length).join('\n')};add('registered_address',registeredAddress.value,registeredAddress.quote,page.page);}
      }
      if(/^(?:operating address|principal place of business|адрес деятельности)\s*:?$/i.test(line)){
        const next=[];for(let j=i+1;j<Math.min(lines.length,i+5)&&lines[j]&&!labels.some(([,pattern])=>pattern.test(lines[j]));j++)next.push(lines[j]);
        if(next.length)add('operating_address',next.join(' '),lines.slice(i,i+1+next.length).join('\n'),page.page);
      }
      if(/^https?:\/\/[^\s]+$/i.test(line))add('website',line,line,page.page,'Ссылка из блокнота.');
      if(/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(line))add('company_email',line,line,page.page,'Email из блокнота. Проверьте, что это рабочий контакт компании.');
      if(/^\+[\d ()-]{7,25}\d$/.test(line))for(const [key,value] of Object.entries(phoneParts(line)||{}))if(value)add(key,value,line,page.page,'Международный телефон из блокнота.');
      if(/^(?:Account purpose|Purpose of account|Цель открытия сч[её]та)\s*:?$/i.test(line)){
        let j=i+1;while(j<lines.length&&!lines[j])j++;const start=j;while(j<lines.length&&lines[j])j++;
        if(j>start)add('account_purpose',lines.slice(start,j).join(' '),lines.slice(start,j).join('\n'),page.page);
      }
      if(/^\d+\s*(?:символов|characters)\s*$/i.test(line)){
        let j=i+1;while(j<lines.length&&!lines[j])j++;
        if(lines[j])add('business_description_short',lines[j],lines[j],page.page,'Краткое описание из блокнота.');
      }
    }
    if(registeredAddress){
      const parts=registeredAddress.value.split(',').map(s=>s.trim());
      const country=parts.map(part=>countryName(part)).filter(Boolean);
      if(new Set(country).size===1)add('country',country[0],registeredAddress.quote,page.page,'Страна предложена по зарегистрированному адресу; проверьте юрисдикцию регистрации.');
      const postcode=registeredAddress.value.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0];
      if(postcode)add('postal_code',postcode,registeredAddress.quote,page.page);
    }
    const people=[];
    for(let i=0;i<lines.length-2;i++)if(person.test(lines[i])&&!legal.test(lines[i])&&/^[A-Z]{1,3}\d{6,9}$/.test(lines[i+1])&&isoDate(lines[i+2]))people.push(i);
    for(const index of people){
      const name=lines[index],quote=lines.slice(index,index+3).join('\n'),automatic=people.length===1;
      const note='Контактное лицо из блока «имя, документ, дата рождения». Роль директора или бенефициара не определяется по одному имени.';
      add('contact_name',name,quote,page.page,note,automatic);nameParts('contact',name,quote,page.page,automatic);
      add('contact_passport_number',lines[index+1],quote,page.page,note,automatic);
      add('contact_birth_date',isoDate(lines[index+2]),quote,page.page,note,automatic);
      if(/^\d{6}-\d{5}$/.test(lines[index+3]||''))add('contact_personal_id',lines[index+3],lines.slice(index,index+4).join('\n'),page.page,note,automatic);
      for(let j=index+3;j<Math.min(index+7,lines.length);j++){
        const expiry=lines[j].match(/^(?:date of expiry|expiry date|срок действия)\s*:?\s+(.+)$/i);
        if(expiry&&isoDate(expiry[1])){
          add('contact_passport_expiry',isoDate(expiry[1]),lines[j],page.page,note,automatic);
          if(lines[j+1]&&/[,\d]/.test(lines[j+1]))add('contact_residential_address',lines[j+1],lines[j+1],page.page,note,automatic);
        }
      }
    }
    const company=compact(companyName).toLowerCase();
    const start=lines.findIndex(line=>line.toLowerCase().startsWith(company+' ')&&/\b(?:sells|provides|operates|supplies)\b/i.test(line));
    if(start>=0){let end=start+1;while(end<lines.length&&lines[end]&&!/^\d+\s*(?:символов|characters)/i.test(lines[end]))end++;
      add('business_description',lines.slice(start,end).join(' '),lines.slice(start,end).join('\n'),page.page);}
  }
  const registry=registryFields(pages);const registryPages=new Set(registry.map(row=>row.page));for(let i=output.length-1;i>=0;i--)if(registryPages.has(output[i].page)&&output[i].key==='website'&&/\.gov\.uk(?:[/:]|$)|companieshouse/i.test(output[i].value))output.splice(i,1);
  const directorPages=new Set(registry.filter(row=>row.key==='director_first_name'||row.key==='director_last_name').map(row=>row.page));for(let i=output.length-1;i>=0;i--)if(directorPages.has(output[i].page)&&output[i].key.startsWith('contact_'))output.splice(i,1);for(let i=output.length-1;i>=0;i--)if(registry.some(row=>row.page===output[i].page&&row.key===output[i].key))output.splice(i,1);for(const row of registry)add(row.key,row.value,row.quote,row.page,row.note,row.automatic);
  for(const full of [...output].filter(row=>['registered_address','operating_address','contact_residential_address'].includes(row.key))){
    for(const part of addressFacts(full.key,full.value))add(part.key,part.value,full.quote,full.page,part.note,full.automatic);
  }
  // If the document supplied a different legal company, do not auto-import its
  // identifiers into the selected company. The user can review these candidates.
  const names=output.filter(c=>c.key==='company_name');
  const companyCore=value=>compact(value).toLowerCase().replace(/\b(?:ltd|limited|llc|inc)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(companyName&&names.length&&names.every(c=>{const name=companyCore(c.value),selected=companyCore(companyName);return name!==selected&&!name.startsWith(selected+' ');} ))for(const candidate of output){candidate.automatic=false;candidate.note='Название в документе отличается от выбранной компании. Проверьте принадлежность документа.';}
  return output;
}

export function splitLegacyNames(facts){
  const result=[];
  for(const fact of facts.filter(f=>['director_name','beneficiary_name'].includes(f.key))){
    const parts=compact(fact.value).split(/\s+/);
    if(parts.length===2&&parts.every(p=>/^[\p{Script=Latin}][\p{Script=Latin}'’.-]*$/u.test(p)))for(const [suffix,value] of [['first_name',parts[0]],['last_name',parts[1]]])result.push({key:fact.key.replace(/name$/,suffix),value,quote:fact.quote,page:fact.page,documentId:fact.document_id,automatic:true,note:'Имя разделено из ранее сохранённого полного имени в порядке «имя → фамилия». Проверьте порядок по документу.'});
  }
  return result;
}
