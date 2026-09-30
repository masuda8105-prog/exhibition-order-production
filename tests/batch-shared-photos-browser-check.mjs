import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const base='http://127.0.0.1:8797/';
try{
  const page=await browser.newPage();
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="spot"]');await page.click('[data-handoff="hotel"]');await page.click('#toInfo');
  const store=`写真一括印刷検証 ${Date.now()}`;
  await page.fill('#fStore',store);await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','架空のお客様');await page.click('#saveBtn');await page.click('#prepareSharing');await page.waitForSelector('#photoFiles',{state:'attached'});
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;canvas.getContext('2d').fillRect(10,10,100,100);return canvas.toDataURL('image/png').split(',')[1]});
  await page.setInputFiles('#photoFiles',{name:'hotel.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.waitForFunction(()=>document.querySelector('#attachmentStatus')?.textContent?.includes('1枚添付済み'));
  await page.click('#prepareSharePdf');await page.waitForSelector('#acknowledgeSlack:enabled');await page.click('#acknowledgeSlack');await page.waitForSelector('#confirmSharedOrder:enabled');await page.click('#confirmSharedOrder');await page.waitForSelector('#successCustomerCopy');
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');
  await page.evaluate(target=>{window.__savedBatchPhoto=false;new MutationObserver(()=>{const sheets=[...document.querySelectorAll('#printArea .printSheet')];const sheet=sheets.find(item=>item.textContent.includes(target));const photo=sheet?.nextElementSibling?.querySelector('img');if(photo?.complete&&photo.naturalWidth>0&&photo.src.startsWith('data:image/'))window.__savedBatchPhoto=true}).observe(document.querySelector('#printArea'),{subtree:true,childList:true,attributes:true,attributeFilter:['src']})},store);
  await page.click('#printMenuBtn');await page.click('#executeBatchPrint');await page.waitForFunction(()=>window.__savedBatchPhoto);
  assert.equal(await page.evaluate(()=>window.__savedBatchPhoto),true);
  console.log('PASS: saved hotel-delivery photo appears immediately after its order in batch print following reload');
}finally{await browser.close()}
