// Builds the Chrome extension into dist-extension/ (load it unpacked from chrome://extensions).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { build } from 'vite';

const out = 'dist-extension';
for (const dir of ['public/models', 'public/wasm']) {
  if (!existsSync(dir)) throw new Error(`${dir} is missing: run "npm run setup" first.`);
}
rmSync(out, { recursive: true, force: true });

// one self-contained classic script per entry: content scripts cannot be ES modules
for (const name of ['inject', 'content', 'popup']) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: false,
      lib: { entry: `src/extension/${name}.ts`, formats: ['iife'], name: `henshin_${name}`, fileName: () => `${name}.js` },
    },
  });
}

cpSync('extension', out, { recursive: true });
cpSync('public/icon.png', `${out}/icon.png`);
cpSync('public/models', `${out}/models`, { recursive: true });
cpSync('public/wasm', `${out}/wasm`, { recursive: true });
console.log(`Built ${out}/. Load it at chrome://extensions with Developer mode on, then "Load unpacked".`);
