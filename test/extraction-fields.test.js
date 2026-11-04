import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFields,splitLegacyNames} from '../lib/extraction-fields.js';
import {suggest,resolveFieldKey} from '../lib/fields.js';
import {valueGrounded} from '../lib/normalization.js';

import {notebook} from '../scripts/fixtures/notebook.js';
test('unlabelled notebook becomes separate sourced company, person and business data',()=>{
  const rows=extractFields([{page:1,text:notebook}],'EXAMPLE GOODS LTD');
  const fields=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  assert.equal(fields.contact_first_name,'Alice');assert.equal(fields.contact_last_name,'Example');assert.equal(fields.company_number,'12345678');
  assert.equal(fields.website,'https://example.com');assert.equal(fields.country,'United Kingdom');assert.equal(fields.contact_birth_date,'1988-12-13');assert.equal(fields.contact_passport_expiry,'2032-09-18');
  assert.match(fields.business_description_short,/sells bags online/);assert.match(fields.account_purpose,/receive customer payments/);
  assert.equal(fields.company_email,undefined);assert.equal(fields.company_phone,undefined);assert.equal(fields.director_name,undefined);assert.equal(fields.industry,undefined);
  for(const row of rows){assert.ok(valueGrounded(row.key,row.value,row.quote),row.key);assert.ok(notebook.includes(row.quote),row.key);}
});
test('issuer details in a bank statement are never imported as applicant details',()=>{
  const rows=extractFields([{page:1,text:'EUR Statement\nGenerated on 1 November\nISSUER BANK LTD\nCompany number 87654321\nRegistered office address\nBank street 1, England'}],'EXAMPLE GOODS LTD');
  assert.deepEqual(rows,[]);
});
test('different company and multiple people require review instead of silent identity merging',()=>{
  assert.ok(extractFields([{page:1,text:notebook}],'ANOTHER COMPANY LTD').every(row=>!row.automatic));
  const text=notebook+'\nBob Sample\nBB7654321\n01.01.1980';
  const names=extractFields([{page:1,text}],'EXAMPLE GOODS LTD').filter(row=>row.key==='contact_first_name');assert.equal(names.length,2);assert.ok(names.every(row=>!row.automatic));
});
test('legacy director names produce distinct first and last names without changing the full name',()=>{
  const fact={key:'director_name',value:'Alice Example',quote:'Director: Alice Example',page:1,document_id:'doc'};
  const rows=splitLegacyNames([fact]);assert.deepEqual(rows.map(row=>row.value),['Alice','Example']);assert.equal(fact.value,'Alice Example');
  assert.equal(splitLegacyNames([{...fact,value:'Alice Mary Example'}]).length,0);
});
test('field resolver handles synonyms, camelCase, optional markers and questions',()=>{
  for(const label of ['Website','Web site','Company URL','website_url','Your website URL (optional)','What is your company website?','Сайт компании'])assert.equal(resolveFieldKey({label}),'website',label);
  for(const label of ['First name','first_name','firstName','Given name','Forename'])assert.equal(resolveFieldKey({label}),'contact_first_name',label);
  for(const label of ['Last name','last_name','lastName','Surname','Family name'])assert.equal(resolveFieldKey({label}),'contact_last_name',label);
  assert.equal(resolveFieldKey({label:'',name:'companyWebsite'}),'website');
  assert.equal(resolveFieldKey({label:'Contact detail',autocomplete:'given-name'}),'contact_first_name');
  assert.equal(resolveFieldKey({label:'Country of tax residence',name:'country'}),undefined);
  assert.equal(resolveFieldKey({label:'Personal email',name:'companyEmail'}),undefined);
});
test('automatic facts fill the screenshot fields and normalized country options',()=>{
  const facts=extractFields([{page:1,text:notebook}],'EXAMPLE GOODS LTD').map((row,index)=>({...row,id:String(index),confirmed:2,filename:'note.txt'}));
  for(const [label,value] of [['First name','Alice'],['Last name','Example'],['Website','https://example.com'],['Company name','EXAMPLE GOODS LTD']])assert.equal(suggest({label,type:'text'},facts).value,value);
  assert.equal(suggest({label:'Country of incorporation',type:'select-one',options:[{text:'United Kingdom',value:'GB'}]},facts).optionValue,'GB');
  assert.equal(suggest({label:'Message / anything else we should know',type:'textarea'},facts).key,'business_description_short');
  assert.equal(suggest({label:'Annualized transaction volume (EUR)',type:'select-one',options:[]},facts).status,'manual');
});
test('generic contact fields never combine the name of one person with a different role surname',()=>{
  const facts=[{id:'a',key:'contact_first_name',value:'Alice',confirmed:1},{id:'b',key:'director_last_name',value:'Different',confirmed:1}];
  assert.equal(suggest({label:'First name',type:'text'},facts).value,'Alice');assert.equal(suggest({label:'Last name',type:'text'},facts).status,'manual');
});
