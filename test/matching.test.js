import test from 'node:test';
import assert from 'node:assert/strict';
import {suggest} from '../lib/fields.js';

const fact={id:'f1',key:'company_name',value:'Example Limited',confirmed:1,filename:'register.pdf',page:2,quote:'Company name: Example Limited'};
test('only a confirmed exact-purpose value is suggested with its provenance',()=>{
  const result=suggest({label:'Company name',type:'text'},[fact]);
  assert.equal(result.value,'Example Limited');assert.equal(result.source,'register.pdf');assert.equal(result.page,2);
  assert.equal(suggest({label:'Company name',type:'text'},[{...fact,confirmed:0}]).status,'manual');
});
test('company country is never substituted for tax residence or citizenship',()=>{
  const facts=[{...fact,key:'country',value:'United Kingdom'}];
  for(const label of ['Country of tax residence','Citizenship','Country','Country of residence'])assert.equal(suggest({label,type:'text'},facts).status,'manual');
  assert.equal(suggest({label:'Country of incorporation',type:'text'},facts).value,'United Kingdom');
});
test('passwords, confirmations and unknown meanings do not receive proposals',()=>{
  assert.equal(suggest({label:'Company name',type:'password'},[fact]).status,'blocked');
  assert.equal(suggest({label:'OTP verification code',type:'text'},[fact]).status,'blocked');
  assert.equal(suggest({label:'Company name',type:'checkbox'},[fact]).status,'manual');
  assert.equal(suggest({label:'Applicant name',type:'text'},[fact]).status,'manual');
});
test('ambiguous or unsupported select values require manual selection',()=>{
  const field={label:'Country of incorporation',type:'select-one',options:[{text:'United Kingdom',value:'GB'}]},facts=[{...fact,key:'country',value:'United Kingdom'}];
  assert.equal(suggest(field,facts).optionValue,'GB');
  assert.equal(suggest({...field,options:[...field.options,...field.options]},facts).status,'manual');
  assert.equal(suggest({...field,options:[{text:'UK',value:'GB'}]},facts).status,'manual');
  assert.equal(suggest({label:'Company name',type:'text'},[fact,{...fact,id:'f2'}]).status,'manual');
});
