import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:8786/');
  await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');
  await page.click('#toType');await page.click('[data-type="normal"]');await page.click('#toInfo');
  await page.fill('#fStore','操作ボタン検証店舗');await page.fill('#fPhone','000-0000-0000');
  await page.selectOption('#fAccount',{label:'検証帳合A'});await page.fill('#fCustomer','検証のお客様');
  await page.click('#saveBtn');await page.waitForSelector('#successCustomerCopy');await page.click('#backDash');
  await page.fill('#orderSearch','操作ボタン検証店舗');
  const statuses=['done','waiting','active'];
  for(const [index,status] of statuses.entries()){
    await page.fill('#orderSearch','操作ボタン検証店舗');
    const actions=page.locator('.orderCard .orderQuickActions');
    await actions.waitFor();
    assert.deepEqual(await actions.locator('button').allTextContents(),['詳細・印刷','修正','削除']);
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});
      assert.ok(await actions.evaluate(element=>element.getBoundingClientRect().right<=innerWidth),`actions overflow at ${width}px`);
    }
    if(index<statuses.length-1){
      const next=statuses[index+1];
      await page.click('[data-detail]');await page.selectOption('#orderStatus',next);await page.click('#saveStatus');
      await page.waitForFunction(value=>document.querySelector('#orderStatus')?.value===value&&document.querySelector('#saveStatus')?.disabled,next);
      await page.click('#detailClose');
    }
  }
  await page.click('[data-edit]');assert.match(await page.textContent('#sheetTitle'),/注文を修正/);
  await page.click('#toType');await page.click('#toInfo');await page.fill('#fNotes','カードから修正');await page.click('#saveBtn');
  await page.waitForSelector('#sheet',{state:'hidden'});await page.fill('#orderSearch','操作ボタン検証店舗');await page.click('[data-detail]');assert.match(await page.textContent('#sheetBody'),/カードから修正/);await page.click('#detailClose');
  page.once('dialog',dialog=>dialog.accept());await page.click('[data-delete]');
  await page.waitForSelector('.orderCard',{state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS: quick actions in all three tabs, edit, confirmed delete, mobile widths');
}finally{await browser.close()}
