import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFields} from '../lib/extraction-fields.js';
import {registryFields} from '../lib/registry-extraction.js';

test('passport printed labels preserve compound given and family names',()=>{
 const rows=extractFields([{page:1,text:'PASSPORT\nSurname(s)\nDE LA CRUZ\nGiven name(s)\nANNA MARIA\nNationality\nEXAMPLE'}]);
 assert.equal(rows.find(r=>r.key==='contact_first_name')?.value,'ANNA MARIA');
 assert.equal(rows.find(r=>r.key==='contact_last_name')?.value,'DE LA CRUZ');
 assert.equal(rows.some(r=>r.key.startsWith('director_')),false);
});
test('Latvian ID labels accept diacritics and bilingual headings',()=>{
 const rows=extractFields([{page:1,text:'IDENTITY CARD\nUzvārds / Surname\nBērziņa\nVārds / Given names\nAnna Marija'}]);
 assert.equal(rows.find(r=>r.key==='contact_first_name')?.value,'Anna Marija');
 assert.equal(rows.find(r=>r.key==='contact_last_name')?.value,'Bērziņa');
});
test('registry classification includes director pages without repeated Companies House heading',()=>{
 const rows=registryFields([{page:1,text:'CERTIFICATE OF INCORPORATION\nEXAMPLE GOODS LTD\nCompany Number: 12345678'},{page:4,text:'Director\nFull Forename(s): ANNA MARIA\nSurname: DE LA CRUZ'}]);
 assert.equal(rows.find(r=>r.key==='director_first_name')?.value,'ANNA MARIA');
 assert.equal(rows.find(r=>r.key==='director_last_name')?.page,4);
 assert.equal(registryFields([{page:1,text:'Director\nFull Forename(s): ANNA\nSurname: EXAMPLE'}]).length,0);
});

test('birth date is extracted from bilingual ID labels with slash format, not issue or expiry',()=>{
 const rows=extractFields([{page:1,text:'IDENTITY CARD\nSurname: EXAMPLE\nGiven names: ALICE\nDate of birth / Dzimšanas datums\n15/07/1990\nDate of issue: 01/02/2020\nDate of expiry: 01/02/2030'}]);
 assert.equal(rows.find(r=>r.key==='contact_birth_date')?.value,'1990-07-15');
});
test('MRZ birth date requires a valid check digit and a valid calendar date',async()=>{
 const {mrzBirthDate}=await import('../lib/normalization.js');
 const valid='L898902C36UTO7408122F1204159ZE184226B<<<<<10';
 assert.equal(mrzBirthDate(valid),'1974-08-12');
 assert.equal(mrzBirthDate(valid.slice(0,19)+'3'+valid.slice(20)),undefined);
 const rows=extractFields([{page:1,text:'PASSPORT\n'+valid}]);assert.equal(rows.find(r=>r.key==='contact_birth_date')?.value,'1974-08-12');
});

test('passport printed fields preserve leading zeros and distinguish passport number from personal code',()=>{
 const rows=extractFields([{page:1,text:'PASSPORT\nSurname: EXAMPLE\nGiven names: ALICE\nPassport No.\nAB0012345\nPersonal number: 150790-12345\nDate of issue: 12/11/2022\nDate of expiry: 12/11/2032\nNationality: LVA\nIssuing country: Latvia\nSex: Female'}]);
 for(const [key,value] of Object.entries({contact_passport_number:'AB0012345',contact_personal_id:'150790-12345',contact_passport_issued_on:'2022-11-12',contact_passport_expiry:'2032-11-12',contact_nationality:'Latvia',contact_issuing_country:'Latvia',contact_gender:'F'}))assert.equal(rows.find(r=>r.key===key)?.value,value,key);
});
test('TD3 MRZ extracts number, names, nationality and expiry; a damaged number check digit is rejected',()=>{
 const first='P<LVAEXAMPLE<<ALICE'.padEnd(44,'<'),second='L898902C36LVA7408122F1204159ZE184226B<<<<<10';
 const rows=extractFields([{page:1,text:first+'\n'+second}]);
 for(const [key,value] of Object.entries({contact_passport_number:'L898902C3',contact_first_name:'ALICE',contact_last_name:'EXAMPLE',contact_nationality:'Latvia',contact_issuing_country:'Latvia',contact_passport_expiry:'2012-04-15'}))assert.equal(rows.find(r=>r.key===key)?.value,value,key);
 const damaged=second.slice(0,9)+'7'+second.slice(10);const bad=extractFields([{page:1,text:first+'\n'+damaged}]);assert.equal(bad.some(r=>r.key==='contact_passport_number'),false);
});

test('TD1 ID-card MRZ uses card number, not passport number or personal ID',()=>{
 const digit=value=>String([...value].reduce((sum,c,i)=>sum+(c==='<'?0:/\d/.test(c)?Number(c):c.charCodeAt(0)-55)*[7,3,1][i%3],0)%10);
 const number='AB0012345',first=('I<LVA'+number+digit(number)).padEnd(30,'<'),second=('900715'+digit('900715')+'F'+'321112'+digit('321112')+'LVA').padEnd(30,'<'),third='EXAMPLE<<ANNA<MARIA'.padEnd(30,'<');
 const rows=extractFields([{page:1,text:[first,second,third].join('\n')}]);assert.equal(rows.find(r=>r.key==='contact_id_number')?.value,number);assert.equal(rows.find(r=>r.key==='contact_first_name')?.value,'ANNA MARIA');assert.equal(rows.find(r=>r.key==='contact_last_name')?.value,'EXAMPLE');assert.equal(rows.find(r=>r.key==='contact_id_expiry')?.value,'2032-11-12');assert.equal(rows.some(r=>r.key==='contact_passport_number'||r.key==='contact_personal_id'),false);
});
