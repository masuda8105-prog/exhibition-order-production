import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8794/');await page.waitForSelector('#appView:not(.hidden)');
  const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#cee8ff';ctx.fillRect(0,0,600,400);ctx.fillStyle='#123456';ctx.font='48px sans-serif';ctx.fillText('BOOTH PHOTO',40,220);return canvas.toDataURL('image/png').split(',')[1];});
  const file={name:'booth.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')};
  const portrait=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;const x=c.getContext('2d');x.fillStyle='#ffeacc';x.fillRect(0,0,400,600);x.fillStyle='#123456';x.font='36px sans-serif';x.fillText('PRODUCT PHOTO',20,300);return c.toDataURL('image/png').split(',')[1];});
  const portraitFile={name:'product.png',mimeType:'image/png',buffer:Buffer.from(portrait,'base64')};
  await page.click('[data-screen="notes"]');await page.waitForSelector('#noteForm');
  await page.click('[data-note-product=""]');await page.click('[data-note-category="venue"]');
  await page.setInputFiles('#notePhotoFiles',[file,portraitFile,file,portraitFile,file,portraitFile,file]);await page.waitForFunction(()=>document.querySelectorAll('.reportPhotoGrid img').length===6&&!document.querySelector('#noteSave').disabled);
  let uploadFail=true;await page.route('**/storage/v1/object/exhibition-report-photos/**',async route=>{if(uploadFail){uploadFail=false;return route.abort('failed');}return route.continue();});
  await page.click('#noteSave');await page.waitForSelector('#noteError:text-is("前回の保存結果を確認します。「登録する」で同じ内容を再送してください。")');
  assert.equal(await page.locator('.reportPhotoGrid img').count(),6);
  await page.click('#noteSave');await page.waitForFunction(()=>document.querySelectorAll('.reportPhotoGrid img').length===0&&!document.querySelector('#noteSave').disabled);
  await page.click('[data-screen="reports"]');await page.waitForSelector('.reportPhotoFigure img');
  assert.equal(await page.locator('.reportPhotoFigure img').count(),6);
  assert.equal(await page.locator('.reportPhotoFigure figcaption').count(),0,'写真の下には名前を表示しない');
  await page.waitForFunction(()=>[...document.querySelectorAll('.reportPhotoFigure img')].every(img=>img.complete&&img.naturalWidth>0));
  const edit=page.locator('.reportComment').filter({hasText:'写真記録'}).locator('[data-edit-report]');const id=await edit.getAttribute('data-edit-report');
  await edit.click();await page.waitForSelector('#noteEditCancel');assert.equal(await page.locator('.reportPhotoGrid img').count(),6);
  await page.locator('[data-remove-note-photo]').first().click();await page.fill('#noteComment','ブース写真を更新しました');
  let patchFail=true;await page.route('**/rest/v1/reports?**',async route=>{if(route.request().method()==='PATCH'&&patchFail){patchFail=false;await route.fetch();return route.abort('failed');}return route.continue();});
  await page.click('#noteSave');await page.waitForSelector('#exhibitionReport');
  assert.equal(await page.locator('.reportPhotoFigure img').count(),5);assert.ok((await page.locator('#exhibitionReport').innerText()).includes('ブース写真を更新しました'));
  await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-screen="reports"]');await page.waitForSelector('.reportPhotoFigure img');assert.equal(await page.locator('.reportPhotoFigure img').count(),5);
  await fs.mkdir('tmp/report-photos',{recursive:true});await page.screenshot({path:'tmp/report-photos/report.png',fullPage:true});
  await page.evaluate(()=>{window.__photoSizes=[];window.__photoRows=[];const render=window.html2canvas;window.html2canvas=async(node,options)=>{for(const row of node.querySelectorAll('.reportPhotoRow'))window.__photoRows.push([...row.querySelectorAll('figure')].map(figure=>({x:figure.getBoundingClientRect().x,y:figure.getBoundingClientRect().y})));for(const img of node.querySelectorAll('.reportPhotoFigure img')){const r=img.getBoundingClientRect();window.__photoSizes.push({width:r.width,height:r.height,ratio:img.naturalWidth/img.naturalHeight});}return render(node,options);};});
  const downloadPromise=page.waitForEvent('download');await page.click('#reportPdf');const download=await downloadPromise;await download.saveAs('tmp/report-photos/report-with-photos.pdf');assert.ok((await fs.stat('tmp/report-photos/report-with-photos.pdf')).size>100000);
  const sizes=await page.evaluate(()=>window.__photoSizes);assert.equal(sizes.length,5);
  for(const size of sizes){assert.ok(Math.abs(size.width/size.height-size.ratio)<0.01);assert.ok(size.width<=219&&size.height<=180);}
  const rows=await page.evaluate(()=>window.__photoRows);assert.deepEqual(rows.map(row=>row.length),[3,2]);
  for(const row of rows){assert.ok(row.every(figure=>Math.abs(figure.y-row[0].y)<1));for(let i=1;i<row.length;i++)assert.ok(row[i].x>row[i-1].x);}
  page.once('dialog',dialog=>dialog.dismiss());await page.click(`[data-delete-report="${id}"]`);assert.equal(await page.locator(`[data-delete-report="${id}"]`).count(),1);
  page.once('dialog',dialog=>dialog.accept());await page.click(`[data-delete-report="${id}"]`);await page.waitForFunction(id=>!document.querySelector(`[data-delete-report="${id}"]`),id);
  assert.equal(await page.locator('.reportPhotoFigure img').count(),0);
  await page.click('#reportReload');await page.waitForSelector('#exhibitionReport');assert.ok(!(await page.locator('#exhibitionReport').innerText()).includes('ブース写真を更新しました'));
  assert.deepEqual(errors,[]);
  console.log('PASS: camera/select controls, six-photo limit, photo-only entry, failed upload retry without duplicate report, private upload/sign/download, edit/remove photos, lost PATCH response recovery, reload retention, Japanese photo PDF, delete cancellation and soft-delete sync');
}finally{await browser.close();}
