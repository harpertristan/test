import {compact,comparableValue,valueGrounded} from './normalization.js';
import {splitAddress} from './addresses.js';
export const PERSONAL_PROOF_NOTE='Подтверждение личного адреса: ';
const strictName=value=>compact(value).normalize('NFC').toLowerCase().replace(/[,]/g,'').replace(/\s+/g,' ');const nameKey=value=>strictName(value).normalize('NFKD').replace(/\p{M}/gu,'');
export function knownPeople(rows){
 const result=[];for(const role of ['contact','director','beneficiary']){
  const names=new Set(rows.filter(r=>r.key===role+'_name').map(r=>compact(r.value)));
  const first=[...new Set(rows.filter(r=>r.key===role+'_first_name').map(r=>r.value))],last=[...new Set(rows.filter(r=>r.key===role+'_last_name').map(r=>r.value))];if(first.length===1&&last.length===1)names.add(first[0]+' '+last[0]);
  for(const name of names)if(name.trim().split(/\s+/).length>=2)result.push({role,name});
 }return result;
}
export function personalProofFields(pages,people){
 const output=[];const add=(key,value,quote,page,note,automatic)=>{if(value&&valueGrounded(key,value,quote)&&!output.some(r=>r.key===key&&comparableValue(key,r.value)===comparableValue(key,value)))output.push({key,value,quote,page,note,automatic});};
 for(const page of pages){
  if(!/bank statement|account statement|EUR Statement|current account|utility bill|electricity|elektr|līguma|liguma|summa apmaksai|water bill|gas bill|council tax|proof of address/i.test(page.text))continue;
  const lines=page.text.split(/\r?\n/).map(s=>s.trim());
  for(let i=0;i<lines.length;i++){
   const line=lines[i],normalized=nameKey(line.replace(/^(?:klients|client|customer(?: name)?|account holder(?: name)?|statement for)\s*:?\s*/i,''));
   const strictLine=strictName(line.replace(/^(?:klients|client|customer(?: name)?|account holder(?: name)?|statement for)\s*:?\s*/i,'')),exact=people.filter(person=>strictLine===strictName(person.name)||strictLine.startsWith(strictName(person.name)+' ')),candidates=people.filter(person=>nameKey(person.name)===normalized||normalized.startsWith(nameKey(person.name)+' '));const owners=exact.length?exact:new Set(candidates.map(person=>strictName(person.name))).size===1?candidates:[];if(!owners.length)continue;
   // Follow only the named recipient's mailing-address block; never scan a provider footer.
   const address=[];let end=i;
   const flat=compact(line),matchName=owners.find(owner=>flat.toLowerCase().includes(compact(owner.name).toLowerCase())),tail=matchName?flat.slice(flat.toLowerCase().indexOf(compact(matchName.name).toLowerCase())+compact(matchName.name).length).replace(/^\s*(?:address|adrese)\s*:?\s*/i,'').trim():'';
   for(let j=tail?i:i+1;j<Math.min(i+10,lines.length);j++){
    const raw=j===i?tail:lines[j];if(!raw)continue;
    if(/report lost|generated on|registered (?:office|address)|company (?:number|registration)|bank (?:uab|plc)|licensed|regulated|konstitucijos|līguma nr|liguma nr|account (?:number|summary)|iban|sort code|summa|period|payment|apmaks|maksā|maksaj|elektrības objekta|supply address|service address/i.test(raw))break;
    const value=raw.replace(/^(?:adrese|address|residential address|mailing address)\s*:?\s*/i,'').trim();if(!value)continue;
    if(!address.length&&(!/\d/.test(value)||/^[\d .,+-]+(?:EUR|GBP|USD|€|£|\$)?$/i.test(value)))continue;
    address.push(value);end=j;
    const joined=address.join('\n'),parts=splitAddress(joined);if(parts.postcode&&parts.country)break;
   }
   if(!address.length||(address.length===1&&!address[0].includes(','))||!/(?:\bLV[- ]?\d{4}\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b|\b[A-Z]{3}\s*\d{4}\b)/i.test(address.join(' ')))continue;
   const quote=lines.slice(i,end+1).join('\n'),full=address.join(', '),parts=splitAddress(address.join('\n')),note='Личный адрес из счёта / выписки: имя клиента совпало с известным представителем. Это не адрес поставщика услуг и не адрес компании.';
   for(const owner of owners){const prefix=owner.role,identityExact=exact.some(person=>person.role===owner.role&&strictName(person.name)===strictName(owner.name)),ownerNote=PERSONAL_PROOF_NOTE+'Имя клиента: '+owner.name+'\n'+(identityExact?'':'Имя отличается диакритикой — требуется проверка оператором.\n')+note;add(prefix+'_residential_address',full,quote,page.page,ownerNote,identityExact);for(const [component,suffix] of Object.entries({line1:'address_line1',line2:'address_line2',city:'city',postcode:'postal_code',country:'country',region:'region'}))if(parts[component])add(prefix+'_'+suffix,parts[component],quote,page.page,ownerNote,identityExact);}
  }
 }return output;
}
