import { createRequire } from 'node:module';
import { mainAssetPath } from '../asset-paths.js';

const load = createRequire(__filename);
// Native child processes cannot execute an app.asar path. Loading esbuild
// from the unpacked tree also resolves its platform binary from that tree.
const esbuild: typeof import('esbuild') = load(mainAssetPath(load.resolve('esbuild')));
export const { build, transform } = esbuild;
