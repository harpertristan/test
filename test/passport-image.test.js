import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';import {extractDocument} from '../lib/extraction.js';import {extractFields} from '../lib/extraction-fields.js';
test('synthetic passport photo OCR extracts given names, surname and date of birth',async()=>{
 const canvas=createCanvas(1600,800),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,800);ctx.fillStyle='#000';ctx.font='48px sans-serif';
 ['PASSPORT','Surname: EXAMPLE','Given names: ALICE','Date of birth: 15.07.1990','Date of expiry: 12.11.2032'].forEach((line,i)=>ctx.fillText(line,60,100+i*125));
 const pages=await extractDocument(canvas.toBuffer('image/png'),'synthetic-passport.png');const fields=extractFields(pages);
 assert.equal(fields.find(f=>f.key==='contact_first_name')?.value,'ALICE');assert.equal(fields.find(f=>f.key==='contact_last_name')?.value,'EXAMPLE');assert.equal(fields.find(f=>f.key==='contact_birth_date')?.value,'1990-07-15');
});
