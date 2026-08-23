import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const protocolAlias = resolve(process.cwd(), 'packages/protocol/src/index.ts');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@rh/protocol': protocolAlias } },
    build: {
      outDir: 'out/main',
      lib: { entry: 'apps/main/src/index.ts' }
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
      outDir: '../../out/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(process.cwd(), 'apps/renderer/index.html')
      }
    }
  }
});
