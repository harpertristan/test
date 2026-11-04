import {countryCode} from './normalization.js';
import {helpFor} from './field-help.js';
export const FIELDS = {
  company_name: 'Юридическое название компании', company_number: 'Регистрационный номер компании',
  tax_number: 'Налоговый номер компании', vat_number: 'VAT-номер',
  incorporated_on: 'Дата регистрации (YYYY-MM-DD)', country: 'Страна регистрации',
  registered_address: 'Полный юридический адрес', city: 'Город юридического адреса',
  postal_code: 'Почтовый индекс юридического адреса', website: 'Сайт компании',
  business_description: 'Описание деятельности', company_email: 'Email компании', company_phone: 'Телефон компании',
  director_name: 'Полное имя директора', beneficiary_name: 'Полное имя бенефициара',
  funds_source: 'Источник средств', expected_turnover: 'Ожидаемый оборот с валютой и периодом',
  director_first_name:'Имя директора',director_last_name:'Фамилия директора',
  beneficiary_first_name:'Имя бенефициара',beneficiary_last_name:'Фамилия бенефициара',
  contact_name:'Полное имя контактного лица',contact_first_name:'Имя контактного лица',contact_last_name:'Фамилия контактного лица',
  contact_birth_date:'Дата рождения контактного лица',contact_passport_number:'Номер паспорта контактного лица',
  contact_passport_expiry:'Срок действия паспорта',contact_personal_id:'Личный идентификационный номер',contact_residential_address:'Адрес проживания контактного лица',
  business_description_short:'Краткое описание бизнеса',account_purpose:'Назначение счёта',industry:'Отрасль',
  annual_transaction_volume:'Годовой объём операций (с валютой)',product_interest:'Интересующий продукт',
  phone_dial_code:'Телефонный код страны',phone_national:'Телефон без международного кода',phone_country:'Страна телефонного номера'
};
Object.assign(FIELDS,{
  trading_name:'Торговое название компании',legal_form:'Правовая форма компании',lei_code:'Код LEI',tax_residence_country:'Страна налогового резидентства',
  registered_address_line1:'Юридический адрес — строка 1',registered_address_line2:'Юридический адрес — строка 2',registered_country:'Страна юридического адреса',registered_region:'Регион юридического адреса',
  operating_address:'Полный адрес деятельности',operating_address_line1:'Адрес деятельности — строка 1',operating_address_line2:'Адрес деятельности — строка 2',operating_city:'Город адреса деятельности',operating_postal_code:'Индекс адреса деятельности',operating_country:'Страна адреса деятельности',operating_region:'Регион адреса деятельности',
  contact_address_line1:'Адрес контактного лица — строка 1',contact_address_line2:'Адрес контактного лица — строка 2',contact_city:'Город контактного лица',contact_postal_code:'Индекс контактного лица',contact_country:'Страна адреса контактного лица',contact_region:'Регион адреса контактного лица',vat_status:'Статус регистрации по VAT'
});

