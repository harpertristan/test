import {countryCode} from './normalization.js';
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

const aliases = {
  company_name: ['company name','legal company name','registered company name','business legal name','legal business name','юридическое название','название компании'],
  company_number: ['company registration number','company number','registration number','business registration number','registration no','company registration no','company reg no','crn','регистрационный номер компании'],
  tax_number: ['company tax identification number','company tax number','business tax id','tax identification number','tax id','tin','utr','tax number'],
  vat_number: ['vat number','vat registration number','vat id'],
  incorporated_on: ['date of incorporation','incorporation date','company registration date'],
  country: ['country of incorporation','country of registration','incorporation country','registration country','jurisdiction of incorporation'],
  registered_address: ['registered office address','registered company address','registered business address','company registered address','registered address'],
  city: ['registered office city','registered address city'],
  postal_code: ['registered office postal code','registered address postal code'],
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

export const normalize = s => String(s).normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').toLowerCase().replace(/['’]s\b/g,'').replace(/\((?:optional|required|обязательно|необязательно)\)/g,'').replace(/[_\-]+/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const stripQuestion = value => normalize(value).replace(/^(?:what is |what s |please (?:enter|provide|specify) |enter |provide )/,'').replace(/^(?:the |your )/,'').replace(/ (?:required|optional)$/,'');
export function resolveFieldKey(field){
  const resolve=text=>Object.keys(aliases).filter(key=>[...aliases[key],FIELDS[key],...(['country','city'].includes(key)?[]:[key])].some(alias=>stripQuestion(alias)===stripQuestion(text)));
  let keys=resolve(field.label||'');
  if(!keys.length){
    // HTML metadata may supplement missing/generic labels; it must not override
    // a question explicitly about another legal meaning or another person.
    const label=normalize(field.label||'');
    if(!/residen|citizen|nationality|beneficiary|beneficial|director|shareholder|source of funds|turnover|revenue|personal|private|home|passport|birth|identity|оборо|резидент/i.test(label))keys=resolve(field.name||'');
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
  if (sensitive(`${label} ${field.name || ''}`) || ['password','hidden','file'].includes(field.type)) {
    return {status:'blocked',reason:'Секретные коды и пароли помощник не читает и не заполняет.'};
  }
  if (['checkbox','radio'].includes(field.type)) return {status:'manual',reason:'Юридическое подтверждение или выбор условий требует решения пользователя.'};
  if (field.type === 'select-multiple') return {status:'manual',reason:'Несколько вариантов списка выбираются пользователем вручную.'};
  const resolved=resolveFieldKey(field),keys=resolved?[resolved]:[];
  if (keys.length !== 1) return {status:'manual',reason:'Назначение поля неоднозначно. Уточните вопрос и выберите сведения вручную; значение не угадано.'};
  let key=keys[0];
  if(key.startsWith('contact_')&&!['name','first_name','last_name'].includes(key.slice(8))&&['director','beneficiary'].includes(context.personRole))return {status:'manual',reason:'Личные сведения контактного лица нельзя автоматически считать сведениями выбранного директора или бенефициара. Уточните роль в источнике.'};
  if(key.startsWith('contact_')&&['name','first_name','last_name'].includes(key.slice(8))){
    const suffix=key.slice(8),role=context.personRole||'contact';
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
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return {status:'manual',reason:'Формат даты в документе требует ручной проверки.'};
  if(field.type!=='date'&&/^(\d{4})-(\d{2})-(\d{2})$/.test(value)&&/(?:_on|_birth_date|_expiry)$/.test(key)){
    const [year,month,day]=value.split('-'),format=String(field.placeholder||'').toUpperCase();
    if(format==='DD/MM/YYYY')value=[day,month,year].join('/');
    if(format==='MM/DD/YYYY')value=[month,day,year].join('/');
    if(format==='DD.MM.YYYY')value=[day,month,year].join('.');
  }
  let optionValue;
  if(field.type === 'select-one') {
    const options = (field.options || []).filter(o => !o.disabled && (normalize(o.text) === normalize(value)
      || (key==='country'&&countryCode(value)&&[o.text,o.value].some(v=>countryCode(v)===countryCode(value)))
      || (key==='phone_dial_code'&&(o.text.match(/\+\d{1,3}\b/)?.[0]===value||o.value===value))));
    if(options.length !== 1) return {status:'manual',reason:'В списке нет единственного точного соответствия. Выберите вариант самостоятельно.'};
    optionValue = options[0].value;
  }
  return {status:'suggested',factId:fact.id,key:fact.key,value,optionValue,source:fact.filename,page:fact.page,quote:fact.quote,
    automatic:fact.confirmed===2,
    reason:`Поле соответствует «${FIELDS[fact.key]}». ${fact.confirmed===2?'Значение автоматически найдено в источнике.':'Использовано подтверждённое вами значение.'} ${fact.note||'Проверьте контекст перед отправкой анкеты.'}`};
}
