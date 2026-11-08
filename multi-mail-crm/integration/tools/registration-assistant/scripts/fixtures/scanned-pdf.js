import {createCanvas} from '@napi-rs/canvas';
// Synthetic raster-only PDF; no text layer, real OCR is required on every page.
export function makeScannedPdf(texts){
  const objects=[null,null],kids=[];
  for(const text of texts){
    const canvas=createCanvas(1600,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,180);ctx.fillStyle='black';ctx.font='40px sans-serif';ctx.fillText(text,30,100);
    const jpeg=canvas.toBuffer('image/jpeg');canvas.width=1;canvas.height=1;
    const pageId=objects.length+1,imageId=pageId+1,contentId=pageId+2;kids.push(`${pageId} 0 R`);
    const content='q 800 0 0 90 0 0 cm /Im0 Do Q';
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 90] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1600 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  }
  objects[0]=Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');objects[1]=Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${texts.length} >>`);
  const parts=[Buffer.from('%PDF-1.4\n')],offsets=[];let length=parts[0].length;
  objects.forEach((object,index)=>{offsets.push(length);const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);length+=part.length;});
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(parts);
}
