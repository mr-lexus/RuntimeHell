import { describe, expect, it } from 'vitest';
import { contourLevelsForPreset, fieldStars, generateContourSegments, reducedMotion, shouldScheduleFrame } from './procedural-field';

describe('procedural field', () => {
  it('is deterministic for the same frame', () => {
    expect(generateContourSegments(320, 180, 42, 1200)).toEqual(generateContourSegments(320, 180, 42, 1200));
  });

  it('changes over time without changing its contract', () => {
    const first = generateContourSegments(320, 180, 42, 0);
    const second = generateContourSegments(320, 180, 42, 30000);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    expect(second).not.toEqual(first);
  });

  it('keeps topology and signal related while blueprint stays quieter', () => {
    expect(contourLevelsForPreset('topology')).toEqual(contourLevelsForPreset('signal'));
    expect(contourLevelsForPreset('blueprint')).not.toEqual(contourLevelsForPreset('topology'));
  });

  it('generates deterministic animated star points', () => {
    const first = fieldStars(640, 360, 0, 24);
    expect(first).toEqual(fieldStars(640, 360, 0, 24));
    expect(fieldStars(640, 360, 30000, 24)).not.toEqual(first);
  });

  it('resolves system motion preferences', () => {
    expect(reducedMotion('reduced', false)).toBe(true);
    expect(reducedMotion('system', true)).toBe(true);
    expect(reducedMotion('system', false)).toBe(false);
    expect(reducedMotion('full', true)).toBe(false);
  });

  it('stops scheduling frames when hidden or static', () => {
    expect(shouldScheduleFrame(false, false)).toBe(true);
    expect(shouldScheduleFrame(true, false)).toBe(false);
    expect(shouldScheduleFrame(false, true)).toBe(false);
  });
});
