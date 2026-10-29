import {nonTargetMarketEvidence} from './market-scope.js';
import {pureCryptoWallet} from './crypto-scope.js';
import {assessDiscovery} from './discovery.js';
import {assessBanking,validateCriteria} from './qualification.js';
import {licenceLead,regulatoryKind} from './licences.js';
import {createHash} from 'node:crypto';
// Cache only deterministic text screening, never decisions about manual
// exclusions, selected sources, schedules or model eligibility.
const textScreens=new Map(),maxCachedScreens=10000;
export function screenCandidate(entry){
 const docs=entry.documents?.length?entry.documents:entry.sourceDocuments?.length?entry.sourceDocuments:[{title:entry.title,text:entry.screeningText??entry.snippet??'',url:entry.url}];
 const key=createHash('sha256').update(JSON.stringify([entry.marketScope,entry.blockedJurisdictions,entry.title,entry.url,entry.appId,entry.developerWebsite,entry.developerCountry,entry.developerAddress,entry.snippet,entry.screeningText,docs.map(d=>[d.url,d.kind,d.title,d.text])])).digest('hex');
 const old=textScreens.get(key);if(old){textScreens.delete(key);textScreens.set(key,old);return{...old};}
 const result=screenText(entry,docs);textScreens.set(key,Object.freeze({...result}));if(textScreens.size>maxCachedScreens)textScreens.delete(textScreens.keys().next().value);return result;
}
function screenText(entry,docs){
 const market=nonTargetMarketEvidence({...entry,documents:docs},entry);if(market)return{eligible:false,kind:market.code==='excludedJurisdiction'?'blocked_jurisdiction':'outside_target_market',reason:market.reason,marketEvidence:market};
 if(pureCryptoWallet({...entry,documents:docs}))return{eligible:false,kind:'crypto_wallet',reason:'Чистый криптокошелёк без предложения собственного фиатного бизнес-счёта / IBAN.'};
 const title=entry.title??'',text=title+'. '+docs.map(d=>d.text).join(' ');
 const app=Boolean(entry.appId)||docs.some(d=>/https:\/\/(?:play\.google\.com|apps\.apple\.com)\//.test(d.url??''));
 const primary=docs.filter(d=>d.kind==='listing'&&/play\.google\.com|apps\.apple\.com/.test(d.url??''));
 const firstText=primary.length?primary[0].text:docs.find(d=>d.url===entry.url)?.text??docs[0]?.text??'';
 const product=title+' '+firstText;
 const game=/\b(?:tycoon|simulation game|manager game|strategy game|game where|game allows|play and enjoy)\b/iu.test(product)||/\b(?:card game|business game|company manager)\b/iu.test(title)&&/\b(?:game|players|play|tycoon)\b/iu.test(firstText);
 const vault=/(?:private|encrypted|on.device).{0,35}vault|(?:card|IBAN).{0,80}(?:stored|stay).{0,60}(?:your (?:own )?device|locally)|(?:store|save|organize|copy).{0,40}(?:card and IBAN|IBAN (?:details|information))/iu.test(product)&&!/\b(?:we (?:open|provide|offer)|open (?:a|your))\b.{0,55}(?:business account|corporate account)/iu.test(firstText);
 const tax=/BZSt|Federal Central Tax Office|Bundeszentralamt|налогов/iu.test(product)&&/transmi|submit|передач|notification|Meldung/iu.test(product);
 if(game||vault||tax)return{eligible:false,kind:game?'game':tax?'tax_tool':'details_vault',reason:game?'Игра / симулятор, а не финансовый провайдер.':tax?'Передача реквизитов налоговому органу, а не открытие счёта.':'Хранилище реквизитов на устройстве, а не поставщик счёта.'};
 const primaryProduct=title+' '+firstText;
 const directProvision=/\b(?:open|offer|provide|issue|get|receive|opening|offering|providing|issuing|receiving)(?:s|d|ed)?\b.{0,70}(?:(?:business|corporate|bank|fiat|EUR|euro|multi.currency|payment)\s+){1,3}(?:accounts?|IBANs?)\b/iu.test(firstText);
 const strongAccount=directProvision||/\b(?:your|our|named|dedicated)\s+(?:business |EUR |euro )?IBANs?\b/iu.test(firstText);
 if(!directProvision&&/budgeting|budget planner|expense track(?:er|ing)|expense reports?|personal budget|personal finance app/iu.test(primaryProduct))return{eligible:false,kind:'accounting_tool',reason:'Приложение учёта / бюджета без предложения собственного финансового счёта.'};
 if(!directProvision&&/\b(?:IBAN|SEPA|EPC)\s+(?:to\s+)?QR\b|\bQR\b.{0,25}generat\w*/iu.test(title))return{eligible:false,kind:'iban_utility',reason:'Генератор QR-реквизитов для существующего IBAN, а не поставщик счёта.'};
 if(!directProvision&&/\b(?:pay for parking|parking tickets?|parking payments?)\b/iu.test(firstText.slice(0,500)))return{eligible:false,kind:'unrelated_product',reason:'Сервис оплаты парковки, а не поставщик финансового счёта.'};
 if(!directProvision&&/\b(?:cash pickup|emigrant communities)\b/iu.test(firstText)&&!/\b(?:business|corporate)\s+(?:accounts?|IBANs?|payments?)\b/iu.test(primaryProduct))return{eligible:false,kind:'retail_remittance',reason:'Частные переводы с выдачей наличных без предложения бизнес-счёта / IBAN.'};
 const regulatory=regulatoryKind({...entry,documents:docs});
 if(regulatory==='reference')return{eligible:false,kind:'regulatory_reference',reason:'Справочный материал регулятора: нет конкретного события разрешения для названной компании.'};
 const editorial=/^(?:the future of|how\b|why\b|what\b|best\b|top\b|(?:the\s+)?\d+\s+best|compare\b|comparison\b|guide\b|a guide\b|opinion\b|analysis\b|как\b|почему\b|обзор\b|рейтинг\b|лучшие\b)/iu.test(title)||/\/(?:top-|best-|guide-|how-to-|comparison|compare-)/i.test(String(entry.url));
 if(!app&&editorial&&!/\b(?:we|our)\b.{0,80}\b(?:offer|provide|open|business accounts?)\b/iu.test(docs.map(d=>d.text).join(' ')))return{eligible:false,kind:'editorial',reason:'Обзор, сравнение или рассуждения без конкретного предложения собственного бизнес-счёта.'};
 if(licenceLead({...entry,documents:docs}))return{eligible:true,kind:'licence',reason:'Материал официального регулятора об EMI / MiCA.'};
 const tool=/password|social media|credentials|digital identity|EUDI|identity wallet|task (?:manager|planner)|project management|invoice generator|менеджер парол|уч[её]тн\w* запис|цифров\w* удостовер/iu.test(text)&&!/\b(?:IBAN|SEPA|EUR|euro|banking|financial|fiat|payouts|transfers)\b/iu.test(docs.map(d=>d.text).join(' '));
 if(tool)return{eligible:false,kind:'non_financial_tool',reason:'Управление паролями, задачами или цифровыми документами, а не финансовый счёт.'};
 const config=validateCriteria({profile:'business',strictBanking:false}),d=assessDiscovery(docs.map(x=>({...x,title:x.title??title})),{...config,hideEstablished:false,euIbanMode:'prefer'},assessBanking(docs,config),entry.appId);
 const body=docs.map(d=>d.text).join(' '),fiatAccount=/\b(?:USD|GBP|EUR|euro|fiat|global|multi.?currency)\b/iu.test(body)&&/\b(?:open|create|offer|provide|hold|receive)\b.{0,100}\baccounts?\b/iu.test(body),businessProfile=/business accounts?|\bKYB\b/iu.test(body)&&/currencies|currency exchange|EUR|fiat/iu.test(body);
 const detailsOnly=/keep (?:your )?(?:bank )?account information organized|store (?:your )?(?:bank )?account details|organize.{0,50}(?:bank account information|credit and debit card information)/iu.test(body);
 const noAccounts=/\b(?:has no accounts|no accounts and no backend|never holds or moves money|never hold or move money)\b/iu.test(body);
 if(detailsOnly||noAccounts)return{eligible:false,kind:'non_account_tool',reason:'Хранение реквизитов / платёжные QR-коды без открытия и обслуживания счёта.'};
 const informationOnly=!strongAccount&&/account information services/iu.test(body)&&/link.{0,35}(?:financial|existing|bank) accounts|import transactions/iu.test(body);
 if(informationOnly)return{eligible:false,kind:'linked_accounts',reason:'Агент сервиса информации по уже открытым счетам, а не поставщик нового счёта.'};
 const regulatedFiat=/electronic.money institution|e.money institution|payment institution/iu.test(body)&&/authori[sz]ed|licensed|regulated|issuing|money transmission/iu.test(body)&&/business|companies|corporate|payment services|money transmission/iu.test(title+' '+body)&&!/save in Bitcoin|invest in Bitcoin|rounding up/iu.test(body);
 if(regulatedFiat)return{eligible:true,kind:'regulated_payment_lead',reason:'Есть заявление о регулируемых платёжных услугах; бизнес-счёт и EU IBAN пока не подтверждены.'};
 const pureCrypto=/self.custody|non.custodial|self.custodial|\b(?:USDC|USDT|Solana|blockchain|DEX)\b/iu.test(body)&&!/\b(?:IBAN|SEPA|SWIFT|fiat)\b/iu.test(body)&&!fiatAccount&&!businessProfile;
 if(pureCrypto)return{eligible:false,kind:'crypto_only',reason:'Криптокошелёк / стейблкоины без признаков фиатного счёта или IBAN.'};
 const rejected={iban_utility:'Проверка / генерация IBAN, а не открытие счёта.',accounting_tool:'Учёт, бюджет или расходы без предложения собственного счёта.',unrelated_product:'Неподходящий финансовый инструмент.',local_payments:'Локальные платежи без признаков IBAN / SEPA.',crypto_only:'Криптокошелёк без признаков фиатного счёта / IBAN.',linked_accounts:'Агрегатор уже открытых счетов.'};
 if(d.rejection&&rejected[d.rejection]&&!(d.rejection==='crypto_only'&&(fiatAccount||businessProfile)))return{eligible:false,kind:d.rejection,reason:rejected[d.rejection]};
 if(fiatAccount||businessProfile)return{eligible:true,kind:'account_lead',reason:'Есть предложение фиатного / бизнес-счёта; EUR, EU IBAN и условия ещё нужно проверить.'};
 if(d.status==='service_match'||d.status==='needs_review')return{eligible:true,kind:d.status,reason:d.reason};
 const account=/\b(?:IBAN|SEPA|bank(?:ing)?|neobank|multi.?currency accounts?|business accounts?|corporate accounts?)\b|бизнес.?сч[её]т|необанк|банкинг/iu;
 const finance=/\b(?:payments?|wallet|fiat|EUR|euro|bank(?:ing)?|accounts?|IBAN|SEPA|stablecoin)\b|сч[её]т|плат[её]ж/iu;
 const business=/\b(?:business|corporate|companies|SME|KYB|neobank)\b|бизнес|компани|предприним/iu;
 const planned=/waitlist|coming soon|early access|will launch|launches|introduces|запуск|ожидани/iu;
 if(finance.test(text)&&account.test(text)&&(business.test(text)||planned.test(text)))return{eligible:true,kind:'early',reason:'Есть признаки бизнес-сервиса / раннего запуска; условия не подтверждены.'};
 if(/\b(?:IBAN|SEPA|EUR account|euro account|banking)\b/iu.test(text))return{eligible:true,kind:'account_lead',reason:'Счёт / IBAN упомянуты; обслуживание бизнеса требует проверки.'};
 return{eligible:false,kind:'off_topic',reason:'Нет признаков предложения счёта, IBAN / SEPA, бизнес-банкинга или EMI / MiCA.'};
}
