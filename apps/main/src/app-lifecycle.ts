import { platform as osPlatform } from 'node:os';
import { NpmPackageNameSchema } from '@rh/protocol';

export function isNpmPackagePage(url: string): boolean {
  const prefix = 'https://www.npmjs.com/package/';
  return url.startsWith(prefix) && NpmPackageNameSchema.safeParse(url.slice(prefix.length)).success;
}

/** macOS applications conventionally stay active after their last window closes. */
export function shouldQuitAfterAllWindowsClosed(host: NodeJS.Platform = osPlatform()): boolean {
  return host !== 'darwin';
}
