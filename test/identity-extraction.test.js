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
