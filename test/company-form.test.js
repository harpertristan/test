import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {splitAddress} from '../lib/addresses.js';
import {suggest,resolveFieldKey} from '../lib/fields.js';
import {extractFields} from '../lib/extraction-fields.js';
import {openDatabase} from '../lib/database.js';
import {aiConfiguration,aiStatus,saveAISettings} from '../lib/ai-settings.js';
import {analyzeForm,fieldFingerprint,mappingAllowed} from '../lib/form-agent.js';

test('registered street, locality, town, postcode and country are separated without reusing them for operating address',()=>{
  const parts=splitAddress('8 Example Road, Test Locality, Example Town, England, AB1 2CD');assert.deepEqual(parts,{line1:'8 Example Road',line2:'Test Locality',city:'Example Town',postcode:'AB1 2CD',country:'United Kingdom',region:undefined});
  const county=splitAddress('8 Example Road, Test Locality, Example Town, Hampshire, England, AB1 2CD');assert.equal(county.city,'Example Town');assert.equal(county.region,'Hampshire');
  assert.deepEqual(splitAddress('Unstructured unknown address'),{});
  for(const [caption,key] of [['Address line 1','registered_address_line1'],['Address line 2','registered_address_line2'],['Town / city','city'],['Post code','postal_code'],['Country','registered_country']])assert.equal(resolveFieldKey({label:'Registered address',caption,addressKind:'registered'}),key);
  assert.equal(resolveFieldKey({label:'Postcode',addressKind:'operating'}),'operating_postal_code');
  assert.equal(resolveFieldKey({label:'Postcode',ambiguousAddress:true}),undefined);
});
test('company or trading name uses the legal name, while trading name alone requires a distinct fact',()=>{
  const facts=[{id:'company',key:'company_name',value:'EXAMPLE GOODS LTD',confirmed:1}];
  assert.equal(suggest({label:'Company or Trading name',type:'text'},facts).value,'EXAMPLE GOODS LTD');assert.equal(suggest({label:'Trading name',type:'text'},facts).status,'manual');
  assert.equal(suggest({label:'Company legal form',type:'select-one',options:[{text:'Private limited company',value:'private'},{text:'Public limited company',value:'public'}]},[{id:'form',key:'legal_form',value:'Private company limited by shares',confirmed:1}]).optionValue,'private');
});
test('tax, VAT and tax residence stay distinct and selected Malta does not silently accept UK UTR',()=>{
  const facts=[{id:'tax',key:'tax_number',value:'0012345678',quote:'UTR 0012345678',confirmed:1}];
  assert.equal(suggest({label:'VAT number',type:'text'},facts).status,'manual');assert.equal(suggest({label:'Tax number',type:'text',taxCountry:'Malta'},facts).status,'manual');
  facts.push({id:'residence',key:'tax_residence_country',value:'United Kingdom',confirmed:1});assert.equal(suggest({label:'Tax number',type:'text',taxCountry:'MT'},facts).status,'manual');assert.equal(suggest({label:'Tax number',type:'text',taxCountry:'GB'},facts).value,'0012345678');
  assert.equal(suggest({label:'VAT number',type:'text'},[{...facts[0],key:'vat_number'}]).status,'manual');
  const rows=extractFields([{page:1,text:'EXAMPLE GOODS LTD\nUTR 0012345678\nVAT Registration Number GB123 4567 89\nVAT status: Not registered'}],'EXAMPLE GOODS LTD');
  assert.equal(rows.find(row=>row.key==='tax_number').value,'0012345678');assert.equal(rows.find(row=>row.key==='vat_number').value,'GB123456789');assert.equal(rows.filter(row=>row.key==='vat_number').length,1);
});
test('registration date respects the MM-DD-YYYY format in the sample form',()=>{
  assert.equal(suggest({label:'Date of Registration',type:'text',placeholder:'MM-DD-YYYY'},[{id:'d',key:'incorporated_on',value:'2025-10-03',confirmed:1}]).value,'10-03-2025');
});
function setup(t){const directory=mkdtempSync(join(tmpdir(),'assistant-ai-')),db=openDatabase(directory);db.prepare('INSERT INTO users VALUES(1,?,?)').run('one','hash');db.prepare('INSERT INTO users VALUES(2,?,?)').run('two','hash');db.prepare('INSERT INTO companies VALUES(?,?,?)').run('company',1,'Example Limited');t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});return {db,directory};}
test('OpenAI keys are encrypted, isolated per user and never returned in status',t=>{
  const {db,directory}=setup(t),secret='synthetic-openai-private-key-for-tests';saveAISettings(db,directory,1,{apiKey:secret,model:'test-model'});
  assert.equal(aiConfiguration(db,directory,1,{}).AI_API_KEY,secret);assert.equal(aiStatus(db,2,{}).configured,false);assert.equal(JSON.stringify(aiStatus(db,1,{})).includes(secret),false);
  assert.equal(db.prepare('SELECT encrypted_key FROM ai_settings').get().encrypted_key.includes(secret),false);assert.equal(readFileSync(join(directory,'assistant.sqlite')).includes(Buffer.from(secret)),false);
  if(process.platform!=='win32')assert.equal(statSync(join(directory,'.secrets','ai-master.key')).mode&0o777,0o600);
});
test('form agent receives only field metadata, rejects unsafe remapping and requires confirmation of novel meanings',async t=>{
  const {db}=setup(t),fields=[{id:'name',label:'Organisation designation',name:'designation',type:'text'},{id:'vat',label:'VAT number',type:'text'},{id:'password',label:'Password',type:'password',value:'must not be sent'}];let body;
  await analyzeForm(db,'company','bank.example',fields,{AI_API_KEY:'synthetic-api-key-only',AI_MODEL:'test-model'},async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({fields:[{id:'name',key:'company_name',explanation:'Юридическое название организации.'},{id:'vat',key:'tax_number',explanation:'Incorrect attempt'},{id:'password',key:'company_name',explanation:'Incorrect attempt'}]})}}]})};});
  assert.equal(JSON.stringify(body).includes('must not be sent'),false);const mapping=db.prepare('SELECT * FROM form_mappings').get();assert.equal(mapping.key,'company_name');assert.equal(mapping.status,'suggested');assert.equal(mapping.fingerprint,fieldFingerprint(fields[0]));assert.equal(db.prepare('SELECT count(*) n FROM form_mappings').get().n,1);
  assert.equal(mappingAllowed({label:'Country of tax residence'},'country'),false);assert.equal(mappingAllowed({label:'Address line 1',caption:'Address line 1',addressKind:'operating'},'registered_address_line1'),false);
});
