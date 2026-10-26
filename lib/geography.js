// Storefront availability is not the provider's domicile or the IBAN issuer.
export function nigeriaEvidence(entry={}) {
 const text=[entry.title,entry.developer,entry.developerAddress,entry.developerCountry,entry.screeningText,entry.snippet,entry.summary,...(entry.documents??[]).map(d=>d.text)].filter(Boolean).join(' ');
 const mention=text.match(/(?<!\p{L})(?:Nigeria(?:n)?|Нигери[яиюей]+|NGN|naira|найр[аы])(?!\p{L})/iu);
 const urls=[entry.url,entry.developerWebsite].filter(Boolean);
 const domain=urls.find(raw=>{try{return /\.ng$/i.test(new URL(raw).hostname);}catch{return false;}});
 if(mention||domain||entry.developerCountry==='NG')return {reason:'excludedNigeria',text:mention?.[0]??domain??'NG'};
 return null;
}
