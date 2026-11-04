import {compact,countryCode,countryName} from './normalization.js';

const counties=/^(?:county of )?(?:hampshire|surrey|kent|essex|west sussex|east sussex|west yorkshire|north yorkshire|south yorkshire|northamptonshire|nottinghamshire|derbyshire|leicestershire|lincolnshire|lancashire|cheshire|devon|dorset|somerset|cornwall|oxfordshire|berkshire|buckinghamshire|cambridgeshire|gloucestershire|worcestershire|warwickshire|staffordshire|shropshire|suffolk|norfolk|hertfordshire|bedfordshire|wiltshire|durham|northumberland|cumbria|greater london|greater manchester|west midlands|merseyside)$/i;
export function splitAddress(raw){
  const text=compact(raw),parts=raw.split(/[,\n]+/).map(compact).filter(Boolean);
  if(parts.length<2)return {};
  let code;
  for(const part of parts){const found=countryCode(part);if(found)code=found;}
  const patterns={GB:/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i,LV:/\bLV[- ]?\d{4}\b/i,MT:/\b[A-Z]{3}\s*\d{4}\b/i};
  const postcode=code&&patterns[code]?text.match(patterns[code])?.[0]:undefined;
  const addressParts=parts.filter(part=>!countryCode(part)&&(!postcode||compact(part).toUpperCase()!==compact(postcode).toUpperCase()));
  // The first component is usable only when a terminal country/postcode makes
  // the structure clear. Ambiguous free-form addresses are kept as full text.
  if(!code||!postcode||addressParts.length<2||!['GB','LV','MT'].includes(code))return {};
  let region;
  if(code==='GB'&&addressParts.length>2&&counties.test(addressParts.at(-1)))region=addressParts.pop();
  const city=addressParts.pop(),line1=addressParts.shift(),line2=addressParts.join(', ');
  return {line1,line2,city,postcode,country:countryName(code),region};
}
export function addressFacts(fullKey,raw){
  const prefix=fullKey==='operating_address'?'operating':fullKey==='contact_residential_address'?'contact':'registered',parts=splitAddress(raw),result=[];
  const keys=prefix==='registered'?{line1:'registered_address_line1',line2:'registered_address_line2',city:'city',postcode:'postal_code',country:'registered_country',region:'registered_region'}:{line1:`${prefix}_address_line1`,line2:`${prefix}_address_line2`,city:`${prefix}_city`,postcode:`${prefix}_postal_code`,country:`${prefix}_country`,region:`${prefix}_region`};
  for(const [component,value] of Object.entries(parts))if(value)result.push({key:keys[component],value,note:'Адрес разделён по строкам, индексу и стране. Проверьте компоненты в итоговой карточке; юридический адрес не означает адрес деятельности.'});
  return result;
}
