import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const pdfjs=await import(pathToFileURL('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage();
  const css=await fs.readFile('styles.css','utf8');
  await page.setContent(`<style>${css}</style><div id="printArea" class="printArea"><section class="printBatchCover"><h1>COVER PAGE</h1></section><article class="printSheet printPage receiptSheet"><h1>ORDER ONE</h1></article><section class="shareAttachmentPage"><div class="receiptCopyLabel">PHOTO ONE</div><p>Order 1</p><img alt="fixture" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6l6sAAAAASUVORK5CYII="></section><section class="shareAttachmentPage"><div class="receiptCopyLabel">PHOTO TWO</div><p>Order 1</p><img alt="fixture" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6l6sAAAAASUVORK5CYII="></section><article class="printSheet printPage receiptSheet"><h1>ORDER TWO</h1></article><section class="shareAttachmentPage"><div class="receiptCopyLabel">FINAL PHOTO</div><p>Order 2</p><img alt="fixture" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6l6sAAAAASUVORK5CYII="></section><div class="printFoot">Printed now</div></div>`);
  await page.emulateMedia({media:'print'});
  const bytes=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true});
  const document=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  const pages=[];
  for(let index=1;index<=document.numPages;index++){
    const content=await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map(item=>item.str).join(' '));
  }
  assert.equal(pages.length,6,`Unexpected pagination: ${JSON.stringify(pages)}`);
  assert.match(pages[0],/COVER PAGE/);assert.match(pages[1],/ORDER ONE/);
  assert.match(pages[2],/PHOTO ONE/);assert.doesNotMatch(pages[2],/ORDER TWO/);
  assert.match(pages[3],/PHOTO TWO/);assert.doesNotMatch(pages[3],/ORDER TWO/);
  assert.match(pages[4],/ORDER TWO/);
  assert.match(pages[5],/FINAL PHOTO/);
  console.log('PASS: cover, orders, and photos have separate pages with no trailing blank page');
}finally{await browser.close()}
