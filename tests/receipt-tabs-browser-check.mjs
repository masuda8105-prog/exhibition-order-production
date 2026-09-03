import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.RECEIPT_FIXTURE_URL||'http://127.0.0.1:8784/';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const failures=[];
try{
  const staff=await browser.newContext({viewport:{width:1024,height:768}}),customer=await browser.newContext({viewport:{width:390,height:844}});
  const page=await staff.newPage(),recipient=await customer.newPage();page.on('pageerror',error=>failures.push(error.message));
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  assert.equal(await page.locator('[role="tab"]').count(),3);
  assert.deepEqual(await page.locator('[role="tab"]').allTextContents(),['要対応0','受け取り待ち0','完了0']);
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="normal"]');await page.click('#toInfo');
  await page.fill('#fStore','QR検証用の架空店舗');await page.fill('#fPhone','000-0000-0000');await page.selectOption('#fAccount',{label:'検証帳合A'});await page.fill('#fCustomer','架空のお客様');await page.fill('#fNotes','社内限定・お客様画像に出してはいけない');
  await page.click('#saveBtn');await page.waitForSelector('#successCustomerCopy');await page.click('#successCustomerCopy');await page.waitForSelector('#customerQrCode img',{timeout:30000});
  const url=await page.getAttribute('#openReceiptImage','href');
  assert.match(url,/\/storage\/v1\/object\/sign\/exhibition-receipts\/.*token=/);
  assert.ok(!url.includes('QR検証')&&!url.includes('fixture-access-token'));
  const blobUrl=await page.getAttribute('#downloadReceiptImage','href');assert.ok(blobUrl.startsWith('blob:'));
  const received=await recipient.goto(url);assert.equal(received.status(),200);assert.match(received.headers()['content-type'],/image\/png/);
  const png=await received.body();assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await fs.mkdir('tmp/ui-checks',{recursive:true});await fs.writeFile('tmp/ui-checks/customer-receipt.png',png);
  const tokenless=new URL(url);tokenless.search='';assert.equal((await customer.request.get(tokenless.href)).status(),403);
  const tampered=new URL(url);tampered.searchParams.set('token','wrong');assert.equal((await customer.request.get(tampered.href)).status(),403);
  const otherPath=new URL(url);otherPath.pathname=otherPath.pathname.replace(/\/[^/]+\.png$/,'/other.png');assert.equal((await customer.request.get(otherPath.href)).status(),403);
  assert.equal((await customer.request.post(tokenless.href,{data:{expiresIn:604800}})).status(),401);
  await page.locator('#customerQrCode').screenshot({path:'tmp/ui-checks/customer-qr.png'});
  if(process.env.QR_DECODER_PATH)await page.addScriptTag({path:process.env.QR_DECODER_PATH});
  for(const width of [1024,390,320]){
    await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`QR overflow ${width}`);
    assert.ok(await page.locator('#customerQrCode').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),`QR clipped ${width}`);
    assert.ok(await page.locator('.qrReceipt>p').first().evaluate(el=>el.getBoundingClientRect().right<=innerWidth-10),`QR instructions clipped ${width}`);
    if(process.env.QR_DECODER_PATH){const decoded=await page.evaluate(()=>{const img=document.querySelector('#customerQrCode img'),size=Math.round(img.getBoundingClientRect().width),canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.drawImage(img,0,0,size,size);return window.jsQR(context.getImageData(0,0,size,size).data,size,size)?.data});assert.equal(decoded,url,`QR decode ${width}`)}
    await page.screenshot({path:`tmp/ui-checks/qr-${width}.png`,fullPage:true});
  }
  await page.click('#qrClose');await page.click('#customerCopyBtn');await page.waitForSelector('#customerQrCode img'); // duplicate image upload stays usable
  await page.click('#qrClose');
  for(const status of ['waiting','active','done']){
    await page.selectOption('#orderStatus',status);await page.click('#saveStatus');await page.waitForFunction(s=>!document.querySelector('#orderStatus')?.disabled&&document.querySelector(`[data-tab="${s}"]`)?.getAttribute('aria-selected')==='true'&&document.querySelector('#toast').textContent===({active:'要対応',waiting:'受け取り待ち',done:'完了'}[s]+'に変更しました'),status);
    assert.equal(await page.inputValue('#orderStatus'),status);
  }
  await page.click('#detailClose');await page.click('[data-tab="active"]');assert.equal(await page.locator('.orderCard').count(),0);
  await page.fill('#orderSearch','QR検証');assert.equal(await page.locator('.orderCard').count(),1);assert.match(await page.textContent('#searchSummary'),/すべての状態/);
  await page.click('[data-tab="done"]');assert.equal(await page.inputValue('#orderSearch'),'');
  for(const width of [1024,390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/ui-checks/tabs-${width}.png`,fullPage:true})}
  await page.click('[data-detail]');await page.click('#printBtn');assert.equal(await page.locator('.orderCard').count(),1);
  await page.click('#detailClose');await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-tab="done"]');await page.click('[data-detail]');assert.equal(await page.inputValue('#orderStatus'),'done');
  assert.deepEqual(failures,[]);
  console.log('PASS: three tabs, status save/restore, cross-tab search, PNG generation, QR display, guest image access, wrong/missing token denial, image reissue, print retention, desktop/mobile layouts');
}finally{await browser.close()}
