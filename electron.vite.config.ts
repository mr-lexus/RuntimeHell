import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

function copyMainAssetsPlugin() {
  return {
    name: 'copy-templates',
    closeBundle() {
      cpSync(resolve(process.cwd(), 'apps/main/src/execution/templates'), resolve(process.cwd(), 'out/main/templates'), {
        recursive: true,
      });
      cpSync(resolve(process.cwd(), 'build'), resolve(process.cwd(), 'out/main/assets'), {
        recursive: true,
      });
      // Performance harnesses execute outside Electron, so keep Mitata's
      // ESM source beside the main bundle for both production builds and
      // electron-vite dev rebuilds.
      cpSync(resolve(process.cwd(), 'apps/main/node_modules/mitata/src'), resolve(process.cwd(), 'out/main/mitata/src'), {
        recursive: true,
      });
    },
  };
}

const protocolAlias = resolve(process.cwd(), 'packages/protocol/src/index.ts');

export default defineConfig({
  main: {
    // NOTE: explicit `external` here REPLACES externalizeDepsPlugin's list
    // (todo 22 discovery), so both runtime externals are declared together:
    //  - 'electron' must stay the runtime API, never the npm path shim
    //  - 'esbuild' resolves its platform binary relative to its own package
    plugins: [copyMainAssetsPlugin()],
    resolve: { alias: { '@rh/protocol': protocolAlias } },
    build: {
      outDir: 'out/main',
      emptyOutDir: false,
      lib: { entry: 'apps/main/src/index.ts' },
      rollupOptions: { external: ['electron', 'esbuild'] },
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
    plugins: [],
    server: {
      port: 5189,
      strictPort: true,
    },
    resolve: {
      alias: { '@rh/protocol': protocolAlias },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    build: {
      outDir: 'out/renderer', // resolved against repo root (cwd), like main/preload
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(process.cwd(), 'apps/renderer/index.html')
      }
    }
  }
});
