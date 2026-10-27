// Compare project names, not arbitrary mentions in descriptions or partner lists.
const generic=new Set('provider providers platform solutions solution fintech businessaccount businessaccounts businessbank businessbanking businessapp get open free new virtual global international multicurrency multi currency neobank pay business bank banking account accounts corporate mobile app application online digital official europe european eu eur iban sepa swift wallet payments payment financial finance services service limited ltd llc inc plc uab gmbh sas sa srl ou oü bv ag treasury банк банка банкинг бизнес счет счета счёт счета приложение официальный европейский для for and the'.split(' '));
export function canonicalName(value){
 let text=String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ё/g,'е').replace(/https?:\/\/\S+/g,' ');
 text=text.replace(/\b([a-z0-9-]+)\.(?:com|net|org|co|eu|io|app|money|finance|bank|fi|lt|de|fr|es|it|uk)\b/gi,'$1');
 text=text.replace(/^\s*(?:new|introducing|meet|новый|новое)\s*[:–—-]?\s*/i,'');
 text=text.split(/\s+(?:launches|launched|has launched|introduces|announces|unveils|receives|received|obtains|obtained|secures|secured|offers|provides|partners with|получил|получила|запускает|объявляет)\b/iu)[0];
 const words=text.match(/[\p{L}\p{N}]+/gu)??[];
 let name=words.filter(w=>!generic.has(w)).join('');name=name.replace(/(?:businessbanking|businessaccounts?|bankingapp|businessapp|business|banking|solutions)$/,'');
 return name.length>=3&&name.length<=90&&!/^\d+$/.test(name)?name:null;
}
export function projectNames(entry){
 return [...new Set([entry.serviceName,entry.providerName,entry.title,...entry.names??[]].filter(v=>typeof v==='string'&&v.trim()))];
}
export const EXCLUSION_REASONS={worked:'Уже в работе / был в работе',not_provider:'Не банк и не провайдер',location:'Не подходит локация',other:'Без причины / прежние исключения'};
