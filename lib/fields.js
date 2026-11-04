export const FIELDS = {
  company_name: 'Юридическое название компании', company_number: 'Регистрационный номер компании',
  tax_number: 'Налоговый номер компании', vat_number: 'VAT-номер',
  incorporated_on: 'Дата регистрации (YYYY-MM-DD)', country: 'Страна регистрации',
  registered_address: 'Полный юридический адрес', city: 'Город юридического адреса',
  postal_code: 'Почтовый индекс юридического адреса', website: 'Сайт компании',
  business_description: 'Описание деятельности', company_email: 'Email компании', company_phone: 'Телефон компании',
  director_name: 'Полное имя директора', beneficiary_name: 'Полное имя бенефициара',
  funds_source: 'Источник средств', expected_turnover: 'Ожидаемый оборот с валютой и периодом'
};

const aliases = {
  company_name: ['company name','legal company name','registered company name','business legal name','legal business name','юридическое название','название компании'],
  company_number: ['company registration number','company number','registration number','business registration number','регистрационный номер компании'],
  tax_number: ['company tax identification number','company tax number','business tax id'],
  vat_number: ['vat number','vat registration number','vat id'],
  incorporated_on: ['date of incorporation','incorporation date','company registration date'],
  country: ['country of incorporation','country of registration'],
  registered_address: ['registered office address','registered company address','registered business address','company registered address','registered address'],
  city: ['registered office city','registered address city'],
  postal_code: ['registered office postal code','registered address postal code'],
  website: ['company website','business website','company website url'],
  company_email: ['company email','business email','company email address'],
  company_phone: ['company phone','business phone number','company phone number'],
  business_description: ['business description','description of business activities','company business activities']
};

export const normalize = s => String(s).normalize('NFKC').toLowerCase().replace(/[_\-]+/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function sensitive(label) {
  return /password|passcode|one[ -]?time|verification code|security code|cvv|cvc|\bpin\b|\botp\b|card number|парол|код подтверждения/i.test(label);
}

export function suggest(field, facts) {
  const label = String(field.label || '').slice(0,300);
  if (sensitive(`${label} ${field.name || ''}`) || ['password','hidden','file'].includes(field.type)) {
    return {status:'blocked',reason:'Секретные коды и пароли помощник не читает и не заполняет.'};
  }
  if (['checkbox','radio'].includes(field.type)) return {status:'manual',reason:'Юридическое подтверждение или выбор условий требует решения пользователя.'};
  if (field.type === 'select-multiple') return {status:'manual',reason:'Несколько вариантов списка выбираются пользователем вручную.'};
  const keys = Object.keys(aliases).filter(key => aliases[key].includes(normalize(label)));
  if (keys.length !== 1) return {status:'manual',reason:'Назначение поля неоднозначно. Уточните вопрос и выберите сведения вручную; значение не угадано.'};
  const matches = facts.filter(f => f.key === keys[0] && f.confirmed === 1);
  if(matches.length !== 1) return {status:'manual',reason:matches.length ? 'В карточке несколько значений. Сначала устраните противоречие.' : `Нет подтверждённого значения: ${FIELDS[keys[0]]}.`};
  const fact = matches[0];
  let value = fact.value;
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return {status:'manual',reason:'Формат даты в документе требует ручной проверки.'};
  let optionValue;
  if(field.type === 'select-one') {
    const options = (field.options || []).filter(o => !o.disabled && normalize(o.text) === normalize(value));
    if(options.length !== 1) return {status:'manual',reason:'В списке нет единственного точного соответствия. Выберите вариант самостоятельно.'};
    optionValue = options[0].value;
  }
  return {status:'suggested',factId:fact.id,key:fact.key,value,optionValue,source:fact.filename,page:fact.page,quote:fact.quote,
    reason:`Поле соответствует «${FIELDS[fact.key]}». Использовано подтверждённое вами значение из источника; перед вставкой проверьте контекст.`};
}
