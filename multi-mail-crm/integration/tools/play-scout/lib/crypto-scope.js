// Suppress standalone crypto wallets, not fiat-account providers that also
// support crypto. Currency conversion or a fiat top-up destination is not an
// account issued to the customer.
export function pureCryptoWallet(entry={}){
 const documents=entry.documents?.length?entry.documents:entry.sourceDocuments??[],text=[entry.title,documents.length?documents.map(d=>d.text).join('\n'):entry.screeningText??entry.snippet??''].filter(Boolean).join('\n');
 if(!/\b(?:crypto|bitcoin|ethereum|blockchain|web3|USDC|USDT|self.custod|non.custod|seed phrase|private keys?|Solana)\b|крипто|биткоин/iu.test(text)||!/\b(?:wallets?|self.custody|non.custodial|seed phrase|private keys?)\b|криптокошел/iu.test(text))return false;
 const lines=text.split(/\n+|(?<=[.!?;])\s+/u);
 const hasAccount=lines.some(s=>!/\b(?:do not|does not|cannot|no|without)\b.{0,45}(?:provide|offer|issue|accounts?|IBAN)/iu.test(s)&&(/\b(?:open|create|offer|provide|issue|get|receive)\w*\b.{0,70}(?:(?:business|corporate|bank|payment|fiat|EUR|euro|multi.currency|global)\s+){1,3}accounts?\b|\b(?:offer|provide|issue|receive|get)\w*\b.{0,65}\bIBANs?\b|\b(?:your|our|named|dedicated)\s+(?:EUR |euro |business |corporate )?IBANs?\b/iu.test(s)));
 const regulated=/electronic.money institution|e.money institution|payment institution/iu.test(text)&&/authori[sz]ed|licensed|regulated|money transmission/iu.test(text)&&/business|companies|corporate|payment services|money transmission/iu.test(text);
 return !hasAccount&&!regulated;
}
