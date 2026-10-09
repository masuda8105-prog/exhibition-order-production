import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const base='http://127.0.0.1:8793';
const saved=[],events=[{id:'neo_2026',name:'検証用展示会',order_event_name:'検証用展示会',participants:['検証スタッフ'],venue:'架空会場',start_date:'2026-10-07',end_date:'2026-10-08'},{id:'jex_2026',name:'JEX 2026',order_event_name:'JEX 2026',participants:[],venue:''}];
let loseResponse=true;
const errors=[];
try{
  await fs.mkdir('tmp/report-checks',{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  await context.route('**/rest/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').at(-1);
    const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(table==='exhibitions')return respond(events);
    if(table==='exhibition_products')return respond([{exhibition_id:'neo_2026',product_code:'TEST-001',display_order:0}]);
    if(table==='save_exhibition_report_settings')return respond(null);
    if(table==='reports'){
      if(request.method()==='POST'){
        const payload=request.postDataJSON();
        if(saved.some(item=>item.id===payload.id))return respond({message:'duplicate'},409);
        saved.push({...payload,user_id:'fixture-user',author_name:'検証スタッフ',created_at:new Date().toISOString()});
        if(loseResponse){loseResponse=false;return respond({message:'lost_response'},500);}
        return respond([saved.at(-1)]);
      }
      if(url.searchParams.has('id'))return respond(saved.filter(item=>`eq.${item.id}`===url.searchParams.get('id')));
      return respond(saved.filter(item=>`eq.${item.exhibition_id}`===url.searchParams.get('exhibition_id')));
    }
    if(table==='exhibition_app_orders'&&url.searchParams.get('event_name')==='eq.JEX 2026')return respond([]);
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)');
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');
  await page.fill('#noteSearch','TEST-001');await page.click('[data-note-product="TEST-001"]');await page.click('[data-note-category="positive"]');await page.fill('#noteComment','実演が好評でした。<script>alert(1)</script>');
  await page.click('#noteSave');await page.waitForSelector('#noteError:text-is("前回の保存結果を確認します。「登録する」で同じ内容を再送してください。")');
  assert.equal(saved.length,1);assert.equal(await page.locator('#noteComment').inputValue(),'実演が好評でした。<script>alert(1)</script>');assert.equal(await page.locator('#noteComment').isDisabled(),true);
  await page.click('#noteSave');await page.waitForFunction(()=>document.querySelector('#noteComment').value==='');assert.equal(saved.length,1);
  await page.click('[data-note-product=""]');await page.click('[data-note-category="other"]');await page.fill('#noteComment','受付スペースは展示台2台分必要。');await page.click('#noteSave');await page.waitForFunction(()=>document.querySelector('#noteComment').value==='');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#exhibitionReport');
  assert.ok((await page.locator('#exhibitionReport').innerText()).includes('受付スペースは展示台2台分必要。'));
  assert.equal(await page.locator('#exhibitionReport script').count(),0);
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow: ${width}`);await page.screenshot({path:`tmp/report-checks/report-${width}.png`,fullPage:true});}
  const downloadPromise=page.waitForEvent('download');await page.click('#reportPdf');const download=await downloadPromise;await download.saveAs('tmp/report-checks/exhibition-report.pdf');assert.ok((await fs.stat('tmp/report-checks/exhibition-report.pdf')).size>15000);
  await page.click('#changeExhibition');await page.click('[data-event-id="jex_2026"]');await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-screen="reports"]');await page.waitForFunction(()=>document.querySelector('#exhibitionReport')?.textContent.includes('JEX 2026'));
  assert.ok(!(await page.locator('#exhibitionReport').innerText()).includes('受付スペースは展示台2台分必要。'));
  await page.click('[data-screen="orders"]');await page.waitForSelector('#newOrderBtn:visible');
  assert.equal(await page.locator('#eventName').textContent(),'JEX 2026');
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');
  await page.click('#changeExhibition');await page.click('[data-event-id="neo_2026"]');await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');
  await page.click('[data-note-product=""]');await page.click('[data-note-category="venue"]');
  const longComment='搬入・搬出の実務記録。'.repeat(400);
  await page.fill('#noteComment',longComment);await page.click('#noteSave');await page.waitForFunction(()=>document.querySelector('#noteComment').value==='');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#exhibitionReport');
  const longDownloadPromise=page.waitForEvent('download');await page.click('#reportPdf');const longDownload=await longDownloadPromise;await longDownload.saveAs('tmp/report-checks/long-report.pdf');
  assert.equal(saved.at(-1).comment,longComment);
  await page.click('#logoutBtn');await page.waitForSelector('#loginView:not(.hidden)');assert.equal(await page.locator('#exhibitionReport').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile entry, cloud confirmation, lost-response retry without duplicates, escaped comments, product/general grouping, exhibition isolation, current order target, 320/390/768/1280 layout, Japanese PDF download, long-comment pagination, logout cleanup');
}finally{await browser.close();}
