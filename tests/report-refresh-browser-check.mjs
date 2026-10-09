import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:390,height:600}});
  await page.addInitScript(()=>{
    const original=window.setInterval;
    const callbacks=[];window.refreshReports=()=>callbacks.forEach(fn=>fn());
    window.setInterval=(fn,ms,...args)=>ms===12000?(callbacks.push(fn),0):original(fn,ms,...args);
  });
  let fail=false,requests=0;
  await page.route('**/rest/v1/exhibitions?**',async route=>{
    requests++;await new Promise(resolve=>setTimeout(resolve,250));
    if(fail)return route.fulfill({status:500,contentType:'application/json',body:'{}'});
    return route.continue();
  });
  await page.goto('http://127.0.0.1:8794/');await page.waitForSelector('#appView:not(.hidden)');
  for(const screen of ['sales','reports']){
    await page.click(`[data-screen="${screen}"]`);await page.waitForSelector(screen==='sales'?'.reportTable':'#exhibitionReport');
    await page.evaluate(()=>scrollTo(0,700));
    const before=await page.evaluate(()=>scrollY),count=requests;
    await page.evaluate(()=>window.refreshReports());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>scrollY),before,'通信中も閲覧位置を保持');
    await page.waitForTimeout(800);assert.ok(requests>count);
    assert.equal(await page.evaluate(()=>scrollY),before,'同期後も閲覧位置を保持');
  }
  fail=true;await page.evaluate(()=>window.refreshReports());await page.waitForTimeout(800);
  assert.equal(await page.locator('#exhibitionReport').count(),1,'同期失敗でも内容を保持');fail=false;
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');
  await page.fill('#noteSearch','1065');await page.fill('#noteComment','入力を保持');
  await page.evaluate(()=>{document.querySelector('#noteComment').setSelectionRange(2,4);scrollTo(0,500);});
  const before=await page.evaluate(()=>scrollY);
  await page.evaluate(()=>document.querySelector('#reportReload').click());await page.waitForTimeout(800);
  assert.equal(await page.inputValue('#noteSearch'),'1065');assert.equal(await page.inputValue('#noteComment'),'入力を保持');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'noteComment');
  assert.deepEqual(await page.locator('#noteComment').evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,4]);
  assert.equal(await page.evaluate(()=>scrollY),before);
  console.log('PASS: refresh preserves scroll during/after requests, content on failure, note search/comment/focus/selection');
}finally{await browser.close();}
