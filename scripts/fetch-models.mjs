// Downloads MediaPipe model files and copies the tasks-vision wasm runtime into /public.
// Everything is served locally afterwards: no CDN calls at runtime.
import { mkdir, cp, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://storage.googleapis.com/mediapipe-models';
const models = {
  'hand_landmarker.task': `${base}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'face_landmarker.task': `${base}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  'selfie_segmenter.tflite': `${base}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`,
};

async function exists(p) { try { return (await stat(p)).size > 0; } catch { return false; } }

await mkdir(join(root, 'public/models'), { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const out = join(root, 'public/models', name);
  if (await exists(out)) { console.log(`ok   ${name} (cached)`); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`got  ${name} ${(buf.length / 1e6).toFixed(1)} MB`);
}
await cp(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(root, 'public/wasm'), { recursive: true });
console.log('ok   wasm runtime copied');
