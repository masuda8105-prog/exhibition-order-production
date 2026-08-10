import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [index,styles,config,workflow,app]=await Promise.all([
  fs.readFile(path.join(root,'index.html'),'utf8'),
  fs.readFile(path.join(root,'styles.css'),'utf8'),
  fs.readFile(path.join(root,'online-config.js'),'utf8'),
  fs.readFile(path.join(root,'workflow.js'),'utf8'),
  fs.readFile(path.join(root,'app.js'),'utf8'),
]);

const inlineWorkflow=workflow.replace(/^export\s+/gm,'');
const inlineApp=app.replace(/^import\s+\{[^\n]+\}\s+from\s+'\.\/workflow\.js';\s*/,'');
const preview=index
  .replace('<link rel="stylesheet" href="styles.css">',`<style>\n${styles}\n</style>`)
  .replace('<script src="online-config.js"></script>',`<script>\n${config}\n</script>`)
  .replace('<script type="module" src="app.js"></script>',`<script type="module">\n${inlineWorkflow}\n${inlineApp}\n</script>`);

await fs.writeFile(path.join(root,'exhibition_order_production_preview.html'),preview,'utf8');
console.log('exhibition_order_production_preview.html updated');
