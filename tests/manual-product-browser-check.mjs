import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8787/');
await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');await page.click('#newOrderBtn');
await page.click('#manualProduct summary');await page.click('#addManualProduct');assert.match(await page.textContent('#manualProductError'),/品番/);
await page.fill('#manual-code','CUSTOM-01');await page.fill('#manual-name','未登録商品 <テスト>');await page.fill('#manual-price','1250');await page.fill('#manual-qty','1.5');await page.click('#addManualProduct');assert.match(await page.textContent('#manualProductError'),/整数/);
await page.fill('#manual-qty','2');await page.click('#addManualProduct');assert.match(await page.textContent('#cartLines'),/CUSTOM-01 未登録商品 <テスト>/);assert.match(await page.textContent('#cartLines'),/2,500/);
await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');
await page.click('#toType');await page.click('[data-type="normal"]');await page.click('#toInfo');await page.fill('#fStore','自由入力検証');await page.fill('#fPhone','000-0000-0000');await page.selectOption('#fAccount',{label:'検証帳合A'});await page.click('#saveBtn');await page.waitForSelector('#successCustomerCopy');await page.click('#backDash');await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.fill('#orderSearch','CUSTOM-01');await page.click('[data-edit]');assert.match(await page.textContent('#cartLines'),/CUSTOM-01 未登録商品 <テスト>/);
assert.deepEqual(errors,[]);console.log('PASS: manual validation, mixed master/manual items, totals, save/reload/edit');
}finally{await browser.close()}

