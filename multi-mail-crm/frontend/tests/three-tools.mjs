import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base=process.env.WORKSPACE_BASE_URL||'http://localhost:3000';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:process.env.CI?['--no-sandbox']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(base+'/crm');
 await page.locator('.suite-tabs a[href="/mail-crm/"]').waitFor();
 assert.equal(await page.locator('.suite-tabs a').count(),3);
 const source=await page.request.get(base+'/theme.js');assert.equal(source.headers()['x-tool-navigation'],'added');
 await page.locator('.suite-tabs a[href="/mail-crm/"]').click();
 await page.locator('.tool-navigation a[aria-current="page"]').waitFor();
 await page.locator('.connection.online').waitFor();
 assert.equal(await page.getByRole('button',{name:'Войти',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Выйти',exact:true}).count(),0);
 const profile=await page.request.get(base+'/mail-crm/api/workspace');assert.equal(profile.status(),200);assert.equal(profile.headers()['set-cookie'],undefined);
 assert.equal((await profile.json()).email,'workspace@crm.invalid');
 assert.equal(await page.locator('.tool-navigation a').count(),3);
 await page.locator('.tool-navigation a[href="/assistant/"]').click();
 await page.locator('#workspace').waitFor({state:'visible'});
 assert.equal(await page.locator('.workspace-tabs a').count(),3);
 const me=await page.request.get(base+'/assistant/api/me');assert.equal(me.status(),200);assert.equal((await me.json()).sharedWorkspace,true);
 const downloadEvent=page.waitForEvent('download');await page.locator('.extension-download').click();const download=await downloadEvent;
 assert.equal(download.suggestedFilename(),'registration-assistant-extension-0.5.1.zip');
 const content=readFileSync(await download.path());const expected=readFileSync(new URL('../../integration/tools/registration-assistant/public/downloads/registration-assistant-extension-0.5.1.zip',import.meta.url));
 assert.equal(createHash('sha256').update(content).digest('hex'),createHash('sha256').update(expected).digest('hex'));
 await page.locator('.workspace-tabs a[href="/mail-crm/"]').click();
 await page.locator('.connection.online').waitFor();
 await page.locator('.tool-navigation a[href="/crm"]').click();await page.locator('.suite-tabs a[href="/mail-crm/"]').waitFor();
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(JSON.stringify({threeTabs:true,scoutToCRM:true,CRMToAssistant:true,assistantToCRM:true,CRMToScout:true,noCRMLogin:true,noSessionCookie:true,prefixedAPI:true,realWebSocket:true,assistantExtensionByteIdentical:true,pageErrors:0}));
}finally{await browser.close();}
