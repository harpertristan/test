import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';import {extractDocument} from '../lib/extraction.js';import {extractFields} from '../lib/extraction-fields.js';
test('synthetic passport photo OCR extracts given names, surname and date of birth',async()=>{
 const canvas=createCanvas(1800,1500),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1800,1500);ctx.fillStyle='#000';ctx.font='48px sans-serif';
 ['PASSPORT','Surname: EXAMPLE','Given names: ALICE','Date of birth: 15.07.1990','Date of expiry: 12.11.2032','Passport No: AB0012345','Date of issue: 12.11.2022','Nationality: Latvian','Issuing country: Latvia','Sex: Female','Personal number: 150790-12345'].forEach((line,i)=>ctx.fillText(line,60,100+i*125));
 const pages=await extractDocument(canvas.toBuffer('image/png'),'synthetic-passport.png');const fields=extractFields(pages);
 assert.equal(fields.find(f=>f.key==='contact_first_name')?.value,'ALICE');assert.equal(fields.find(f=>f.key==='contact_last_name')?.value,'EXAMPLE');assert.equal(fields.find(f=>f.key==='contact_birth_date')?.value,'1990-07-15');for(const [key,value] of Object.entries({contact_passport_number:'AB0012345',contact_passport_issued_on:'2022-11-12',contact_passport_expiry:'2032-11-12',contact_nationality:'Latvia',contact_issuing_country:'Latvia',contact_gender:'F',contact_personal_id:'150790-12345'}))assert.equal(fields.find(f=>f.key===key)?.value,value,key);
});

test('JPEG passport image with a small camera tilt retains number and leading zeros',async()=>{
 const canvas=createCanvas(1800,1100),ctx=canvas.getContext('2d');ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,1800,1100);ctx.translate(55,25);ctx.rotate(1.5*Math.PI/180);ctx.fillStyle='white';ctx.fillRect(0,0,1680,1000);ctx.fillStyle='black';ctx.font='52px sans-serif';
 ['PASSPORT','Surname: EXAMPLE','Given names: ALICE','Passport No: AB0012345','Date of birth: 15.07.1990','Date of expiry: 12.11.2032'].forEach((line,i)=>ctx.fillText(line,60,105+i*135));
 const fields=extractFields(await extractDocument(canvas.toBuffer('image/jpeg',85),'synthetic-tilted-passport.jpg'));
 assert.equal(fields.find(f=>f.key==='contact_passport_number')?.value,'AB0012345');assert.equal(fields.find(f=>f.key==='contact_birth_date')?.value,'1990-07-15');
});
