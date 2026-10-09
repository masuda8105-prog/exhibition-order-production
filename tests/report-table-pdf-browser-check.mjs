import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({acceptDownloads:true});
  await page.route('**/rest/v1/exhibition_app_orders?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'table-test',created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',confirmation_state:'confirmed',payload:{confirmationState:'confirmed',items:Array.from({length:45},(_,i)=>({code:String(1000+i),name:i%3===0?'名称が長い商品・左右の位置を確認するための検証名称'.repeat(3):'短い商品名',qty:i+1,price:1000+i*500}))}}])}));
  await page.route('**/rest/v1/reports?**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await page.goto('http://127.0.0.1:8794/');await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-screen="sales"]');await page.waitForSelector('.reportTable');assert.equal(await page.locator('.reportTable tbody tr').count(),45,'売上タブは全商品を表示する');await page.click('[data-screen="reports"]');await page.waitForSelector('#exhibitionReport');assert.equal(await page.locator('.reportTable tbody tr').count(),10,'レポートだけTOP10');
  await page.evaluate(()=>{
    window.__reportTableMeasurements=[];window.__reportPdfPages=[];const original=window.html2canvas;
    window.html2canvas=async(node,options)=>{window.__reportPdfPages.push({summary:!!node.querySelector('.reportSummary'),feedback:node.textContent.includes('4. 商品別フィードバック'),heading:node.querySelector('h2')?.textContent});for(const table of node.querySelectorAll('.reportTable'))window.__reportTableMeasurements.push({headers:table.querySelectorAll('thead').length,head:[...table.querySelectorAll('thead th')].map(cell=>cell.getBoundingClientRect().x),rows:[...table.querySelectorAll('tbody tr')].map(row=>[...row.cells].map(cell=>cell.getBoundingClientRect().x)),bottom:table.getBoundingClientRect().bottom-node.getBoundingClientRect().top});return original(node,options);};
  });
  const download=page.waitForEvent('download');await page.click('#reportPdf');await download;
  const tables=await page.evaluate(()=>window.__reportTableMeasurements);
  assert.equal(tables.length,1,'TOP10を1ページに収める');assert.ok(tables[0].bottom<=1068);
  const pages=await page.evaluate(()=>window.__reportPdfPages);assert.equal(pages[0].summary,true);assert.equal(pages[0].feedback,false);assert.equal(pages[1].feedback,true);
  assert.equal(pages.length,2,'短い会場・運営と次回課題はフィードバックと同じページに収める');
  assert.equal(tables.reduce((sum,table)=>sum+table.rows.length,0),10,'数量上位10商品だけが1回ずつ掲載される');
  for(const table of tables){assert.equal(table.headers,1);for(const row of table.rows){assert.equal(row.length,3);for(let i=0;i<3;i++)assert.ok(Math.abs(row[i]-table.head[i])<1,'先頭行を含めて列が見出しと一致する');}}
  for(const table of tables)assert.deepEqual(table.head,tables[0].head,'改ページ後も同じ列位置');
  console.log('PASS: sales shows all 45 products, report shows quantity top 10, summary fits page 1, feedback starts page 2, first-row/header alignment, no missing or duplicated rows');
}finally{await browser.close();}
