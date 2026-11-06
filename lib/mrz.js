import {countryName,mrzBirthDate,mrzExpiryDate} from './normalization.js';
const check=(value,digit)=>/^\d$/.test(digit)&&[...value].reduce((sum,c,i)=>sum+(c==='<'?0:/\d/.test(c)?Number(c):c.charCodeAt(0)-55)*[7,3,1][i%3],0)%10===Number(digit);
export function mrzRecords(lines){
 const output=[];
 for(let i=0;i<lines.length-1;i++){
  const first=lines[i],second=lines[i+1];if(!/^[PACI][A-Z<][A-Z<]{3}[A-Z<0-9]+$/.test(first))continue;
  const td3=first.length===44&&second.length===44&&first.startsWith('P'),td2=first.length===36&&second.length===36,td1=first.length===30&&second.length===30&&lines[i+2]?.length===30;
  if(!td3&&!td2&&!td1||!/^[A-Z0-9<]+$/.test(second))continue;
  const type=td3||first.startsWith('P')?'passport':'id',prefix='contact_'+type,quote=[first,second,...(td1?[lines[i+2]]:[])].join('\n'),values={};
  const number=(td1?first.slice(5,14):second.slice(0,9)),digit=td1?first[14]:second[9];
  if(check(number,digit)&&/[0-9]/.test(number)&&number.replace(/<+$/,'').length>=5)values[prefix+'_number']=number.replace(/<+$/,'');
  const birth=mrzBirthDate(second);if(birth)values.contact_birth_date=birth;
  const expiry=mrzExpiryDate(second);if(expiry)values[prefix+'_expiry']=expiry;
  const sex=td1?second[7]:second[20];if(['M','F','X'].includes(sex))values.contact_gender=sex;
  const nationality=countryName(td1?second.slice(15,18):second.slice(10,13)),issuer=countryName(first.slice(2,5));if(nationality)values.contact_nationality=nationality;if(issuer)values.contact_issuing_country=issuer;
  const nameLine=td1?lines[i+2]:first.slice(5),parts=nameLine.split('<<');if(parts.length>=2){const last=parts[0].replace(/</g,' ').trim(),given=parts.slice(1).join('<<').replace(/</g,' ').replace(/\s+/g,' ').trim();if(last&&given){values.contact_first_name=given;values.contact_last_name=last;}}
  output.push({values,quote,type});
 }
 return output;
}
