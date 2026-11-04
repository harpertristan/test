import mammoth from 'mammoth';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extname} from 'node:path';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createWorker} from 'tesseract.js';
import eng from '@tesseract.js-data/eng';
import rus from '@tesseract.js-data/rus';
import {createCanvas,loadImage} from '@napi-rs/canvas';

export async function extract(buffer, filename) {
  let ocr,langDir;
  const recognize = async image => {
    if(!ocr){
      langDir=mkdtempSync(join(tmpdir(),'assistant-ocr-'));
      for(const language of [eng,rus])copyFileSync(join(language.langPath,language.code+'.traineddata.gz'),join(langDir,language.code+'.traineddata.gz'));
      ocr=await createWorker('eng+rus',1,{langPath:langDir,cacheMethod:'none',gzip:true});
    }
    const result = await ocr.recognize(image);
    return result.data.text.slice(0,30000);
  };
  const extension = extname(filename).toLowerCase();
  try {
  if (extension === '.txt') return [{page:1,text:buffer.toString('utf8').replace(/\u0000/g,'').slice(0,200000)}];
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({buffer});
    return [{page:1,text:result.value.slice(0,200000)}];
  }
  if (extension === '.pdf') {
    const standardFontDataUrl=join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),'standard_fonts')+'/';
    const task = getDocument({data:new Uint8Array(buffer),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,standardFontDataUrl});
    let pdf;
    try {
      pdf = await task.promise;
      if(pdf.numPages > 60) throw new Error('Не более 60 страниц в одном PDF. Разделите документ.');
      const pages = [];
      let scanned=0;
      for(let page = 1; page <= pdf.numPages; page++) {
        const pdfPage=await pdf.getPage(page);
        const content = await pdfPage.getTextContent();
        let text=content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').slice(0,30000);
        if(text.trim().length<20) {
          if(++scanned>8)throw new Error('В одном PDF допускается до 8 сканированных страниц. Разделите документ.');
          const viewport=pdfPage.getViewport({scale:2});
          if(viewport.width*viewport.height>10000000)throw new Error('Слишком крупная страница скана. Уменьшите разрешение.');
          const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          text=await recognize(canvas.toBuffer('image/png'));
        }
        pages.push({page,text});pdfPage.cleanup();
      }
      return pages;
    } finally {await task.destroy();}
  }
  if(['.png','.jpg','.jpeg'].includes(extension)) {
    const image=await loadImage(buffer);
    if(image.width*image.height>16000000)throw new Error('Фото должно содержать не более 16 мегапикселей. Уменьшите разрешение.');
    return [{page:1,text:await recognize(buffer)}];
  }
  throw new Error('Поддерживаются PDF, DOCX, TXT, PNG и JPG.');
  } finally {if(ocr)await ocr.terminate();if(langDir)rmSync(langDir,{recursive:true,force:true});}
}
