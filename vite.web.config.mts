// Web replay page: the same renderer in a plain browser, replay only.
//   npm run build:web   -> dist/web (published to GitHub Pages by npm run deploy:web)
// The SmartSpectra SDK is replaced by src/web/sdkStub.ts, so none of its code
// is shipped; the bundled demo session is copied next to the page.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, 'dist/web');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  root: resolve(root, 'src/web'),
  base: './',
  publicDir: false,
  define: { __HTF_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@config': resolve(root, 'config'),
      '@smartspectra/node-sdk/renderer': resolve(root, 'src/web/sdkStub.ts'),
      '@smartspectra/node-sdk/messages': resolve(root, 'src/web/sdkStub.ts'),
    },
  },
  plugins: [
    react(),
    {
      name: 'htf-web-files',
      writeBundle() {
        mkdirSync(resolve(outDir, 'fixtures'), { recursive: true });
        copyFileSync(resolve(root, 'fixtures/sessions/demo-session.jsonl'), resolve(outDir, 'fixtures/demo-session.jsonl'));
        // GitHub Pages: serve the files as they are.
        writeFileSync(resolve(outDir, '.nojekyll'), '');
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
