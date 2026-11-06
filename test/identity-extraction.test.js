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
