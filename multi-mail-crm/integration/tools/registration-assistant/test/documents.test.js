import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createCanvas} from '@napi-rs/canvas';
import {extractDocument} from '../lib/extraction.js';

import {makePdf} from '../scripts/fixtures/pdf.js';
test('extracts actual text PDF with page provenance',async()=>{
  const pages=await extractDocument(makePdf(),'registration.pdf');assert.equal(pages[0].page,1);assert.match(pages[0].text,/Company name: Example Limited/);
});
test('reads a Word document as text, never executes embedded HTML',async()=>{
  const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Example Limited</w:t></w:r></w:p></w:body></w:document>');
  const pages=await extractDocument(await zip.generateAsync({type:'nodebuffer'}),'company.docx');assert.match(pages[0].text,/Example Limited/);
});
test('recognizes a real image locally using bundled language data', {timeout:120000},async()=>{
  const canvas=createCanvas(1200,180);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,180);ctx.fillStyle='black';ctx.font='42px sans-serif';ctx.fillText('Company name: EXAMPLE LIMITED',30,95);
  const pages=await extractDocument(canvas.toBuffer('image/png'),'photo.png');assert.match(pages[0].text,/EXAMPLE LIMITED/);
});
test('renders and recognizes a PDF consisting of a scanned image', {timeout:120000},async()=>{
  const canvas=createCanvas(1200,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,180);ctx.fillStyle='black';ctx.font='42px sans-serif';ctx.fillText('Company name: EXAMPLE LIMITED',30,95);
  const jpeg=canvas.toBuffer('image/jpeg'),content='q 600 0 0 90 0 0 cm /Im0 Do Q';
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 90] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)];
  const parts=[Buffer.from('%PDF-1.4\n')],offsets=[];let length=parts[0].length;
  objects.forEach((object,index)=>{offsets.push(length);const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);length+=part.length;});
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
  const pages=await extractDocument(Buffer.concat(parts),'scan.pdf');assert.match(pages[0].text,/EXAMPLE LIMITED/);
});
test('unsupported and corrupt documents fail rather than returning invented data',async()=>{
  await assert.rejects(extractDocument(Buffer.from('bad'),'invalid.pdf'));
  await assert.rejects(extractDocument(Buffer.from('bad'),'script.exe'));
});

test('recognizes all 30 scanned PDF pages including a unique identifier on the final page',{timeout:180000},async()=>{
  const {makeScannedPdf}=await import('../scripts/fixtures/scanned-pdf.js');
  const texts=Array.from({length:30},(_,index)=>index===29?'FINAL PAGE COMPANY NUMBER 87654321':`PAGE ${index+1} EXAMPLE LIMITED`);
  const pages=await extractDocument(makeScannedPdf(texts),'thirty-page-scan.pdf');
  assert.equal(pages.length,30);assert.deepEqual(pages.map(page=>page.page),Array.from({length:30},(_,i)=>i+1));
  for(const page of pages)assert.ok(page.text.trim().length>0,`page ${page.page} must be read`);
  assert.match(pages[29].text,/87654321/);assert.match(pages[29].text,/FINAL PAGE/);
});

test('identity photo OCR transfers explicitly labelled compound names into the profile draft',{timeout:120000},async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {openDatabase}=await import('../lib/database.js');const {reanalyze}=await import('../lib/auto-facts.js');const {profileState}=await import('../lib/company-profile.js');
 const canvas=createCanvas(1600,600),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,600);ctx.fillStyle='black';ctx.font='42px sans-serif';
 ['PASSPORT','Surname: DE LA CRUZ','Given names: ANNA MARIA','Nationality: EXAMPLE'].forEach((line,i)=>ctx.fillText(line,40,100+i*110));
 const pages=await extractDocument(canvas.toBuffer('image/png'),'synthetic-identity.png');
 const directory=mkdtempSync(join(tmpdir(),'ra-photo-')),db=openDatabase(directory);t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 db.prepare('INSERT INTO users VALUES(1,?,?)').run('test','hash');db.prepare('INSERT INTO companies VALUES(?,?,?)').run('company',1,'EXAMPLE GOODS LTD');
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('identity','company','synthetic-identity.png',JSON.stringify(pages),'ready');reanalyze(db,'company');
 const state=profileState(db,'company');assert.equal(state.values.contact_first_name,'ANNA MARIA');assert.equal(state.values.contact_last_name,'DE LA CRUZ');assert.equal(state.approved,false);assert.equal(state.sources.contact_first_name.documentId,'identity');
});
