import type { RuntimeHellApi } from '../../preload/src/index';

declare global {
  interface Window {
    api: RuntimeHellApi;
  }
}

export {};