const aliases = {
  company_name: ['company name','company or trading name','company trading name','company name or trading name','company or business name','company legal name','legal entity name','entity name','legal company name','registered company name','business legal name','legal business name','юридическое название','название компании'],
  company_number: ['company registration number','company number','registration number','business registration number','registration no','company registration no','company reg no','crn','регистрационный номер компании'],
  tax_number: ['company tax identification number','company tax number','business tax id','tax identification number','tax id','tin','utr','tax number'],
  vat_number: ['vat number','vat registration number','vat id'],
  incorporated_on: ['date of incorporation','date of registration','registration date','incorporation date','company registration date'],
  country: ['country of incorporation','country of registration','incorporation country','registration country','jurisdiction of incorporation'],
  registered_address: ['registered office address','registered company address','registered business address','company registered address','registered address'],
  city: ['registered office city','registered address city','town city','town or city','city town','city','town','postal town'],
  postal_code: ['registered office postal code','registered address postal code','postcode','post code','postal code','zip','zip code','zip postal code','postal zip code'],
  website: ['company website','business website','company website url','website','web site','website url','web site url','website address','web address','business website address','url','site','company url','business url','веб сайт','сайт'],
  company_email: ['company email','business email','company email address','work email','work email address','business e mail','email','e mail'],
  company_phone: ['company phone','business phone number','company phone number','phone','phone number','telephone','telephone number','mobile number'],
  business_description: ['business description','description of business activities','company business activities','business model','describe your business'],
  business_description_short:['message','message anything else we should know','anything else we should know','short business description'],
  account_purpose:['account purpose','purpose of account','purpose of the account','purpose of opening account'],
  industry:['industry','sector','business sector'],annual_transaction_volume:['annualized transaction volume eur','annualised transaction volume eur','annual transaction volume eur','annual transaction volume'],
  product_interest:['product interest','product','interested product'],
  contact_first_name:['first name','firstname','given name','given names','forename','contact first name'],contact_last_name:['last name','lastname','surname','family name','contact last name'],
  contact_name:['full name','contact name','contact full name'],
  director_first_name:['director first name','director given name'],director_last_name:['director last name','director surname'],
  director_name:['director name','director full name'],beneficiary_name:['beneficiary name','beneficial owner name','ubo name'],
  beneficiary_first_name:['beneficiary first name','beneficial owner first name','ubo first name'],beneficiary_last_name:['beneficiary last name','beneficial owner surname','ubo last name'],
  contact_birth_date:['date of birth','birth date','dob'],contact_passport_number:['passport number','passport no'],contact_passport_expiry:['passport expiry date','passport expiration date','date of expiry'],
  contact_personal_id:['personal identification number','personal identity number','personal id'],contact_residential_address:['residential address','home address'],
  phone_dial_code:['dial code','dialing code','dialling code','calling code','country calling code','phone country code']
  ,phone_national:['national phone number','phone national number','phone without country code'],phone_country:['phone country','telephone country'],
  funds_source:['source of funds','source of company funds','funding source'],expected_turnover:['expected turnover','annual turnover','expected annual turnover','annual revenue']
};
Object.assign(aliases,{
  trading_name:['trading name','trade name','doing business as','dba','business trading name'],legal_form:['company legal form','legal form','company type','entity type','type of company','legal entity type'],lei_code:['lei','lei code','legal entity identifier'],tax_residence_country:['country of tax residence','country of tax residency','tax residence country','tax residency','tax jurisdiction'],
  registered_address_line1:['registered address line 1','registered office address line 1','address line 1','address line1','address 1','street address','street and number'],registered_address_line2:['registered address line 2','registered office address line 2','address line 2','address line2','address 2','additional address'],registered_country:['registered address country','registered office country'],
  operating_address:['operating address','business operating address','principal place of business','physical business address'],operating_address_line1:['operating address line 1','business address line 1'],operating_address_line2:['operating address line 2','business address line 2'],operating_city:['operating address city','operating city'],operating_postal_code:['operating postcode','operating postal code'],operating_country:['operating country','operating address country']
});

