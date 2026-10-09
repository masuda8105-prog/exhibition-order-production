import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const pdfjs=await import(pathToFileURL('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const css=await fs.readFile('styles.css','utf8');
const rows=Array.from({length:8},(_,index)=>`<tr><td>TEST-${index+1}</td><td>レンズ・フレーム検証商品 ${index+1}</td><td class="num">2</td><td class="num">¥12,000</td><td class="num">¥24,000</td></tr>`).join('');
const receipt=label=>`<article class="printSheet printPage receiptSheet"><div class="receiptCopyLabel">${label}</div><div class="receiptHeaderSimple"><div class="receiptBrandName">株式会社サンニシムラ</div><div class="receiptDocMeta"><div class="receiptDocTitle">展示会 注文書</div><div class="receiptMetaLine">注文番号 TEST-12345</div></div></div><div class="receiptInfoBand"><div class="receiptInfoCard"><div class="receiptInfoLabel">店舗名</div><div class="receiptInfoValue">検証用店舗</div></div><div class="receiptInfoCard"><div class="receiptInfoLabel">電話番号</div><div class="receiptInfoValue">000-0000-0000</div></div></div><div class="receiptSection"><div class="receiptSectionTitle">注文明細</div><table class="receiptTable"><colgroup><col class="code"><col><col class="qty"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th>品番</th><th>商品名</th><th class="num">数量</th><th class="num">単価（税抜）</th><th class="num">金額（税抜）</th></tr></thead><tbody>${rows}</tbody></table></div><div class="receiptFooterGrid"><div class="receiptNote"><b>備考</b>印刷レイアウト検証</div><div class="receiptSummaryBox"><div class="receiptSummaryRow"><span>税抜合計</span><span>¥192,000</span></div><div class="receiptSummaryRow total"><span>税込合計</span><span>¥211,200</span></div></div></div><div class="receiptFooterMini"><span>株式会社サンニシムラ</span><span>注文番号 TEST-12345</span></div></article>`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage();
  await page.setContent(`<style>${css}</style><div id="printArea" class="printArea">${receipt('お客様控え')}${receipt('会社控え')}</div><div class="receiptCaptureStage"><article class="receiptSheet captureMode"><div class="receiptInfoLabel">店舗名</div><div class="receiptInfoValue">検証用店舗</div><div class="receiptPickupSchedule">お渡し日 2099/01/02　13時以降</div><table class="receiptTable"><tr><td>商品</td></tr></table></article></div>`);
  await page.locator('#printArea .receiptInfoBand').evaluateAll(elements=>elements.forEach(element=>element.insertAdjacentHTML('afterend','<div class="receiptPickupNumber"><strong>NEO-12</strong><div class="receiptPickupSchedule">お渡し日 2099/01/02　13時以降</div></div>')));
  const captureSizes=await page.locator('.receiptCaptureStage').evaluate(element=>{
    const px=selector=>parseFloat(getComputedStyle(element.querySelector(selector)).fontSize);
    return {label:px('.receiptInfoLabel'),value:px('.receiptInfoValue'),item:px('.receiptTable'),scheduleColor:getComputedStyle(element.querySelector('.receiptPickupSchedule')).color};
  });
  assert.ok(captureSizes.label>=15&&captureSizes.value>=21&&captureSizes.item>=20,JSON.stringify(captureSizes));
  assert.equal(captureSizes.scheduleColor,'rgb(180, 35, 24)');
  await page.emulateMedia({media:'print'});
  const printSizes=await page.locator('#printArea .receiptSheet').first().evaluate(element=>{
    const px=selector=>parseFloat(getComputedStyle(element.querySelector(selector)).fontSize);
    return {label:px('.receiptInfoLabel'),value:px('.receiptInfoValue'),item:px('.receiptTable'),heading:px('.receiptTable th'),total:px('.receiptSummaryRow.total')};
  });
  assert.ok(printSizes.label>=12&&printSizes.value>=16&&printSizes.item>=16&&printSizes.heading>=13&&printSizes.total>=23,JSON.stringify(printSizes));
  const qtyColumn=await page.locator('#printArea .receiptTable').first().evaluate(table=>({display:getComputedStyle(table.querySelector('col.qty')).display,width:table.querySelector('tbody tr').cells[2].getBoundingClientRect().width}));
  assert.equal(qtyColumn.display,'table-column');assert.ok(qtyColumn.width<=60,'quantity column leaves space for product names');
  const schedule=await page.locator('#printArea .receiptPickupSchedule').first().evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor,border:getComputedStyle(element).borderTopWidth,size:parseFloat(getComputedStyle(element).fontSize),width:element.getBoundingClientRect().width,parentWidth:element.parentElement.getBoundingClientRect().width}));
  assert.equal(schedule.color,'rgb(180, 35, 24)');
  assert.equal(schedule.background,'rgb(255, 240, 238)');
  assert.equal(schedule.border,'0px');
  assert.equal(schedule.width,schedule.parentWidth-30);
  assert.ok(schedule.size>=17);
  const bytes=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true});
  const document=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  const pages=[];
  for(let index=1;index<=document.numPages;index++){
    const content=await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map(item=>item.str).join(' '));
  }
  assert.equal(pages.length,2,`Unexpected pagination: ${JSON.stringify(pages)}`);
  assert.match(pages[0],/お客様控え/);assert.match(pages[0],/税込合計/);
  assert.match(pages[1],/会社控え/);assert.match(pages[1],/税込合計/);
  await fs.mkdir('tmp/receipt-readability',{recursive:true});
  await fs.writeFile('tmp/receipt-readability/copies.pdf',bytes);
  await page.locator('#printArea .receiptSheet').first().screenshot({path:'tmp/receipt-readability/print.png'});
  // Long orders must keep their larger type and flow onto additional pages.
  await page.locator('#printArea .receiptSheet').last().evaluate(element=>element.remove());
  await page.locator('#printArea .receiptTable tbody').evaluate(element=>{const row=element.firstElementChild.outerHTML;element.innerHTML=Array.from({length:40},(_,i)=>row.replace('TEST-1',`LONG-${i+1}`)).join('');});
  const longBytes=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true});
  const longDoc=await pdfjs.getDocument({data:new Uint8Array(longBytes),useSystemFonts:true}).promise;
  assert.ok(longDoc.numPages>=2);
  let longText='';for(let i=1;i<=longDoc.numPages;i++){const content=await(await longDoc.getPage(i)).getTextContent();longText+=' '+content.items.map(item=>item.str).join(' ');}
  for(let i=1;i<=40;i++)assert.equal((longText.match(new RegExp(`LONG-${i}(?![0-9])`,'g'))||[]).length,1,`row ${i} prints once`);
  assert.match(longText,/税込合計/);
  await page.locator('#printArea .receiptTable th').evaluateAll(cells=>{['Code','Product','Qty','Unit Price (excl. tax)','Amount (excl. tax)'].forEach((text,i)=>cells[i].textContent=text);});
  const overflow=await page.locator('#printArea .receiptTable th').evaluateAll(cells=>cells.filter(cell=>cell.scrollWidth>cell.clientWidth+2).map(cell=>cell.textContent));assert.deepEqual(overflow,[],'larger English headings wrap within their columns');
  console.log('PASS: 20px image / 16px print, separate eight-item copies, long orders paginate with every row and totals');
}finally{
  await browser.close();
}
