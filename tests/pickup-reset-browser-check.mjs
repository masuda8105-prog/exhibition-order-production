import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PICKUP_RESET_FIXTURE_URL||'http://127.0.0.1:8796/';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:320,height:844}});
const headers={Authorization:'Bearer fixture-access-token'};
const rows=async()=>(await page.request.get(`${base}rest/v1/exhibition_app_orders`,{headers})).json();
async function issuePickup(store){
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');
  await page.click('#toType');await page.click('[data-type="spot"]');await page.click('[data-handoff="later"]');await page.click('#toInfo');
  await page.fill('#fStore',store);await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','検証のお客様');
  await page.click('#saveBtn');await page.waitForSelector('.finalizeStep .pickupNumber');
  const number=await page.locator('.finalizeStep .pickupNumber strong').textContent();
  await page.click('#finalizeClose');return number;
}
try{
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');
  await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  assert.equal(await page.locator('#pickupResetButton').isVisible(),false);
  const first=await issuePickup('リセット前の注文');assert.equal(first,'NEO-1');
  await page.locator('#pickupResetTools summary').click();await page.click('#pickupResetButton');
  assert.equal(await page.locator('#pickupResetSubmit').isEnabled(),false);
  await page.fill('#pickupResetConfirm','reset');assert.equal(await page.locator('#pickupResetSubmit').isEnabled(),false);
  await page.fill('#pickupResetConfirm','リセット');assert.equal(await page.locator('#pickupResetSubmit').isEnabled(),true);
  await page.click('#pickupResetSubmit');await page.waitForSelector('#sheet',{state:'hidden'});
  const second=await issuePickup('リセット後の注文');assert.equal(second,'NEO-1');
  const saved=await rows();
  assert.deepEqual(saved.filter(row=>row.pickup_number).map(row=>row.pickup_generation).sort(),[1,2]);
  assert.equal(saved.find(row=>row.payload.store==='リセット前の注文').pickup_number,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: hidden reset action, typed confirmation, next NEO-1, existing number retained');
}finally{await browser.close()}
