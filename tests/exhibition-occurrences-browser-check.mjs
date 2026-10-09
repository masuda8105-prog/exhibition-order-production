import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=process.env.LAYOUT_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const base=process.env.OCCURRENCE_FIXTURE_URL||'http://127.0.0.1:8796/';
try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  await context.addInitScript(()=>window.addEventListener('load',()=>setTimeout(()=>{for(const el of document.querySelectorAll('body > div'))if(el.textContent==='試用デモ・架空データ ／ 入力はこのデモ内だけに保存されます')el.style.pointerEvents='none';},0)));
  page.on('pageerror',e=>errors.push(e.message));
  let importedPrice=100,sourceReadFailure=false,resetCalls=[],loseResetResponse=true;
  const importedId='00000000-0000-4000-8000-000000000999';
  await context.route('**/rest/v1/exhibition_sales_sources?**',async route=>{
    const url=new URL(route.request().url()),isJex=url.searchParams.get('exhibition_id')==='eq.jex_2026';
    await route.fulfill({status:sourceReadFailure?503:200,contentType:'application/json',body:JSON.stringify(isJex?[{exhibition_id:'jex_2026',event_name:'legacy_fixture',label:'旧ツール'}]:[])});
  });
  await context.route('**/rest/v1/exhibition_app_orders?**',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('event_name')!=='eq.legacy_fixture')return route.continue();
    assert.equal(url.searchParams.get('deleted_at'),'is.null');
    await route.fulfill({json:[{id:importedId,event_name:'legacy_fixture',confirmation_state:'confirmed',created_at:'2026-10-07T00:00:00Z',payload:{type:'normal',handoff:'now',store:'旧店舗',staff:'旧担当',account:'旧卸屋',customerRegion:'domestic',workflowStatus:'done',items:[{code:'1065',name:'旧商品',qty:2,price:importedPrice}]}}]});
  });
  await context.route('**/rest/v1/rpc/start_next_exhibition',async route=>{
    resetCalls.push(route.request().postDataJSON());const response=await route.fetch();
    if(loseResetResponse){loseResetResponse=false;return route.fulfill({status:503,json:{message:'response_lost'}});}
    await route.fulfill({response});
  });
  await page.goto(base);await page.waitForSelector('[data-event-id="jex_2026"]');await page.click('[data-event-id="jex_2026"]');await page.waitForSelector('#appView:not(.hidden)');
  await page.click('[data-screen="sales"]');await page.waitForSelector('.reportSourceNotice');
  assert.match(await page.locator('.reportSourceNotice').innerText(),/1件/);
  assert.match(await page.locator('.reportPanel').innerText(),/842,800/);
  await page.locator('#salesFilters').evaluate(el=>el.open=true);
  await page.selectOption('#salesStaff','旧担当');await page.click('[data-sales-view="stores"]');assert.match(await page.locator('.reportPanel').innerText(),/旧店舗/);
  await page.click('#salesReset');
  importedPrice=150;await page.click('#reportReload');await page.waitForFunction(()=>document.querySelector('.reportPanel').textContent.includes('842,900'));
  sourceReadFailure=true;await page.click('#reportReload');assert.match(await page.locator('.reportPanel').innerText(),/842,900/,'source failure retains totals');sourceReadFailure=false;
  // A different open tab keeps its draft through another user's reset.
  const oldTab=await context.newPage();oldTab.on('pageerror',e=>errors.push(e.message));await oldTab.goto(base);await oldTab.waitForSelector('#appView:not(.hidden)');
  await oldTab.click('[data-screen="notes"]');await oldTab.waitForSelector('#noteForm');await oldTab.click('[data-note-product=""]');await oldTab.click('[data-note-category="other"]');await oldTab.fill('#noteComment','別端末で記入中のレポート');
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');await page.fill('#noteComment','リセット前に保存するメモ');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#reportReset');await page.click('#reportReset');assert.equal(await page.locator('.reportResetDialog').count(),0,'draft blocks reset');
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');assert.equal(await page.locator('#noteComment').inputValue(),'リセット前に保存するメモ');await page.fill('#noteComment','');
  // An unfinished order also blocks the actual switch.
  await page.click('[data-screen="orders"]');await page.click('#newOrderBtn');await page.waitForSelector('#sheet:not(.hidden)');
  await page.fill('#productQ','1065');await page.click('[data-product-id="product-102"]');await page.click('#closeSheet');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#reportReset');await page.click('#reportReset');await page.fill('#reportResetConfirm','リセット');await page.click('.reportResetDialog [type=submit]');
  assert.match(await page.locator('#reportResetError').innerText(),/入力途中/);assert.equal(resetCalls.length,0);
  await page.click('#reportResetCancel');await page.click('[data-screen="orders"]');await page.click('#discardDraftBtn');await page.click('#discardConfirm');await page.click('#closeSheet');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#reportReset');await page.click('#reportReset');
  assert.equal(await page.locator('.reportResetDialog [type=submit]').isDisabled(),true);await page.fill('#reportResetConfirm','リセット');
  await fs.mkdir('tmp/occurrences',{recursive:true});
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.locator('.reportResetDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'dialog fits');await page.screenshot({path:`tmp/occurrences/reset-${width}.png`});}
  await page.click('.reportResetDialog [type=submit]');await page.waitForFunction(()=>document.querySelector('#reportResetError')?.textContent.includes('再試行'));
  await page.click('.reportResetDialog [type=submit]');await page.waitForSelector('#newOrderBtn:visible');
  assert.equal(resetCalls.length,2);assert.equal(resetCalls[0].p_request_id,resetCalls[1].p_request_id,'same retry request');
  await page.click('[data-screen="sales"]');await page.waitForSelector('#salesFilters');assert.equal(await page.locator('.reportSourceNotice').count(),0,'legacy links stay archived');assert.doesNotMatch(await page.locator('.reportPanel').innerText(),/842,900|旧店舗/);
  await page.click('[data-screen="reports"]');await page.waitForSelector('#exhibitionReport');assert.doesNotMatch(await page.locator('#exhibitionReport').innerText(),/小型で使いやすい/);
  await page.click('#changeExhibition');await page.locator('.eventArchive').evaluate(el=>el.open=true);assert.equal(await page.locator('[data-event-id="jex_2026"]').count(),1);const nextId=await page.locator('[data-event-id^="event_"]').getAttribute('data-event-id');
  await page.click('[data-event-id="jex_2026"]');await page.click('[data-screen="reports"]');await page.waitForSelector('.reportArchiveNotice');assert.match(await page.locator('#exhibitionReport').innerText(),/小型で使いやすい/);assert.equal(await page.locator('#reportReset').count(),0);
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');const selected=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('exhibitionOps.selectedToday.v1:')))).id);assert.equal(selected,nextId,'old remembered selection follows successor');
  assert.equal(await oldTab.locator('#noteComment').inputValue(),'別端末で記入中のレポート');
  oldTab.on('dialog',dialog=>dialog.accept());await oldTab.reload();await oldTab.waitForSelector('#appView:not(.hidden)');await oldTab.click('[data-screen="notes"]');await oldTab.waitForFunction(()=>document.querySelector('#noteComment')?.value==='別端末で記入中のレポート');
  await oldTab.click('#noteSave');await oldTab.waitForFunction(()=>document.querySelector('#noteComment').value==='');
  await oldTab.click('[data-screen="reports"]');await oldTab.waitForSelector('.reportArchiveNotice');assert.match(await oldTab.locator('#exhibitionReport').innerText(),/別端末で記入中のレポート/);
  assert.deepEqual(errors,[]);console.log('PASS: legacy sales link/filter/live updates/failure preservation, text/order draft protection, confirmation, response-loss retry, fresh next event, archive retrieval, stale preference and other-tab draft preservation');
}finally{await browser.close();}
