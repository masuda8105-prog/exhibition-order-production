import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>{
    const original=window.setInterval;
    const callbacks=[];window.refreshReports=()=>callbacks.forEach(fn=>fn());
    window.setInterval=(fn,ms,...args)=>ms===12000?(callbacks.push(fn),0):original(fn,ms,...args);
  });
  let fail=false,requests=0,changed=false;
  await page.route('**/rest/v1/reports?**',async route=>{
    const response=await route.fetch(),rows=await response.json();
    if(changed&&rows[0])rows[0].comment+=' PC更新確認';
    await route.fulfill({response,json:rows});
  });
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
  const report=await page.locator('#exhibitionReport').elementHandle();
  await page.evaluate(()=>window.refreshReports());await page.waitForTimeout(800);
  assert.ok(await report.evaluate(el=>el.isConnected),'変更なしの同期ではDOMを保持');
  const reportPosition=await page.evaluate(()=>scrollY);changed=true;
  await page.evaluate(()=>window.refreshReports());await page.waitForTimeout(800);
  assert.ok((await page.locator('#exhibitionReport').innerText()).includes('PC更新確認'));
  assert.equal(await page.evaluate(()=>scrollY),reportPosition,'内容が変わった同期でも位置を保持');
  // Also cover a PC page hosted in a scrolling container.
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='desktopScrollHost';
    host.style.cssText='height:600px;overflow:auto';
    const app=document.querySelector('#appView');app.before(host);host.append(app);host.scrollTop=600;
  });
  const containerPosition=await page.locator('#desktopScrollHost').evaluate(el=>el.scrollTop);
  changed=false;await page.evaluate(()=>window.refreshReports());await page.waitForTimeout(800);
  assert.equal(await page.locator('#desktopScrollHost').evaluate(el=>el.scrollTop),containerPosition);
  await page.evaluate(()=>{const host=document.querySelector('#desktopScrollHost');host.before(document.querySelector('#appView'));host.remove();});
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
  for(const width of [1024,1280,1440,1920]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const selection=document.querySelector('.reportNoteSelection').getBoundingClientRect();
      const editor=document.querySelector('.reportNoteEditor').getBoundingClientRect();
      return {selectionRight:selection.right,editorLeft:editor.left,editorWidth:editor.width,textareaHeight:document.querySelector('#noteComment').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(layout.editorLeft>layout.selectionRight);assert.ok(layout.editorWidth>=500);assert.ok(layout.textareaHeight>=240);assert.equal(layout.overflow,false);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.click('[data-note-product="1065"]');await page.click('[data-note-category="positive"]');
  await page.fill('#noteComment','実演後に使い方が伝わり、追加注文の相談がありました。');
  await page.waitForTimeout(3000);
  await fs.mkdir('tmp/report-checks',{recursive:true});await page.screenshot({path:'tmp/report-checks/desktop-entry.png',fullPage:true});
  await page.click('#noteSave');await page.waitForFunction(()=>document.querySelector('#noteComment')?.value==='');
  await page.click('[data-screen="reports"]');await page.waitForSelector('#exhibitionReport');
  assert.ok((await page.locator('#exhibitionReport').innerText()).includes('実演後に使い方が伝わり、追加注文の相談がありました。'));
  console.log('PASS: PC refresh with unchanged/changed content, nested scrolling, note input/focus, two-column entry at 1024–1920px');
}finally{await browser.close();}
