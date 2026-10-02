import { platform as osPlatform } from 'node:os';

/** macOS applications conventionally stay active after their last window closes. */
export function shouldQuitAfterAllWindowsClosed(host: NodeJS.Platform = osPlatform()): boolean {
  return host !== 'darwin';
}
