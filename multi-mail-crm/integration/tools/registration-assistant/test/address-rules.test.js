import test from 'node:test';
import assert from 'node:assert/strict';
import {addressIssue,cleanPostcode} from '../public/address-rules.js';
import {splitAddress} from '../lib/addresses.js';
import {suggest} from '../lib/fields.js';
import {valueGrounded} from '../lib/normalization.js';

test('UK postcode is a standalone formatted value and can never be a city',()=>{
 assert.equal(cleanPostcode('bs11aa','United Kingdom'),'BS1 1AA');
 for(const value of ['BS1 1AA (Provider).','Bristol BS1 1AA','BS1 1AA UK'])assert.ok(addressIssue('postal_code',value,'GB'),value);
 for(const value of ['BS1 1AA','BS1 1AA (Provider).','England','8 Example Road'])assert.ok(addressIssue('city',value,'GB'),value);
 assert.equal(addressIssue('city','Bristol','GB'),undefined);
 assert.equal(valueGrounded('postal_code','BS1 1AA','Postcode bs11aa'),true);
});
test('postal rules respect country and do not apply the UK pattern worldwide',()=>{
 assert.equal(cleanPostcode('LV1000','LV'),'LV-1000');assert.equal(cleanPostcode('10115','DE'),'10115');assert.equal(cleanPostcode('K1A0B1','CA'),'K1A 0B1');assert.equal(cleanPostcode('BS1 1AA','DE'),undefined);
});
test('postcode on the city line is extracted separately and provider annotations are rejected',()=>{
 const parts=splitAddress('8 Example Road\nBristol BS1 1AA\nEngland');
 assert.equal(parts.city,'Bristol');assert.equal(parts.postcode,'BS1 1AA');assert.equal(parts.line1,'8 Example Road');
 assert.deepEqual(splitAddress('Vendor Road, BS1 1AA (Provider)., United Kingdom'),{});
});
test('proposal refuses a bad city even when an old fact was manually confirmed',()=>{
 const proposal=suggest({label:'Town / city',type:'text'},[{key:'city',value:'BS1 1AA (Provider).',confirmed:1,id:'old',quote:'BS1 1AA (Provider).'}]);assert.equal(proposal.status,'manual');assert.equal(proposal.value,undefined);
});
