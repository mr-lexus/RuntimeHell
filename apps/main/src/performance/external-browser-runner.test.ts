import { describe, expect, it } from 'vitest';
import { browserLaunchArgs, externalBrowserId } from './external-browser-runner.js';

describe('external browser benchmark launch', () => {
  it('isolates Chrome in a dedicated headless profile', () => {
    expect(externalBrowserId('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('chrome');
    expect(browserLaunchArgs('chrome', 'http://127.0.0.1:1234/run/token', 'C:\\tmp\\profile')).toEqual(expect.arrayContaining([
      '--headless=new', '--user-data-dir=C:\\tmp\\profile', 'http://127.0.0.1:1234/run/token'
    ]));
  });

  it('isolates Firefox in a dedicated headless profile', () => {
    expect(externalBrowserId('C:\\Program Files\\Mozilla Firefox\\firefox.exe')).toBe('firefox');
    expect(browserLaunchArgs('firefox', 'http://127.0.0.1:1234/run/token', 'C:\\tmp\\profile')).toEqual([
      '--headless', '--no-remote', '--new-instance', '--profile', 'C:\\tmp\\profile', 'http://127.0.0.1:1234/run/token'
    ]);
  });
});
