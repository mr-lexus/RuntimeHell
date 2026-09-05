import { join, sep } from 'node:path';

/** Resolve main-process assets for both dev and packaged Electron builds. */
export function mainAssetPath(baseDir: string, ...parts: string[]): string {
  const bundled = join(baseDir, ...parts);
  const marker = `${sep}app.asar${sep}`;
  return bundled.includes(marker)
    ? bundled.replace(marker, `${sep}app.asar.unpacked${sep}`)
    : bundled;
}
