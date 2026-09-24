import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[];
try{
const page=await browser.newPage({viewport:{width:390,height:900}});
page.on('pageerror',e=>{errors.push(e.message);console.log(e.message)});page.on('console',m=>console.log(m.text()));page.on('requestfailed',r=>console.log(r.url(),r.failure()));
await page.goto('http://127.0.0.1:8795');await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
for(const kind of ['later','hotel','ship']){
await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="spot"]');await page.click(`[data-handoff="${kind}"]`);await page.click('#toInfo');await page.fill('#fStore','PDF検証店舗');await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','検証のお客様');await page.click('#saveBtn');
if(kind!=='later')await page.click('#prepareSharing');await page.waitForSelector('#prepareSharePdf:enabled');
assert.equal(await page.locator('#acknowledgeSlack').isVisible(),false);
assert.equal(await page.locator('#prepareSharePdf').innerText(),'PDFを作成する');
if(kind==='hotel'){
const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,800);x.fillStyle='#111';x.font='32px sans-serif';x.fillText('HOTEL DELIVERY TEST',30,60);return c.toDataURL('image/png').split(',')[1]});
await page.setInputFiles('#photoFiles',{name:'hotel.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});await page.waitForSelector('.attachmentItem');await page.waitForSelector('#prepareSharePdf:enabled');
}
console.log('generating',kind);await page.click('#prepareSharePdf');try{await page.waitForSelector('#pdfOutput button',{timeout:30000})}catch(e){console.log(await page.locator('#sheetError').textContent());throw e}
assert.match(await page.locator('#pdfOutput').innerText(),kind==='hotel'?/3ページ/:/2ページ/);assert.equal(await page.locator('#acknowledgeSlack').isEnabled(),true);assert.equal(await page.locator('#confirmSharedOrder').isEnabled(),false);
for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
await page.setViewportSize({width:390,height:900});await page.locator('#pdfOutput').scrollIntoViewIfNeeded();
await fs.mkdir('tmp/pdf-ui-check',{recursive:true});await page.screenshot({path:`tmp/pdf-ui-check/${kind}.png`});
await page.evaluate(()=>{navigator.canShare=()=>true;navigator.share=async data=>{window.sharedPdf={name:data.files[0].name,type:data.files[0].type}}});await page.click('#pdfOutput button');assert.equal(await page.evaluate(()=>window.sharedPdf.type),'application/pdf');assert.equal(await page.locator('#acknowledgeSlack').isChecked(),false);await page.evaluate(()=>{navigator.canShare=()=>false});
const [download]=await Promise.all([page.waitForEvent('download'),page.click('#pdfOutput button')]);await download.saveAs(`tmp/pdf-ui-check/${kind}.pdf`);
const bytes=await fs.readFile(`tmp/pdf-ui-check/${kind}.pdf`);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
assert.equal(await page.locator('#acknowledgeSlack').isChecked(),false);
await page.click('#acknowledgeSlack');await page.waitForSelector('#confirmSharedOrder:enabled');await page.click('#confirmSharedOrder');await page.waitForSelector('#continueOrder');await page.click('#backDash');
console.log(kind+' PDF creation, download, acknowledgement, confirmation passed');
}
assert.deepEqual(errors,[]);
}finally{await browser.close()}

