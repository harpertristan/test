export function invoiceSource(document){
 if(!document)return false;
 return /invoice/i.test(document.filename||'')||/^\s*(?:(?:tax|vat)\s+)?invoice(?:\s*(?:no\b|number\b|#|date\b|:)|\s*$)/im.test(JSON.parse(document.pages||'[]').map(page=>page.text).join('\n'));
}
export function ownershipIssue(candidate,document){
 if(candidate.note?.startsWith('Название в документе отличается от выбранной компании.'))return 'Документ относится к другой компании.';
 if(/^(?:company_name|company_number|tax_number|vat_number|legal_form|incorporated_on)$/.test(candidate.key)&&invoiceSource(document)&&!/\b(?:customer|client|buyer|bill(?:ed)? to)\b/i.test(candidate.quote))return 'Счёт не подтверждает владельца этих реквизитов: они могут относиться к поставщику.';
}
