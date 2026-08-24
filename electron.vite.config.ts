import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const protocolAlias = resolve(process.cwd(), 'packages/protocol/src/index.ts');

export default defineConfig({
  main: {
    // NOTE: explicit `external` here REPLACES externalizeDepsPlugin's list
    // (todo 22 discovery), so both runtime externals are declared together:
    //  - 'electron' must stay the runtime API, never the npm path shim
    //  - 'esbuild' resolves its platform binary relative to its own package
    plugins: [],
    resolve: { alias: { '@rh/protocol': protocolAlias } },
    build: {
      outDir: 'out/main',
      lib: { entry: 'apps/main/src/index.ts' },
      rollupOptions: { external: ['electron', 'esbuild'] }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@rh/protocol': protocolAlias } },
    build: {
      outDir: 'out/preload',
      lib: { entry: 'apps/preload/src/index.ts' }
    }
  },
  renderer: {
    root: 'apps/renderer',
    plugins: [react()],
    resolve: { alias: { '@rh/protocol': protocolAlias } },
    build: {
      outDir: 'out/renderer', // resolved against repo root (cwd), like main/preload
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(process.cwd(), 'apps/renderer/index.html')
      }
    }
  }
});
