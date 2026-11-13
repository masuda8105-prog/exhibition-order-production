import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';

process.argv.push('--korea','--event-picker','--keep-print','--no-listen','--port=8799');
const {handleFixture}=await import('./browser-fixture-server.mjs');

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],executablePath:process.env.CHROME_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  let imageAvailable=true;
  page.on('pageerror',error=>errors.push(error.message));
  const photo=await readFile(new URL('../assets/sun_nishimura_logo.jpg',import.meta.url));
  await page.route('http://127.0.0.1:8799/**',async route=>{
    const source=route.request(),url=new URL(source.url());
    if(!imageAvailable&&url.pathname.endsWith('/test-image.jpg'))return route.fulfill({status:404});
    const request=Object.assign(Readable.from([source.postDataBuffer()||Buffer.alloc(0)]),{
      url:url.pathname+url.search,method:source.method(),headers:await source.allHeaders(),
    });
    let status,headers;
    const response={
      writeHead(code,values){status=code;headers=values},
      end(body){return route.fulfill({status,headers,body})},
    };
    await handleFixture(request,response);
  });
  await page.addInitScript(()=>{window.print=()=>{window.printed=document.getElementById('printArea').innerHTML}});
  await page.goto('http://127.0.0.1:8799/');
  await page.fill('#loginEmail','fixture@example.invalid');
  await page.fill('#loginPassword','fixture-password');
  await page.click('#loginBtn');
  await page.click('[data-event-id="korea_exhibition"]');
  assert.equal(await page.locator('#tabs').isVisible(),false);
  assert.equal(await page.locator('#pickupResetTools').isVisible(),false);
  await page.click('#newOrderBtn');
  assert.equal(await page.locator('#koreaPriceTier').inputValue(),'1.7');
  await page.fill('#productQ','TEST-001');
  await page.waitForFunction(()=>document.querySelector('.productThumbnail')?.naturalWidth>0);
  assert.match(await page.locator('#productResults').innerText(),/테스트 상품.*17,000\.5원/);
  await page.click('[data-show-price="kr-TEST-001"]');
  const priceDisplay=page.locator('#koreaPriceDisplay');
  await priceDisplay.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#koreaPriceDisplay img')?.naturalWidth>0);
  assert.match(await priceDisplay.locator('.koreaPriceDisplayAmount').innerText(),/17,000\.5원/);
  await page.keyboard.press('Escape');
  await priceDisplay.waitFor({state:'hidden'});
  assert.equal(await page.locator('#toType').isEnabled(),false);
  await page.click('[data-product-id="kr-TEST-001"]');
  await page.selectOption('#koreaPriceTier','1.65');
  assert.match(await page.locator('#productResults').innerText(),/16,500원/);
  assert.match(await page.locator('#cartLines').innerText(),/16,500원/);
  await page.click('[data-show-price="kr-TEST-001"]');
  assert.match(await priceDisplay.locator('.koreaPriceDisplayAmount').innerText(),/16,500원/);
  await priceDisplay.getByRole('button',{name:'닫기'}).click();
  await page.click('#toType');
  assert.equal(await page.locator('#sheetTitle').innerText(),'お客様情報');
  assert.equal(await page.locator('[data-type]').count(),0);
  assert.equal(await page.locator('#fPhone').inputValue(),'');
  const save=page.waitForResponse(response=>response.url().endsWith('/rest/v1/exhibition_app_orders')&&response.request().method()==='POST');
  await page.click('#saveBtn');
  const [saved]=await (await save).json();
  assert.equal(saved.event_name,'korea_exhibition');
  assert.equal(saved.payload.market,'KR');
  assert.equal(saved.payload.type,'normal');
  assert.equal(saved.payload.customer,'');
  assert.equal(saved.payload.phone,'');
  assert.equal(saved.payload.priceTier,'1.65');
  assert.equal(saved.payload.items[0].price,16500);
  await page.click('#successOfficePhotos');
  await page.setInputFiles('#officeCameraPhoto',{name:'business-card.jpg',mimeType:'image/jpeg',buffer:photo});
  await page.waitForSelector('.attachmentItem');
  await page.click('#officePhotoBack');
  assert.equal(await page.locator('#orderStatus').count(),0);
  await page.click('#printBtn');
  await page.waitForFunction(()=>Boolean(window.printed));
  const company=await page.evaluate(()=>window.printed);
  assert.match(company,/회사 보관용.*회사 보관용 · 첨부 자료/s);
  assert.match(company,/KY-S Corporation\./);
  assert.match(company,/\+82-2-3789-2440/);
  assert.match(company,/\+82-2-3789-2441/);
  assert.match(company,/16,500원/);
  assert.doesNotMatch(company,/¥|消費税/);
  await page.evaluate(()=>{
    const capture=window.html2canvas;
    window.html2canvas=(node,...args)=>{
      window.qrDocument=node.innerHTML;
      const image=node.querySelector('.receiptItemCode .receiptProductThumbnail');
      window.qrThumbnail=image&&{code:image.previousElementSibling.textContent,width:image.width,decoded:image.naturalWidth};
      return capture(node,...args);
    };
  });
  await page.click('#customerCopyBtn');
  await page.waitForSelector('#customerQrCode');
  assert.match(await page.locator('.qrReceipt').innerText(),/주문 번호/);
  assert.doesNotMatch(await page.locator('.qrReceipt').innerText(),/お客様|控え|保存/);
  const qrDocument=await page.evaluate(()=>window.qrDocument);
  assert.match(qrDocument,/고객 보관용/);
  assert.match(qrDocument,/KY-S Corporation\./);
  assert.doesNotMatch(qrDocument,/첨부 자료|담당자/);
  const contentType=await page.locator('#openReceiptImage').evaluate(async link=>(await fetch(link.href)).headers.get('content-type'));
  assert.equal(contentType,'image/png');
  assert.deepEqual(await page.evaluate(()=>window.qrThumbnail),{code:'TEST-001',width:32,decoded:64});
  await page.click('#qrClose');
  imageAvailable=false;
  await page.click('#customerCopyBtn');
  await page.waitForSelector('#customerQrCode');
  assert.equal(await page.evaluate(()=>window.qrThumbnail),null);
  imageAvailable=true;
  await page.click('#qrClose');
  await page.click('#detailClose');
  await page.click('[data-edit]');
  assert.equal(await page.locator('#koreaPriceTier').inputValue(),'1.65');
  assert.match(await page.locator('#cartLines').innerText(),/16,500원/);
  await page.click('#closeSheet');
  await page.click('#newOrderBtn');
  assert.equal(await page.locator('#koreaPriceTier').inputValue(),'1.7');
  await page.fill('#productQ','TEST-001');
  await page.click('[data-product-id="kr-TEST-001"]');
  await page.click('#toType');
  await page.click('#saveBtn');
  await page.click('#backDash');
  await page.click('#changeExhibition');
  await page.click('[data-event-id="neo_2026"]');
  await page.click('#newOrderBtn');
  await page.fill('#productQ','TEST-001');
  assert.match(await page.locator('#productResults').innerText(),/検証商品A.*¥100/);
  assert.equal(await page.locator('[data-show-price]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Korea catalog, optional fields, business card, company print, signed QR PNG and domestic switch');
}finally{
  await browser.close();
}
