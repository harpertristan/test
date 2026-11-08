import test from 'node:test';import assert from 'node:assert/strict';
import {registryURL,parseRegister,previewRegister} from '../lib/company-register.js';
import {registryOverviewHTML as html} from '../scripts/fixtures/company-register.js';
const url='https://find-and-update.company-information.service.gov.uk/company/01234567';
test('registry URL is restricted to exact HTTPS company records without arbitrary fetch destinations',()=>{
 assert.equal(registryURL(url),url);for(const bad of ['http://127.0.0.1/company/01234567',url.replace('https:','http:'),url+'/officers',url+'?redirect=http://localhost',url.replace('.gov.uk','.gov.uk.evil.test'),url.replace('https://','https://key@')])assert.throws(()=>registryURL(bad));
});
test('registry extracts cited overview values and refuses an unverified number or access challenge',()=>{
 const result=parseRegister(html,url);const values=Object.fromEntries(result.fields.map(row=>[row.key,row.value]));assert.equal(values.company_number,'01234567');assert.equal(values.city,'Bristol');assert.equal(values.postal_code,'BS1 1AA');assert.equal(values.incorporated_on,'2026-11-03');assert.equal(values.tax_residence_country,undefined);assert.equal(values.website,undefined);
 assert.throws(()=>parseRegister('<h1>Check your browser</h1>',url));assert.throws(()=>parseRegister(html,url.replace('01234567','87654321')));
});
test('registry preview bounds network requests and cannot follow redirects',async()=>{
 let seen;const result=await previewRegister(url,async(request,options)=>{seen={request,options};return new Response(html,{headers:{'Content-Type':'text/html'}});});assert.equal(seen.options.redirect,'error');assert.equal(result.fields.some(row=>row.key==='city'),true);
 await assert.rejects(previewRegister(url,async()=>new Response('not a page',{status:403})),/Реестр/);
});
test('UK domestic registry address without a printed country still yields separated address components',()=>{
 const values=Object.fromEntries(parseRegister(html.replace(', England,',','),url).fields.map(field=>[field.key,field.value]));assert.equal(values.city,'Bristol');assert.equal(values.postal_code,'BS1 1AA');assert.equal(values.registered_country,'United Kingdom');assert.equal(values.tax_residence_country,undefined);
});
test('overseas records cannot silently become UK-incorporated companies merely because they are listed at Companies House',()=>{
 assert.throws(()=>parseRegister(html.replace('Private limited company','Overseas company'),url),/тип записи/);
});
