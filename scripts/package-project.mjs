import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipDirectory } from './zip.mjs';
const root = path.resolve(import.meta.dirname, '..');
const bytes = await zipDirectory(
  root,
  (rel) =>
    rel === 'node_modules' ||
    rel === 'dist' ||
    rel === 'coverage' ||
    rel === '.git' ||
    rel.split('/').some((part) => part.startsWith('.vision_wasm_') || part === '.DS_Store') ||
    rel.endsWith('.log') ||
    rel.startsWith('public/.connector.zip.'),
  'GestureDeck/',
);
const output = path.resolve(root, '../GestureDeck.zip');
await writeFile(output, bytes);
console.log(`Project archive: ${output} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
