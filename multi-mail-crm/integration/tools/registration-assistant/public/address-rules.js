// Shared by the server and cabinet. Rules validate field meaning, not whether
// an address exists or is currently registered to a company.
export const UK_POSTCODE=/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
export const providerAddress=/\b(?:provider|supplier|service provider|issuer)\b|адрес поставщика|адрес отправителя/i;
const names={GB:['GB','UK','United Kingdom','England','England and Wales','Great Britain'],LV:['LV','Latvia','Latvija'],MT:['MT','Malta'],US:['US','USA','United States'],CA:['CA','Canada'],NL:['NL','Netherlands'],IE:['IE','Ireland'],PL:['PL','Poland'],PT:['PT','Portugal'],SE:['SE','Sweden']};
const patterns={GB:/^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/,LV:/^LV-?\d{4}$/,MT:/^[A-Z]{3}\d{4}$/,US:/^\d{5}(?:-\d{4})?$/,CA:/^[A-Z]\d[A-Z]\d[A-Z]\d$/,NL:/^\d{4}[A-Z]{2}$/,IE:/^[A-Z0-9]{3}[A-Z0-9]{4}$/,PL:/^\d{2}-\d{3}$/,PT:/^\d{4}-\d{3}$/,SE:/^\d{5}$/};
for(const code of ['DE','FR','ES','IT','LT','EE','FI','HR'])patterns[code]=/^\d{5}$/;
for(const code of ['AU','NZ','BE','CH','AT','DK','NO','LU','HU','BG','SI','CY'])patterns[code]=/^\d{4}$/;
export function postcodeCountry(country=''){
 const value=String(country).trim().toLowerCase();
 return Object.keys(names).find(code=>names[code].some(name=>name.toLowerCase()===value))||String(country).trim().toUpperCase();
}
export function cleanPostcode(raw,country=''){
 const value=String(raw).trim().toUpperCase().replace(/\s+/g,''),code=postcodeCountry(country);
 if(!value||providerAddress.test(raw))return;
 const pattern=patterns[code];
 if(pattern&&!pattern.test(value))return;
 if(!pattern&&!/^(?=[A-Z0-9 -]*\d)[A-Z0-9-]{2,12}$/.test(value))return;
 if(code==='GB'||!pattern&&/^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(value))return value.slice(0,-3)+' '+value.slice(-3);
 if(code==='CA'||code==='IE')return value.slice(0,3)+' '+value.slice(3);
 if(code==='MT')return value.slice(0,3)+' '+value.slice(3);
 if(code==='NL')return value.slice(0,4)+' '+value.slice(4);
 if(code==='SE')return value.slice(0,3)+' '+value.slice(3);
 if(code==='LV')return 'LV-'+value.replace(/^LV-?/,'');
 return value;
}
export function addressIssue(key,raw,country=''){
 const value=String(raw||'').trim();if(!value)return;
 if(!/^(?:city|postal_code|registered_address(?:_line[12])?|operating_address(?:_line[12])?|(?:contact|director|beneficiary)_residential_address|(?:contact|director|beneficiary|operating)_(?:city|postal_code|address_line[12]))$/.test(key))return;
 if(providerAddress.test(value))return 'Это пометка или адрес поставщика, а не адрес заявителя.';
 if(/postal_code$/.test(key))return cleanPostcode(value,country)?undefined:'Укажите только почтовый индекс в формате страны, без города и пояснений.';
 const hasPostcode=UK_POSTCODE.test(value)||/\bLV[- ]?\d{4}\b|\b[A-Z]{3}\s*\d{4}\b/i.test(value);
 if(key==='city'||key.endsWith('_city')){
  if(hasPostcode||/^\d[\d -]*$/.test(value))return 'В поле города попал почтовый индекс. Нужен Town / city из адресного блока.';
  if(Object.values(names).flat().some(name=>name.toLowerCase()===value.toLowerCase()))return 'Здесь нужна запись Town / city, а не страна.';
  if(/\b(?:road|street|avenue|lane|boulevard)\s*\.?$/i.test(value)||/\b(?:limited|ltd|llc|gmbh)\.?$/i.test(value))return 'Здесь нужен город, а не улица или название организации.';
 }
 if(/(?:address_line[12]|registered_address_line[12])$/.test(key)){
  if(hasPostcode)return 'Почтовый индекс должен быть отдельно в Postcode.';
  if(/\b(?:limited|ltd|llc|gmbh)\.?$/i.test(value))return 'В строку улицы попало название организации. Проверьте владельца адреса.';
 }
}
