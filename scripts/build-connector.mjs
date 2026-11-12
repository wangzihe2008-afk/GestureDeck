import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipDirectory } from './zip.mjs';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'connector/dist');
// connector/dist is generated. Start clean so an interrupted copy cannot leave
// a hidden partial WASM file that later gets packaged or loaded by Chrome.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of [
  'background',
  'bridge',
  'presentation',
  'offscreen',
  'permission',
  'pose-worker',
]) {
  await build({
    entryPoints: [path.join(root, `connector/src/${entry}.ts`)],
    bundle: true,
    outfile: path.join(out, `${entry}.js`),
    format: ['bridge', 'presentation', 'pose-worker'].includes(entry) ? 'iife' : 'esm',
    platform: 'browser',
    target: 'chrome116',
    sourcemap: true,
    minify: false,
  });
}
for (const file of ['manifest.json', 'offscreen.html', 'permission.html', 'permission.css'])
  await cp(path.join(root, 'connector', file), path.join(out, file));
for (const asset of ['wasm', 'models', 'logo.svg', 'icon.png'])
  await cp(path.join(root, 'public', asset), path.join(out, asset), {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith('.'),
  });
await cp(path.join(root, 'licenses'), path.join(out, 'licenses'), { recursive: true });
const archive = await zipDirectory(out);
await writeFile(path.join(root, 'public/connector.zip'), archive);
try {
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/connector.zip'), archive);
} catch {
  /* dev source still has the download */
}
console.log('Connector ready: connector/dist — load this folder at chrome://extensions');