export const normalize = s => String(s).normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').toLowerCase().replace(/['’]s\b/g,'').replace(/\((?:optional|required|обязательно|необязательно)\)/g,'').replace(/[_\-]+/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const stripQuestion = value => normalize(value).replace(/^(?:what is |what s |please (?:enter|provide|specify) |enter |provide )/,'').replace(/^(?:the |your )/,'').replace(/ (?:required|optional)$/,'');
export function resolveFieldKey(field){
  if(/^(?:country of tax residence|country of tax residency|tax residence country|tax residency)$/.test(stripQuestion(field.label)))return 'tax_residence_country';
  const text=stripQuestion(field.caption||field.label||''),addressKind=field.addressKind;
  const component=/^(?:address )?(?:line ?1|address ?1|street address|street and number)$/.test(text)?'line1':/^(?:address )?(?:line ?2|address ?2|additional address)$/.test(text)?'line2':/^(?:town city|town or city|city town|city|town|postal town)$/.test(text)?'city':/^(?:post ?code|postal code|zip(?: code)?|zip postal code|postal zip code)$/.test(text)?'postcode':/^(?:country|address country)$/.test(text)?'country':undefined;
  if(component&&field.ambiguousAddress&&!addressKind)return;
  if(component&&['registered','operating','contact'].includes(addressKind)){
    if(addressKind==='registered')return {line1:'registered_address_line1',line2:'registered_address_line2',city:'city',postcode:'postal_code',country:'registered_country'}[component];
    return `${addressKind}_${component==='postcode'?'postal_code':component==='line1'||component==='line2'?'address_'+component:component}`;
  }
  if(field.phonePart==='dial')return 'phone_dial_code';
  if(field.phonePart==='national')return 'phone_national';
  const resolve=text=>Object.keys(FIELDS).filter(key=>[...(aliases[key]||[]),FIELDS[key],...(['country','city'].includes(key)?[]:[key])].some(alias=>stripQuestion(alias)===stripQuestion(text)));
  let keys=resolve(field.label||'');
  if(!keys.length&&field.caption)keys=resolve(field.caption);
  if(!keys.length){
    // Accept a recognised label followed by explanatory help, never arbitrary fuzzy substrings.
    const text=stripQuestion(field.label||'');
    const candidates=Object.keys(aliases).filter(key=>aliases[key].some(alias=>{
      const prefix=stripQuestion(alias);if(!text.startsWith(prefix+' '))return false;
      return /^(?:this (?:is|field|code|number)|used (?:to|for)|required (?:to|for|if)|only (?:if|for)|if |for investment|e g )/.test(text.slice(prefix.length+1));
    }));if(candidates.length===1)keys=candidates;
  }

  if(!keys.length){
    // HTML metadata may supplement missing/generic labels; it must not override
    // a question explicitly about another legal meaning or another person.
    const label=normalize(field.label||'');
    if(!/residen|citizen|nationality|beneficiary|beneficial|director|shareholder|source of funds|turnover|revenue|personal|private|home|passport|birth|identity|vat|налог|ндс|оборо|резидент/i.test(label))keys=resolve(field.name||'');
  }
  if(!keys.length&&field.autocomplete==='given-name')keys=['contact_first_name'];
  if(!keys.length&&field.autocomplete==='family-name')keys=['contact_last_name'];
  return keys.length===1?keys[0]:undefined;
}
export function sensitive(label) {
  return /password|passcode|one[ -]?time|verification code|security code|cvv|cvc|\bpin\b|\botp\b|card number|парол|код подтверждения/i.test(label);
}

export function suggest(field, facts, context={}) {
  const label = String(field.label || '').slice(0,300);
  if(field.type==='file')return {status:'manual',reason:'Документ загружает оператор. Помощник объясняет требования к файлу и не выбирает файлы на компьютере.'};
  if(field.disabled||field.readOnly)return {status:'manual',reason:'Поле сейчас недоступно для редактирования. Подсказка объясняет его назначение; вставка отключена.'};
  if (sensitive(`${label} ${field.name || ''}`) || ['password','hidden','file'].includes(field.type)) {
    return {status:'blocked',reason:'Секретные коды и пароли помощник не читает и не заполняет.'};
  }
  if (['choice-group','custom-select'].includes(field.type)) return {status:'manual',reason:'Варианты этой группы помощник объясняет. Выбор ответа остаётся оператору; текущая отметка на сайте не подтверждает сведения компании.'};
  if (['checkbox','radio'].includes(field.type)) return {status:'manual',guidance:field.consent?'Это отдельное согласие оператора. Прочитайте связанные условия перед подтверждением; помощник не отмечает галочку.':undefined,reason:'Юридическое подтверждение или выбор условий требует решения пользователя.'};
  if (field.type === 'select-multiple') return {status:'manual',reason:'Несколько вариантов списка выбираются пользователем вручную.'};
  const resolved=context.mappedKey||resolveFieldKey(field),keys=resolved?[resolved]:[];
  if (keys.length !== 1) return {status:'manual',reason:'Назначение поля неоднозначно. Уточните вопрос и выберите сведения вручную; значение не угадано.'};
  let key=keys[0];
  if(key.startsWith('contact_')&&!['name','first_name','last_name'].includes(key.slice(8))&&['director','beneficiary'].includes(context.personRole))return {status:'manual',reason:'Личные сведения контактного лица нельзя автоматически считать сведениями выбранного директора или бенефициара. Уточните роль в источнике.'};
  if(key.startsWith('contact_')&&['name','first_name','last_name'].includes(key.slice(8))){
    const suffix=key.slice(8),role=/beneficiar|beneficial owner|\bubo\b/i.test(field.group||'')?'beneficiary':/director/i.test(field.group||'')?'director':context.personRole||'contact';
    if(role==='director'||role==='beneficiary')key=role+'_'+suffix;
    else if(!facts.some(f=>f.key.startsWith('contact_')&&['contact_name','contact_first_name','contact_last_name'].includes(f.key))&&facts.some(f=>f.key==='director_'+suffix)&&!facts.some(f=>['beneficiary_name','beneficiary_first_name','beneficiary_last_name'].includes(f.key)))key='director_'+suffix;
  }
  if(key==='company_phone'&&field.splitPhone)key='phone_national';
  if(key==='business_description_short'&&!facts.some(f=>f.key===key))key='business_description';
  const matches = facts.filter(f => f.key === key && [1,2].includes(f.confirmed));
  if(matches.length !== 1) return {status:'manual',reason:matches.length ? 'В карточке несколько значений. Сначала устраните противоречие.' : `Нет подтверждённого значения: ${FIELDS[keys[0]]}.`};
  const fact = matches[0];
  if(fact.conflicted)return {status:'manual',reason:'В документах найдены разные значения. Выберите верное в карточке компании.'};
  let value = fact.value;
  if(key==='vat_number'&&/\butr\b|\btin\b|tax identification/i.test(fact.quote||'')&&!/\bvat\b|value added tax|ндс/i.test(fact.quote||''))return {status:'manual',key,reason:'Источник подтверждает UTR / TIN, но не VAT. Нужен документ о регистрации по НДС.',guidance:helpFor(key)};
  if(key==='tax_number'&&/\bvat\b|value added tax|ндс/i.test(fact.quote||'')&&!/\butr\b|\btin\b|tax identification|налогов/i.test(fact.quote||''))return {status:'manual',key,reason:'VAT-номер не подменяет налоговый идентификатор TIN / UTR.',guidance:helpFor(key)};
  if(key==='tax_number'&&field.taxCountry){const residence=facts.find(f=>f.key==='tax_residence_country'&&!f.conflicted);if(!residence||!countryCode(residence.value)||countryCode(residence.value)!==countryCode(field.taxCountry))return {status:'manual',key,reason:'Выбранная в форме налоговая страна не подтверждена итоговой карточкой или отличается от неё. Сначала проверьте Country of tax residence.',guidance:helpFor(key)};}
  if(['tax_number','vat_number','company_number','lei_code'].includes(key))value=value.replace(/\s+/g,'');
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return {status:'manual',reason:'Формат даты в документе требует ручной проверки.'};
  if(field.type!=='date'&&/^(\d{4})-(\d{2})-(\d{2})$/.test(value)&&/(?:_on|_birth_date|_expiry)$/.test(key)){
    const [year,month,day]=value.split('-'),format=String(field.placeholder||'').toUpperCase();
    if(format==='DD/MM/YYYY')value=[day,month,year].join('/');
    if(format==='MM/DD/YYYY')value=[month,day,year].join('/');
    if(format==='DD.MM.YYYY')value=[day,month,year].join('.');
    if(format==='MM-DD-YYYY')value=[month,day,year].join('-');
    if(format==='DD-MM-YYYY')value=[day,month,year].join('-');
  }
  let optionValue;
  if(field.type === 'select-one') {
    const options = (field.options || []).filter(o => !o.disabled && (normalize(o.text) === normalize(value)
      || ((key==='country'||key.endsWith('_country'))&&countryCode(value)&&[o.text,o.value].some(v=>countryCode(v)===countryCode(value)))
      || (key==='legal_form'&&legalFormGroup(value)&&legalFormGroup(o.text)===legalFormGroup(value))
      || (key==='phone_dial_code'&&(o.text.match(/\+\d{1,3}\b/)?.[0]===value||o.value===value))));
    if(options.length !== 1) return {status:'manual',reason:'В списке нет единственного точного соответствия. Выберите вариант самостоятельно.'};
    optionValue = options[0].value;
  }
  return {status:'suggested',factId:fact.id,key:fact.key,value,optionValue,source:fact.filename,page:fact.page,quote:fact.quote,guidance:helpFor(key),
    automatic:fact.confirmed===2,
    reason:`Поле соответствует «${FIELDS[fact.key]}». ${fact.confirmed===2?'Значение автоматически найдено в источнике.':'Использовано подтверждённое вами значение.'} ${fact.note||'Проверьте контекст перед отправкой анкеты.'}`};
}
function legalFormGroup(value){const text=normalize(value);if(/public limited|\bplc\b/.test(text))return 'public_limited';if(/limited by guarantee/.test(text))return 'guarantee';if(/limited liability partnership|\bllp\b/.test(text))return 'llp';if(/private (?:company )?limited(?: company)?(?: by shares)?|^ltd$|^limited company$/.test(text))return 'private_limited';}
