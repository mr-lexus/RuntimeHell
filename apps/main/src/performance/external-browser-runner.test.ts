import { describe, expect, it } from 'vitest';
import { browserLaunchArgs, browserSessionEnv, externalBrowserId } from './external-browser-runner.js';

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

  it('forwards only Linux display/session variables', () => {
    expect(browserSessionEnv('linux', {
      DISPLAY: ':99', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/dbus',
      SECRET_TOKEN: 'do-not-forward'
    })).toEqual({ DISPLAY: ':99', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/dbus' });
  });

  it('does not add Linux session variables on macOS or Windows', () => {
    expect(browserSessionEnv('darwin', { DISPLAY: ':99' })).toEqual({});
    expect(browserSessionEnv('win32', { DISPLAY: ':99' })).toEqual({});
  });
});
