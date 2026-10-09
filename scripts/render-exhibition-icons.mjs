import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const svg=await fs.readFile('assets/exhibition-icon.svg','utf8');
  for(const [size,path] of [[192,'assets/exhibition-icon-192.png'],[512,'assets/exhibition-icon-512.png'],[180,'assets/exhibition-apple-touch.png']]){
    const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({path});await page.close();
  }
}finally{await browser.close();}
