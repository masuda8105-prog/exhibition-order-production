import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.SYNC_FIXTURE_URL||'http://127.0.0.1:8782/';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const failures=[];
async function login(page){await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)')}
async function edit(page,note){await page.click('[data-detail]');await page.click('#editOrderBtn');await page.click('#toType');await page.click('#toInfo');await page.fill('#fNotes',note)}
try{
  const a=await browser.newContext({viewport:{width:1024,height:768}}),b=await browser.newContext({viewport:{width:390,height:844}});
  const page=await a.newPage(),other=await b.newPage();
  page.on('pageerror',error=>failures.push(error.message));other.on('pageerror',error=>failures.push(error.message));
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','wrong-password');await page.click('#loginBtn');await page.waitForFunction(()=>document.querySelector('#loginMsg').textContent.includes('ログインできません'));
  await login(page);
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="normal"]');await page.click('#toInfo');
  await page.fill('#fStore','同期確認用の架空店舗');await page.fill('#fPhone','000-0000-0000');await page.selectOption('#fAccount',{label:'検証帳合A'});await page.fill('#fCustomer','架空担当');await page.fill('#fNotes','初回');
  await a.setOffline(true);await page.click('#saveBtn');await page.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('まだ保存できていません'));assert.equal(await page.inputValue('#fStore'),'同期確認用の架空店舗');await a.setOffline(false);
  await page.route('**/rest/v1/exhibition_app_orders',async route=>{const response=await route.fetch();if(response.status()===201)await route.abort('connectionreset');else await route.fulfill({response})},{times:1});
  await page.click('#saveBtn');await page.waitForFunction(()=>document.querySelector('#saveBtn')?.disabled===false);
  await page.fill('#fNotes','通信が途切れた後の修正');
  await page.click('#saveBtn');await page.waitForSelector('#successPrint');await page.click('#successPrint');await page.click('#backDash');assert.equal(await page.locator('.orderCard').count(),1);
  await page.click('[data-detail]');assert.ok((await page.locator('#sheetBody').innerText()).includes('通信が途切れた後の修正'));await page.click('#detailClose');
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.waitForSelector('.orderCard');
  assert.equal(await page.locator('#loginView').isVisible(),false);
  const storageKeys=await page.evaluate(()=>Object.keys(localStorage));assert.ok(storageKeys.includes('exhibitionOps.session.v3'));assert.ok(!storageKeys.some(key=>key.includes('orders')));
  await page.evaluate(()=>{const key='exhibitionOps.session.v3',session=JSON.parse(localStorage.getItem(key));session.expires_at=1;localStorage.setItem(key,JSON.stringify(session))});await page.reload();await page.waitForSelector('#appView:not(.hidden)');
  const reopened=await a.newPage();await reopened.goto(base);await reopened.waitForSelector('#appView:not(.hidden)');await reopened.waitForSelector('.orderCard');await reopened.close();
  await login(other);await other.waitForSelector('.orderCard');
  const apiHeaders={Authorization:'Bearer fixture-access-token'},savedRows=await (await page.request.get(`${base}rest/v1/exhibition_app_orders`,{headers:apiHeaders})).json();
  await page.request.patch(`${base}rest/v1/exhibition_app_orders?id=eq.${savedRows[0].id}`,{headers:apiHeaders,data:{payload:{...savedRows[0].payload,staff:'別の担当（架空）'}}});
  for(const activePage of [page,other]){await activePage.click('#refreshBtn');await activePage.waitForFunction(()=>!document.querySelector('#refreshBtn').disabled)}
  await edit(page,'端末Aの変更');await edit(other,'端末Bの古い変更');
  assert.equal(await page.inputValue('#fStaff'),'別の担当（架空）');
  await page.click('#saveBtn');await page.waitForSelector('#sheet',{state:'hidden'});
  await other.click('#saveBtn');await other.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('別の端末で更新'));
  await other.click('#closeSheet');await other.click('[data-detail]');assert.ok((await other.locator('#sheetBody').innerText()).includes('端末Aの変更'));await other.click('#detailClose');
  await fs.mkdir('tmp/ui-checks',{recursive:true});
  for(const width of [1024,390,320]){
    await page.setViewportSize({width,height:width===1024?768:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
    const body=await page.locator('body').innerText();assert.ok(!/本社未共有|受取待ち|未会計/.test(body));
    await page.screenshot({path:`tmp/ui-checks/orders-${width}.png`,fullPage:true});
  }
  await page.click('[data-detail]');await page.click('#printBtn');assert.equal(await page.locator('.orderCard').count(),1);await page.click('#detailClose');
  await other.click('[data-detail]');other.once('dialog',dialog=>dialog.accept());await other.click('#deleteBtn');await other.waitForSelector('#sheet',{state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('.orderCard').length===0,{},{timeout:20000});
  await page.click('#logoutBtn');await page.waitForSelector('#loginView:not(.hidden)');assert.equal(await page.evaluate(()=>localStorage.getItem('exhibitionOps.session.v3')),null);
  assert.deepEqual(failures,[]);
  console.log('PASS: login persistence, token refresh, cloud save, offline retry, lost-response retry without duplicates, preserve staff, reopen, cross-device automatic sync, conflict protection, print retention, soft-hide sync, logout, 1024/390/320 layouts');
}finally{await browser.close()}
