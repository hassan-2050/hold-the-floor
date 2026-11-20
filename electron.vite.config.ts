import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// One build, two apps: the product (index) and the Stage 1 technical probe (probe).
// The probe is a developer tool; it is never opened by the product.
export default defineConfig({
  main: {
    build: {
      // Native SDK (koffi) and ws stay as runtime requires from node_modules.
      externalizeDeps: true,
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          probe: resolve(__dirname, 'probe/main.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads cannot require node_modules, so the SmartSpectra
      // preload bridge is bundled inline.
      externalizeDeps: false,
      // Each preload must be one self-contained file: sandboxed preloads
      // cannot require sibling chunks.
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          probe: resolve(__dirname, 'probe/preload.ts'),
          prompter: resolve(__dirname, 'electron/preload/prompter.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    // Root is the project so both pages (src/index.html, probe/index.html)
    // build into out/renderer/<folder>/index.html.
    root: __dirname,
    resolve: {
      alias: {
        '@config': resolve(__dirname, 'config'),
      },
    },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      // Never inline assets as data: URLs; the CSP only allows 'self'
      // scripts (the AudioWorklet module is loaded by URL).
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html'),
          probe: resolve(__dirname, 'probe/index.html'),
          prompter: resolve(__dirname, 'src/prompter/index.html'),
        },
      },
    },
  },
});
