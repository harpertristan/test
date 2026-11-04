import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createCanvas} from '@napi-rs/canvas';
import {extractDocument} from '../lib/extraction.js';

export function makePdf(text='Company name: Example Limited') {
  const content=`BT /F1 18 Tf 40 740 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf);
}
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
