import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'tmp','pdfs','exhibition-order-print-fixture.pdf');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  await page.goto(process.env.PRINT_FIXTURE_URL||'http://127.0.0.1:8767/',{waitUntil:'load'});
  await page.fill('#loginEmail','fixture@example.invalid');
  await page.fill('#loginPassword','fixture-password');
  await page.click('#loginBtn');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.waitForSelector('#newOrderBtn:enabled');
  await page.evaluate(()=>document.getElementById('newOrderBtn').click());
  await page.waitForSelector('#sheet:not(.hidden) #productQ');
  await page.fill('#productQ','TEST-001');
  await page.click('[data-product-id="product-1"]');
  await page.click('#toType');
  await page.click('[data-type="normal"]');
  await page.click('#toInfo');
  await page.fill('#fStore','架空テスト店舗');
  await page.fill('#fPhone','000-0000-0000');
  await page.selectOption('#fAccount',{label:'検証帳合A'});
  await page.fill('#fCustomer','架空担当者');
  await page.fill('#fNotes','PDFレイアウト検証');
  await page.click('#saveBtn');
  await page.waitForSelector('#successPrint');
  await page.evaluate(()=>{window.print=()=>{throw new Error('PRINT_FIXTURE_READY')}});
  await page.click('#successPrint');
  await page.waitForTimeout(100);
  const printText=await page.locator('#printArea').innerText();
  assert.match(printText,/展示会 注文書/);
  assert.match(printText,/架空テスト店舗/);
  assert.match(printText,/TEST-001/);
  assert.match(printText,/合計/);
  await fs.mkdir(path.dirname(output),{recursive:true});
  await page.emulateMedia({media:'print'});
  await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'0',right:'0',bottom:'0',left:'0'}});
  console.log(output);
}finally{
  await browser.close();
}
