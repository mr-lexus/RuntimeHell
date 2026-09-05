import { describe, expect, it } from 'vitest';
import { mainAssetPath } from './asset-paths.js';

describe('mainAssetPath', () => {
  it('keeps development assets beside the main bundle', () => {
    expect(mainAssetPath('C:/RuntimeHell/out/main', 'templates', 'bootstrap.cjs').replace(/\\/g, '/'))
      .toBe('C:/RuntimeHell/out/main/templates/bootstrap.cjs');
  });

  it('routes packaged child-process assets through app.asar.unpacked', () => {
    expect(mainAssetPath('C:/RuntimeHell/resources/app.asar/out/main', 'templates', 'bootstrap.cjs').replace(/\\/g, '/'))
      .toBe('C:/RuntimeHell/resources/app.asar.unpacked/out/main/templates/bootstrap.cjs');
  });
});
