import test from 'node:test';
import assert from 'node:assert/strict';
import {profileSelections} from '../lib/profile-selection.js';
const doc=(id,text=id)=>({id,pages:JSON.stringify([{page:1,text}])});
const row=(document_id,value,extra={})=>({key:'business_description',value,quote:value,document_id,page:1,note:'',automatic:1,...extra});
test('majority counts distinct documents rather than repeated rows or identical uploads',()=>{
 const docs=[doc('a'),doc('copy','a'),doc('b'),doc('c')];
 const rows=[row('a','Retail'),row('a','Retail'),row('copy','Retail'),row('b','Wholesale'),row('c','Wholesale')];
 const result=profileSelections(rows,docs).business_description;
 assert.equal(result.value,'Wholesale');assert.equal(result.votes,2);assert.equal(result.total,3);assert.equal(result.tied,false);
});
test('single cited review candidate fills a draft; foreign companies and ungrounded values do not vote',()=>{
 const result=profileSelections([row('a','Retail',{automatic:0}),row('b','Other',{note:'Название в документе отличается от выбранной компании. Проверьте принадлежность документа.'}),row('c','Invented',{quote:'No such value'})],[doc('a'),doc('b'),doc('c')]);
 assert.equal(result.business_description.value,'Retail');assert.equal(result.business_description.total,1);
});
test('ties prefer relevant official sources and disclose a tie instead of claiming a majority',()=>{
 const result=profileSelections([row('a','11111111',{key:'company_number'}),row('b','22222222',{key:'company_number',note:'Регистрационный документ компании: номер'})],[doc('a'),doc('b')]).company_number;
 assert.equal(result.value,'22222222');assert.equal(result.tied,true);assert.match(result.reason,/поровну/);
});
test('address parts follow one selected address block instead of assembling different addresses',()=>{
 const rows=[row('a','1 Example Road, Bristol',{key:'registered_address'}),row('a','1 Example Road',{key:'registered_address_line1',quote:'1 Example Road, Bristol'}),row('a','Bristol',{key:'city',quote:'1 Example Road, Bristol'}),row('b','London',{key:'city'})];
 const result=profileSelections(rows,[doc('a'),doc('b')]);assert.equal(result.city.value,'Bristol');assert.equal(result.registered_address_line2.value,'');
});
test('first and last names are selected as a pair rather than mixing independent majorities',()=>{
 const rows=[row('a','Alice',{key:'contact_first_name'}),row('a','Example',{key:'contact_last_name'}),row('b','Alice',{key:'contact_first_name'}),row('b','Other',{key:'contact_last_name'}),row('c','Anna',{key:'contact_first_name'}),row('c','Other',{key:'contact_last_name'})];
 const result=profileSelections(rows,[doc('a'),doc('b'),doc('c')]);assert.equal(result.contact_first_name.document_id,result.contact_last_name.document_id);assert.equal(result.contact_first_name.tied,true);
});
test('registry address outranks supplier invoices even when the supplier has more documents',()=>{
 const quote='Registered Office: 8 Example Road, Bristol, BS1 1AA, England';
 const rows=[row('registry','8 Example Road, Bristol, BS1 1AA, England',{key:'registered_address',quote,note:'Регистрационный документ компании: адрес'}),row('registry','Bristol',{key:'city',quote,note:'Регистрационный документ компании: город'})];
 const docs=[doc('registry')];for(let i=0;i<3;i++){docs.push({...doc('vendor'+i),filename:'invoice-'+i+'.pdf'});rows.push(row('vendor'+i,'London',{key:'city'}));}
 const selected=profileSelections(rows,docs);assert.equal(selected.city.value,'Bristol');assert.equal(selected.city.document_id,'registry');
 const bad=profileSelections([row('registry','BS1 1AA (Provider).',{key:'city'})],docs);assert.equal(bad.city,undefined);
});
test('incorporation document address is preferred to registry-like footer on an unrelated agreement',()=>{
 const quote='Registered Office: 8 Example Road, Bristol, BS1 1AA, England',note='Регистрационный документ компании: адрес';
 const docs=[doc('registry','CERTIFICATE OF INCORPORATION'),doc('agreement','Service agreement. Companies House company number and registered office in footer.')];
 const rows=[row('registry','8 Example Road, Bristol, BS1 1AA, England',{key:'registered_address',quote,note}),row('registry','Bristol',{key:'city',quote,note}),row('agreement','London',{key:'city',note})];
 assert.equal(profileSelections(rows,docs).city.value,'Bristol');
});
