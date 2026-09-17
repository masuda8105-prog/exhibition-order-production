import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserConfigSource,loadConfigEnvironment} from './config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'_site');
const files=[
  'index.html','styles.css','app.js','workflow.js','security.js','receipt-share.js','order-attachments.js','assets/sun_nishimura_logo.jpg',
  'vendor/qrcode.min.js','vendor/html2canvas.min.js',
];

await fs.rm(destination,{recursive:true,force:true});
for(const relative of files){
  const target=path.join(destination,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(path.join(root,relative),target);
}
await fs.writeFile(path.join(destination,'online-config.js'),browserConfigSource(await loadConfigEnvironment(root)),'utf8');
console.log(`safe site built with ${files.length+1} files`);
