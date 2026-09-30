import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8797/');await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="spot"]');await page.click('[data-handoff="later"]');await page.click('#toInfo');
  const store=`税込表示検証 ${Date.now()}`;
  await page.fill('#fStore',store);await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','架空のお客様');
  await page.click('[data-day="1"]');
  const confirmation=page.locator('#sheetBody .section').filter({has:page.locator('.sectionTitle:has-text("注文確認")')});
  assert.match(await confirmation.textContent(),/税抜合計/);assert.match(await confirmation.textContent(),/税込合計（お会計金額）/);
  await page.click('#saveBtn');await page.waitForSelector('#prepareSharePdf:enabled');await page.click('#prepareSharePdf');await page.waitForSelector('#acknowledgeSlack:enabled');await page.click('#acknowledgeSlack');await page.waitForSelector('#confirmSharedOrder:enabled');await page.click('#confirmSharedOrder');await page.waitForSelector('#successCustomerCopy');
  await page.click('#backDash');await page.click('[data-tab="waiting"]');
  const card=page.locator('.orderCard').filter({hasText:store});
  assert.match(await card.textContent(),/税抜/);assert.match(await card.textContent(),/税込/);
  await page.setViewportSize({width:320,height:568});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await card.locator('[data-payment]').click();
  assert.match(await page.locator('#sheetBody').textContent(),/税抜合計/);
  assert.match(await page.locator('#sheetBody').textContent(),/税込合計（お会計金額）/);
  console.log('PASS: order confirmation, waiting card, and payment screen show tax-exclusive and tax-inclusive amounts');
}finally{await browser.close()}
