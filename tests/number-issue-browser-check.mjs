import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const playwright=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const engine=process.env.LAYOUT_BROWSER||'chromium';
const base=process.env.LAYOUT_FIXTURE_URL||'http://127.0.0.1:8790/';
const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const headers={Authorization:'Bearer fixture-access-token'},errors=[];
const rows=async page=>(await page.request.get(`${base}rest/v1/exhibition_app_orders`,{headers})).json();
async function login(page){await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)')}
async function input(page,kind){
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click(`[data-type="${kind==='normal'?'normal':'spot'}"]`);
  if(kind!=='normal')await page.click(`[data-handoff="${kind}"]`);
  await page.click('#toInfo');
  await page.fill('#fStore',`番号発行テスト-${kind}`);await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','架空のお客様');
  if(kind==='normal')await page.selectOption('#fAccount',{label:'検証帳合A'});
}
async function checkLayout(page,stage){
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    const bad=await page.evaluate(()=>{
      const panel=document.querySelector('.sheetPanel'),out=[];
      if(document.documentElement.scrollWidth>innerWidth||panel.scrollWidth>panel.clientWidth+1)out.push('horizontal overflow');
      for(const el of panel.querySelectorAll('input,button,select,.pickupNumber,.finalizeStep')){
        const rect=el.getBoundingClientRect();if(!rect.width||!rect.height)continue;
        if(rect.left<0||rect.right>innerWidth+1||el.scrollWidth>el.clientWidth+1)out.push(el.id||el.className);
      }
      const issue=document.querySelector('.issueNumberActions .primary');
      if(issue){const range=document.createRange();range.selectNodeContents(issue);if(range.getClientRects().length!==1||issue.getBoundingClientRect().height<48)out.push('issue button dimensions')}
      return out;
    });
    assert.deepEqual(bad,[],`${engine} ${stage} ${width}`);
    if(width===320||width===1280){await page.locator(stage==='input'?'.issueNumberActions':'.finalizeStep').first().scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/ui-checks/${engine}-number-${stage}-${width}.png`})}
  }
}
async function finishShared(page){
  assert.equal(await page.isDisabled('#confirmSharedOrder'),true);
  await page.click('#prepareSharePdf');await page.waitForFunction(()=>!document.querySelector('#acknowledgeSlack').disabled);
  assert.equal(await page.isDisabled('#confirmSharedOrder'),true);
  assert.doesNotMatch(await page.textContent('#printArea'),/未確定|登録前/);
  await page.click('#acknowledgeSlack');await page.waitForFunction(()=>!document.querySelector('#confirmSharedOrder').disabled);
  await page.click('#confirmSharedOrder');await page.waitForSelector('#successCustomerCopy');
}
try{
  await fs.mkdir('tmp/ui-checks',{recursive:true});
  const a=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'}),b=await browser.newContext();
  await a.addInitScript(()=>{window.print=()=>{window.__PRINT_COUNT__=(window.__PRINT_COUNT__||0)+1}});
  await b.addInitScript(()=>{window.print=()=>{}});
  const page=await a.newPage(),other=await b.newPage();
  for(const p of [page,other])p.on('pageerror',error=>errors.push(error.message));
  await login(page);await login(other);
  await input(page,'later');assert.equal(await page.textContent('#saveBtn'),'お渡し番号を発行');
  await page.fill('#fPickup','');await page.click('#saveBtn');assert.equal((await rows(page)).length,0);assert.match(await page.textContent('#sheetError'),/受取予定日/);
  await page.click('[data-day="1"]');await checkLayout(page,'input');
  await page.route('**/rest/v1/exhibition_app_orders',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_offline"}'}):route.continue());
  await page.click('#saveBtn');await page.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('保存結果を確認できません'));
  assert.equal((await rows(page)).length,0);assert.equal(await page.isDisabled('#prepareSharing'),false);
  assert.equal(await page.locator('.finalizeStep .pickupNumber').count(),0);await page.unroute('**/rest/v1/exhibition_app_orders');
  let inserts=0;const count=request=>{if(request.method()==='POST'&&request.url().endsWith('/exhibition_app_orders'))inserts++};page.on('request',count);
  await page.locator('#prepareSharing').evaluate(button=>{button.click();button.click()});await page.waitForSelector('.finalizeStep .pickupNumber');page.off('request',count);assert.equal(inserts,1);
  let first=(await rows(page))[0];const number=`NEO-${first.pickup_number}`;assert.equal(first.confirmation_state,'draft');assert.equal(await page.textContent('#orderCount'),'0件');
  assert.match(await page.textContent('.finalizeStep .pickupNumber'),new RegExp(number));await checkLayout(page,'issued');
  // Closing, a new browser and editing reuse the saved number.
  await page.click('#finalizeClose');await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.click(`[data-detail="${first.id}"]`);assert.match(await page.textContent('.finalizeStep .pickupNumber'),new RegExp(number));
  await other.click('#refreshBtn');await other.waitForFunction(()=>!document.querySelector('#refreshBtn').disabled);await other.click(`[data-detail="${first.id}"]`);assert.match(await other.textContent('.finalizeStep .pickupNumber'),new RegExp(number));await other.click('#finalizeClose');
  await page.click('#finalizeEdit');await page.click('[data-day="2"]');await page.fill('#fNotes','修正後も同じ番号');assert.equal(await page.textContent('#saveBtn'),'同じ番号で保存して進む');
  await page.click('#saveBtn');await page.waitForSelector('.finalizeStep .pickupNumber');assert.equal((await rows(page))[0].pickup_number,first.pickup_number);
  await finishShared(page);assert.match(await page.textContent('.success'),/受け取り待ち/);assert.match(await page.textContent('#printArea'),new RegExp(number));
  await page.click('#successCustomerCopy');await page.waitForSelector('#customerQrCode img');assert.match(await page.textContent('.qrReceipt .pickupNumber'),new RegExp(number));
  const receiptUrl=await page.getAttribute('#openReceiptImage','href');assert.equal((await page.request.get(receiptUrl)).status(),200);
  await page.click('#qrClose');await page.click('#detailClose');
  // A different device issues the next unique number with a single input-screen click.
  await input(other,'later');await other.click('[data-day="2"]');await other.click('#saveBtn');await other.waitForSelector('.finalizeStep .pickupNumber');
  const second=(await rows(other)).find(row=>row.id!==first.id);assert.notEqual(second.pickup_number,first.pickup_number);assert.equal(second.confirmation_state,'draft');await other.click('#finalizeClose');
  // Existing ordinary / immediate / delivery paths still work; only pickup issues a number.
  for(const kind of ['normal','now','hotel','ship']){
    await input(page,kind);assert.doesNotMatch(await page.textContent('#saveBtn'),/番号/);await page.click('#saveBtn');
    if(['hotel','ship'].includes(kind)){await page.click('#prepareSharing');await page.waitForFunction(()=>!document.querySelector('#prepareSharePdf').disabled);await finishShared(page)}
    else await page.waitForSelector('#successCustomerCopy');
    assert.match(await page.textContent('.success'),/完了/);await page.click('#backDash');
  }
  const all=await rows(page);assert.equal(all.length,6);assert.equal(all.filter(row=>row.pickup_number).length,2);assert.equal(all.filter(row=>row.confirmation_state==='confirmed').length,5);
  await page.click('#printMenuBtn');assert.match(await page.textContent('#sheetBody'),/5件/);await page.click('#executeBatchPrint');assert.equal(await page.locator('#printArea .printSheet').count(),5);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${engine}: number issue from input, validation, retry/duplicate guard, stable number after reload/edit, cross-device unique numbers, PDF/QR, 4 widths and all 5 order types`);
}finally{await browser.close()}
