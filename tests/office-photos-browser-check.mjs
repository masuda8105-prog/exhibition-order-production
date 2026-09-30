import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const base='http://127.0.0.1:8797/';
async function login(page){await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)')}
try{
  const first=await browser.newContext({viewport:{width:390,height:900}}),second=await browser.newContext({viewport:{width:390,height:900}});
  const phone=await first.newPage(),office=await second.newPage();
  await login(phone);
  await phone.click('#newOrderBtn');await phone.fill('#productQ','TEST-001');await phone.click('[data-product-id="product-1"]');await phone.click('#toType');await phone.click('[data-type="normal"]');await phone.click('#toInfo');
  await phone.fill('#fStore','写真付き通常注文');await phone.fill('#fPhone','000-0000-0000');await phone.selectOption('#fAccount',{label:'検証帳合A'});await phone.fill('#fCustomer','検証のお客様');await phone.click('#saveBtn');
  await phone.waitForSelector('#successOfficePhotos');await phone.click('#successOfficePhotos');await phone.waitForSelector('#officePhotoFiles',{state:'attached'});
  const image=await phone.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,800,600);ctx.fillStyle='#111';ctx.font='bold 48px sans-serif';ctx.fillText('OFFICE PHOTO',70,100);return canvas.toDataURL('image/png').split(',')[1]});
  await phone.setInputFiles('#officePhotoFiles',{name:'office.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await phone.waitForFunction(()=>document.querySelector('#officePhotoStatus')?.textContent?.includes('1枚保存済み'));
  assert.equal(await phone.locator('.attachmentItem').count(),1);
  await login(office);await office.click('[data-tab="done"]');await office.click('[data-detail]');await office.click('#manageOfficePhotos');await office.waitForFunction(()=>document.querySelector('#officePhotoStatus')?.textContent?.includes('1枚保存済み'));
  const [download]=await Promise.all([office.waitForEvent('download'),office.click('#officePhotoPdf')]);
  await fs.mkdir('tmp/office-photos',{recursive:true});await download.saveAs('tmp/office-photos/normal-order.pdf');
  assert.equal((await fs.readFile('tmp/office-photos/normal-order.pdf')).subarray(0,5).toString(),'%PDF-');
  await office.click('#officePhotoBack');await office.evaluate(()=>{window.__officePrintHasAttachment=false;new MutationObserver(()=>{if(document.querySelectorAll('#printArea .shareAttachmentPage').length===1&&document.querySelectorAll('#printArea .printSheet').length===1)window.__officePrintHasAttachment=true}).observe(document.querySelector('#printArea'),{childList:true})});await office.click('#printBtn');await office.waitForFunction(()=>window.__officePrintHasAttachment===true);
  await office.reload();await office.waitForSelector('#appView:not(.hidden)');await office.click('[data-tab="done"]');await office.click('[data-detail]');await office.click('#manageOfficePhotos');await office.waitForFunction(()=>document.querySelector('#officePhotoStatus')?.textContent?.includes('1枚保存済み'));
  assert.equal(await office.locator('.attachmentItem').count(),1);
  assert.equal(await office.getAttribute('#officeCameraPhoto','capture'),'environment');
  office.once('dialog',dialog=>dialog.accept());await office.click('[data-remove-office-photo]');await office.waitForFunction(()=>document.querySelector('#officePhotoStatus')?.textContent?.includes('0枚保存済み'));
  await phone.click('#officePhotoBack');await phone.click('#detailClose');await phone.click('[data-tab="done"]');await phone.click('[data-detail]');await phone.click('#manageOfficePhotos');await phone.waitForFunction(()=>document.querySelector('#officePhotoStatus')?.textContent?.includes('0枚保存済み'));
  await phone.click('#officePhotoBack');await phone.click('#detailClose');await phone.click('#newOrderBtn');await phone.fill('#productQ','TEST-001');await phone.click('[data-product-id="product-1"]');await phone.click('#toType');await phone.click('[data-type="spot"]');await phone.click('[data-handoff="now"]');await phone.click('#toInfo');await phone.fill('#fStore','その場渡し店舗');await phone.fill('#fPhone','000-0000-0000');await phone.fill('#fCustomer','その場のお客様');await phone.click('#saveBtn');await phone.waitForSelector('#successOfficePhotos');
  console.log('PASS: normal and immediate-sale photos, private cloud persistence across devices, office PDF, native print, reload, deletion');
}finally{await browser.close()}

