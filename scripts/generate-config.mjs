import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserConfigSource,loadConfigEnvironment} from './config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.writeFile(path.join(root,'online-config.js'),browserConfigSource(await loadConfigEnvironment(root)),'utf8');
console.log('online-config.js generated from environment variables');
