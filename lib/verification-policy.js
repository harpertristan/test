import {officialRegulator} from './licences.js';
// A publication or a licence is a lead, not proof that this provider issues
// business IBANs. A non-bank using a partner can qualify on the same evidence.
const direct=e=>e.kind==='official_page'&&!officialRegulator(e.url)||e.kind==='listing'&&/^https:\/\/(?:play\.google\.com|apps\.apple\.com)\//.test(e.url??'');
export function verifiedDecision(result){
 const f=result?.facts??{};
 if(f.utility?.status==='yes'&&f.utility.evidence?.some(direct))return'irrelevant';
 if(['waitlist','planned'].includes(result?.availability?.status))return'review';
 if(!['business','account','euIban'].every(k=>f[k]?.status==='yes'&&f[k].evidence?.some(direct)))return'review';
 const quotes=f.euIban.evidence.filter(direct).map(e=>e.quote).join(' ');
 if(/pooled|shared (?:IBAN|account)|deposit.only|top.up only|общ(?:ий|ие) (?:IBAN|реквизит)/iu.test(quotes))return'review';
 return f.utility?.status==='yes'?'review':'match';
}
export function deliveryEvidence(documents){
 const evidence=[];let kind='unknown',partnerName=null;
 for(const doc of documents){
  for(const quote of String(doc.text??'').split(/\n+|(?<=[.!?])\s+/u)){
   if(quote.length>1400)continue;
   if(/electronic money institution|e-money institution|\bEMI\b/i.test(quote)){if(kind==='unknown')kind='emi';evidence.push({quote,url:doc.url});}
   if(/IBAN (?:provider|as a service)|banking.as.a.service|white.label|embedded (?:finance|banking)|payment (?:accounts?|services?) (?:are )?provided by|accounts? (?:are )?(?:provided|issued|held) (?:by|through)|agent of|партн[её]р/iu.test(quote)){
    kind='partner_provider';evidence.push({quote,url:doc.url});
    const name=quote.match(/(?:accounts?\s+(?:are\s+)?(?:provided|issued|held)\s+(?:by|through)|partner(?:ed)? with|agent of)\s+([^,.;\n]{3,100})/i)?.[1];if(name)partnerName=name.trim();
   }
   if(/crypto|stablecoin|\bUSDC\b|\bUSDT\b/i.test(quote)&&/IBAN|SEPA|EUR|fiat|euro account/i.test(quote)){if(kind==='unknown')kind='crypto_fiat';evidence.push({quote,url:doc.url});}
  }
 }
 return {kind,partnerName,evidence:evidence.slice(0,5),notice:'Формат продукта по текстам. Собственная банковская лицензия не обязательна; действующий договор, эмитент и тип IBAN требуют проверки.'};
}
