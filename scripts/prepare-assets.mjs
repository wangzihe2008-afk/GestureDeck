import { mkdir, cp, access, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Ship model + WASM locally. No camera frame ever leaves the browser.
const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, 'licenses'), { recursive: true });
for (const [source, destination] of [
  ['react/LICENSE', 'React-LICENSE.txt'],
  ['react-dom/LICENSE', 'ReactDOM-LICENSE.txt'],
  ['pdfjs-dist/LICENSE', 'PDFjs-LICENSE.txt'],
  ['lucide-react/LICENSE', 'Lucide-LICENSE.txt'],
  ['pdfjs-dist/LICENSE', 'MediaPipe-Apache-2.0.txt'],
])
  await cp(path.join(root, 'node_modules', source), path.join(root, 'licenses', destination));
const modelDir = path.join(root, 'public/models');
await mkdir(modelDir, { recursive: true });
await cp(
  path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm'),
  path.join(root, 'public/wasm'),
  { recursive: true },
);
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(
    path.join(root, 'node_modules/pdfjs-dist', name),
    path.join(root, 'public/pdf-assets', name),
    { recursive: true },
  );
}
const file = path.join(modelDir, 'pose_landmarker_lite.task');
const url =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
try {
  await access(file);
} catch {
  console.log('Downloading the official MediaPipe Pose Landmarker Lite model (one-time setup)...');
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}. Run npm run setup again.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error('Model download is incomplete.');
  await writeFile(file, bytes);
}
const hash = createHash('sha256')
  .update(await readFile(file))
  .digest('hex');
await writeFile(
  path.join(modelDir, 'provenance.json'),
  JSON.stringify(
    { source: url, model: 'Pose Landmarker Lite, float16, version 1', sha256: hash },
    null,
    2,
  ) + '\n',
);
console.log('Local camera model and WASM ready.');
