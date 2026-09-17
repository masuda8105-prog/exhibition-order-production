import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const playwright=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const engine=process.env.LAYOUT_BROWSER||'chromium',base=process.env.LAYOUT_FIXTURE_URL||'http://127.0.0.1:8792/';
const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const errors=[],writes=[];
async function addOrder(page,kind='later'){
  await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click('[data-type="spot"]');await page.click(`[data-handoff="${kind}"]`);await page.click('#toInfo');
  await page.fill('#fStore','写真添付テスト店舗');await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','架空のお客様');await page.click('#saveBtn');
  if(kind!=='later')await page.click('#prepareSharing');
  await page.waitForSelector('#choosePhotos:enabled');
}
async function photosReady(page,count){await page.waitForFunction(n=>document.querySelectorAll('.attachmentItem').length===n&&!document.querySelector('#prepareSharePdf').disabled,count)}
async function printShare(page){const before=await page.evaluate(()=>window.__PRINTS__);await page.click('#prepareSharePdf');await page.waitForFunction(n=>window.__PRINTS__===n+1&&!document.querySelector('#acknowledgeSlack').disabled,before)}
async function fixturePhoto(page,landscape){
  const url=await page.evaluate(landscape=>{
    const canvas=document.createElement('canvas');canvas.width=landscape?1800:1200;canvas.height=landscape?1200:1800;const ctx=canvas.getContext('2d');
    ctx.fillStyle=landscape?'#e6f1fc':'#fff4df';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#183b56';ctx.lineWidth=12;ctx.strokeRect(20,20,canvas.width-40,canvas.height-40);
    ctx.fillStyle='#183b56';ctx.font='bold 56px sans-serif';ctx.fillText(landscape?'LANDSCAPE PHOTO':'PORTRAIT PHOTO',70,110);ctx.font='36px sans-serif';ctx.fillText('TEST ATTACHMENT / No customer data',70,180);
    for(let i=0;i<8;i++){const y=300+i*90;ctx.strokeRect(70,y,canvas.width-140,70);ctx.fillText(`ROW ${i+1} / sample delivery form`,90,y+47)}
    for(const [x,y] of [[70,230],[canvas.width-200,230],[70,canvas.height-90],[canvas.width-200,canvas.height-90]]){ctx.fillStyle='#cf4d31';ctx.fillRect(x,y,120,40)}
    return canvas.toDataURL('image/png');
  },landscape);
  return{name:landscape?'landscape.png':'portrait.png',mimeType:'image/png',buffer:Buffer.from(url.split(',')[1],'base64')};
}
try{
  await fs.mkdir('tmp/ui-checks',{recursive:true});await fs.mkdir('tmp/pdfs',{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  await context.addInitScript(()=>{window.__PRINTS__=0;window.print=()=>{window.__PRINTS__++};window.__REVOKED__=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__REVOKED__.push(url);revoke(url)}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(['POST','PATCH','PUT'].includes(request.method()))writes.push({url:request.url(),body:request.postData()})});
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  await addOrder(page);const beforePhotos=writes.length,portrait=await fixturePhoto(page,false),landscape=await fixturePhoto(page,true);
  const [folder]=await Promise.all([page.waitForEvent('filechooser'),page.click('#choosePhotos')]);assert.equal(folder.isMultiple(),true);await folder.setFiles([portrait,landscape]);await photosReady(page,2);
  assert.equal(await page.getAttribute('#cameraPhoto','capture'),'environment');
  const [camera]=await Promise.all([page.waitForEvent('filechooser'),page.click('#takePhoto')]);assert.equal(camera.isMultiple(),false);await camera.setFiles(portrait);await photosReady(page,3);
  assert.equal(writes.length,beforePhotos,'photos must not upload to server');
  const removedUrl=await page.locator('.attachmentItem summary img').nth(2).getAttribute('src');await page.locator('[data-remove-photo]').nth(2).click();await photosReady(page,2);assert.equal(await page.evaluate(url=>window.__REVOKED__.includes(url),removedUrl),true);
  await page.setInputFiles('#photoFiles',{name:'unsupported.pdf',mimeType:'application/pdf',buffer:Buffer.from('PDF fixture')});await page.waitForFunction(()=>document.querySelector('#attachmentStatus').textContent.includes('JPEG'));assert.equal(await page.locator('.attachmentItem').count(),2);
  await page.setInputFiles('#photoFiles',{name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken fixture')});await page.waitForFunction(()=>document.querySelector('#attachmentStatus').textContent.includes('読み込めません'));assert.equal(await page.locator('.attachmentItem').count(),2);
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});await page.locator('.attachmentPicker').scrollIntoViewIfNeeded();
    const failures=await page.evaluate(()=>{
      const bad=[];if(document.documentElement.scrollWidth>innerWidth)bad.push('page overflow');
      for(const el of document.querySelectorAll('.attachmentPicker,.attachmentPicker button,.attachmentPicker img')){const r=el.getBoundingClientRect();if(r.width&&(r.left<0||r.right>innerWidth+1||el.scrollWidth>el.clientWidth+1))bad.push(el.className||el.id)}return bad;
    });assert.deepEqual(failures,[],`${engine} ${width}`);
    await page.locator('#toast.show').waitFor({state:'hidden'});await page.locator('.attachmentPicker').screenshot({path:`tmp/ui-checks/${engine}-photos-${width}.png`});
  }
  await printShare(page);assert.equal(await page.locator('#printArea .shareAttachmentPage').count(),2);
  assert.equal(await page.locator('#printArea .shareAttachmentPage img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
  assert.match(await page.textContent('#printArea .shareAttachmentPage'),/NEO-/);
  if(engine==='chromium'){
    await page.emulateMedia({media:'print'});await page.pdf({path:'tmp/pdfs/order-with-photos.pdf',format:'A4',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('.attachmentItem').count(),2);
  await page.click('#acknowledgeSlack');await page.waitForFunction(()=>!document.querySelector('#confirmSharedOrder').disabled);assert.equal(await page.isDisabled('#choosePhotos'),true);assert.equal(await page.locator('[data-remove-photo]').first().isDisabled(),true);
  await page.click('#acknowledgeSlack');await page.waitForFunction(()=>!document.querySelector('#choosePhotos').disabled);await page.locator('[data-remove-photo]').first().click();await photosReady(page,1);assert.equal(await page.isDisabled('#acknowledgeSlack'),true);
  // The cap is enforced, and changed photos require a new PDF before acknowledgement.
  await page.setInputFiles('#photoFiles',Array.from({length:6},(_,i)=>({...portrait,name:`photo-${i}.png`})));await photosReady(page,6);assert.match(await page.textContent('#attachmentStatus'),/最大6枚/);assert.equal(await page.isDisabled('#choosePhotos'),true);
  await printShare(page);assert.equal(await page.locator('#printArea .shareAttachmentPage').count(),6);await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.click('#acknowledgeSlack');await page.waitForFunction(()=>!document.querySelector('#confirmSharedOrder').disabled);await page.click('#confirmSharedOrder');await page.waitForSelector('#successCustomerCopy');
  assert.equal(writes.some(w=>/blob:|data:image|portrait\.png|landscape\.png|photo-\d\.png/.test(w.body||'')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('blob:')),false);
  // Private attachments never appear in the customer QR receipt.
  await page.click('#successCustomerCopy');await page.waitForSelector('#customerQrCode img');assert.equal(await page.locator('.shareAttachmentPage').count(),0);await page.click('#qrClose');
  await page.click('#printBtn');await page.waitForFunction(()=>document.querySelectorAll('#printArea .shareAttachmentPage').length===6);await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.click('#detailClose');
  // A new order has no pictures carried over from the previous customer.
  await addOrder(page,'hotel');assert.equal(await page.locator('.attachmentItem').count(),0);await page.setInputFiles('#photoFiles',portrait);await photosReady(page,1);
  const currentPhoto=await page.locator('.attachmentItem summary img').getAttribute('src');await page.click('#finalizeClose');page.once('dialog',dialog=>dialog.accept());await page.click('#logoutBtn');await page.waitForSelector('#loginView:not(.hidden)');assert.equal(await page.evaluate(url=>window.__REVOKED__.includes(url),currentPhoto),true);
  assert.deepEqual(errors,[]);console.log(`PASS ${engine}: gallery/camera inputs, previews/removal, invalid files, 6-photo limit, no photo uploads, PDF image readiness, acknowledgement invalidation, QR separation, new-order/logout cleanup, mobile/desktop layout`);
}finally{await browser.close()}
