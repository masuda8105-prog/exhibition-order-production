import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [index,styles,config,workflow,security,app,logo]=await Promise.all([
  fs.readFile(path.join(root,'index.html'),'utf8'),
  fs.readFile(path.join(root,'styles.css'),'utf8'),
  fs.readFile(path.join(root,'online-config.js'),'utf8'),
  fs.readFile(path.join(root,'workflow.js'),'utf8'),
  fs.readFile(path.join(root,'security.js'),'utf8'),
  fs.readFile(path.join(root,'app.js'),'utf8'),
  fs.readFile(path.join(root,'assets','sun_nishimura_logo.jpg')),
]);

const inlineWorkflow=workflow.replace(/^export\s+/gm,'');
const inlineSecurity=security.replace(/^export\s+/gm,'');
const inlineApp=app.replace(/^import\s+\{[^\n]+\}\s+from\s+'\.\/(?:workflow|security)\.js(?:\?[^']+)?';\s*/gm,'');
const logoData=`data:image/jpeg;base64,${logo.toString('base64')}`;
const preview=index
  .replace('<link rel="stylesheet" href="styles.css?v=20260901-secure1">',`<style>\n${styles}\n</style>`)
  .replace('<script src="online-config.js?v=20260901-secure1"></script>',`<script>\n${config}\n</script>`)
  .replace('<script type="module" src="app.js?v=20260901-secure1"></script>',`<script type="module">\n${inlineWorkflow}\n${inlineSecurity}\n${inlineApp}\n</script>`)
  .replaceAll('assets/sun_nishimura_logo.jpg',logoData);

await fs.writeFile(path.join(root,'exhibition_order_production_preview.html'),preview,'utf8');
console.log('exhibition_order_production_preview.html updated');
