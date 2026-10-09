import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=process.env.LAYOUT_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const base='http://127.0.0.1:8796/';
try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/rest/v1/exhibitions?**',async route=>{const response=await route.fetch(),rows=await response.json();const original=rows.find(event=>event.id==='jex_2026');if(original)rows.push({...original,id:'jex_2027',name:'JEX 2027（デモ）'});await route.fulfill({response,json:rows});});
  await page.goto(base);await page.waitForSelector('#eventChooser:not(.hidden) [data-event-id="jex_2026"]');
  assert.doesNotMatch(await page.locator('#eventChoices').innerText(),/2026|2027/);
  assert.match(await page.locator('[data-event-id="jex_2026"]').innerText(),/開催回 1/);assert.match(await page.locator('[data-event-id="jex_2027"]').innerText(),/開催回 2/);
  await page.click('[data-event-id="jex_2026"]');await page.waitForSelector('#appView:not(.hidden)');
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');assert.match(await page.locator('#eventName').innerText(),/JEX/);assert.equal(await page.locator('#eventChooser').isVisible(),false);
  const reopened=await context.newPage();await reopened.goto(base);await reopened.waitForSelector('#appView:not(.hidden)');assert.match(await reopened.locator('#eventName').innerText(),/JEX/);await reopened.close();
  await page.click('#changeExhibition');await page.waitForSelector('#eventChooser:not(.hidden)');await page.click('[data-event-id="wof_2026"]');await page.waitForSelector('#appView:not(.hidden)');
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');assert.match(await page.locator('#eventName').innerText(),/WOF/);
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('exhibitionOps.selectedToday.v1:'));const saved=JSON.parse(localStorage.getItem(key));saved.day='2000-01-01';localStorage.setItem(key,JSON.stringify(saved));});
  await page.reload();await page.waitForSelector('#eventChooser:not(.hidden) [data-event-id="jex_2026"]');assert.equal(await page.locator('#appView').isVisible(),false,'expired selection does not resume');
  await page.click('[data-event-id="jex_2026"]');await page.waitForSelector('#appView:not(.hidden)');
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('exhibitionOps.selectedToday.v1:'));const saved=JSON.parse(localStorage.getItem(key));saved.id='deleted-event';localStorage.setItem(key,JSON.stringify(saved));});
  await page.reload();await page.waitForSelector('#eventChooser:not(.hidden) [data-event-id="jex_2026"]');assert.equal(await page.locator('#appView').isVisible(),false,'missing selection does not select another exhibition');
  let failed=true;await page.route('**/rest/v1/exhibition_app_orders?**',route=>failed?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.continue());
  await page.click('[data-event-id="jex_2026"]');await page.waitForFunction(()=>document.querySelector('#eventChooserError').textContent.includes('読み込めません'));
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('exhibitionOps.selectedToday.v1:'))),false,'failed load does not remember an unverified exhibition');
  failed=false;await page.click('[data-event-id="jex_2026"]');await page.waitForSelector('#appView:not(.hidden)');assert.deepEqual(errors,[]);
  console.log('PASS: year-free choices, same-day reload/new-window resume, explicit switch, expiry/missing event/failure fallback');
}finally{await browser.close();}
