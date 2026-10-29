// A verbatim quote can still be irrelevant to the model's classification.
// Account balances, SEPA transfers, QR payments and multibank access are also
// ordinary bank features; they cannot alone establish that a bank is a tool.
export function utilityQuoteSupported(quote){
 const text=String(quote??'').replace(/\s+/g,' ');
 const ibanTool=/\b(?:IBAN|BIC|BIN|SWIFT)\b.{0,65}\b(?:checker|validator|validation|calculator|generator|lookup|verify|verifies|check digit)\b|\b(?:check(?:er)?|validate|verif(?:y|ies)|generat(?:e|or)|calculat(?:e|or))\b.{0,65}\b(?:IBAN|BIC|BIN)\b/iu;
 const accounting=/expense (?:tracker|reports?)|income tracker|budget(?:ing| planner)|cash\s?book|bookkeeping|finance tracker|track (?:their|your|personal|business) (?:money|expenses)|notes de frais|уч[её]т расходов|трекер расходов/iu;
 const qrTool=/\b(?:generate|generates|generator|convert|turns)\b.{0,90}\b(?:SEPA|EPC|IBAN|QR)\b.{0,90}\b(?:QR|code)|\bIBAN (?:to|into) QR\b/iu;
 const security=/generate.{0,50}(?:one.time|authentication|two.factor).{0,30}codes?|authenticator|security token|password manager/iu;
 const linkedOnly=/\bonly\b.{0,65}(?:connect|link|aggregate).{0,60}(?:existing|external|bank) accounts|account aggregator|does not (?:open|offer|provide|issue).{0,35}(?:accounts|IBAN)/iu;
 return ibanTool.test(text)||accounting.test(text)||qrTool.test(text)||security.test(text)||linkedOnly.test(text)||/(?:stored|stay).{0,80}(?:your (?:own )?device|locally)|(?:store|organize).{0,40}(?:IBAN|card) (?:details|information)/iu.test(text);
}
