import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserConfigSource,loadConfigEnvironment} from './config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'_site');
const files=[
  'index.html','styles.css','app.js','workflow.js','security.js','receipt-share.js','order-attachments.js','order-pdf.js','manifest.webmanifest','assets/sun_nishimura_logo.jpg',
  'assets/neo-icon.svg','assets/neo-icon-192.png','assets/neo-icon-512.png','assets/apple-touch-icon.png',
  'vendor/jspdf.umd.min.js','vendor/jspdf.LICENSE','vendor/qrcode.min.js','vendor/html2canvas.min.js',
];

await fs.rm(destination,{recursive:true,force:true});
for(const relative of files){
  const target=path.join(destination,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(path.join(root,relative),target);
}
await fs.writeFile(path.join(destination,'online-config.js'),browserConfigSource(await loadConfigEnvironment(root)),'utf8');
console.log(`safe site built with ${files.length+1} files`);
