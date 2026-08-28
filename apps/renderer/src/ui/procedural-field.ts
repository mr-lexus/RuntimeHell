export interface FieldPoint { x: number; y: number; }
export interface FieldSegment { a: FieldPoint; b: FieldPoint; level: number; }
export interface FieldStar extends FieldPoint { size: number; phase: number; drift: number; }

export type FieldPreset = 'topology' | 'signal' | 'blueprint';

export const FIELD_FRAME_INTERVAL = 40;

export function contourLevelsForPreset(preset: FieldPreset): readonly number[] {
  return preset === 'blueprint' ? [-0.35, 0.35] : [-0.48, -0.12, 0.22, 0.55];
}

/** Pure scheduling guard used by the canvas loop and lifecycle tests. */
export function shouldScheduleFrame(hidden: boolean, staticMotion: boolean): boolean {
  return !hidden && !staticMotion;
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function scalar(x: number, y: number, time: number, seed: number): number {
  const drift = time * 0.000035;
  return Math.sin(x * 0.013 + drift + seed) * 0.46
    + Math.cos(y * 0.017 - drift * 0.7 + seed * 1.7) * 0.34
    + Math.sin((x + y) * 0.006 + drift * 1.8) * 0.25
    + Math.cos(Math.hypot(x - 0.3 * y, y) * 0.008 - drift) * 0.16;
}

function edge(a: FieldPoint, b: FieldPoint, va: number, vb: number, level: number): FieldPoint {
  const ratio = Math.max(0, Math.min(1, (level - va) / ((vb - va) || 1)));
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

/**
 * Produces a small, deterministic contour sample. The renderer is free to
 * replace this technique later; callers only depend on this stable field
 * contract and not on marching-squares internals.
 */
export function generateContourSegments(width: number, height: number, cell: number, time: number, levels: readonly number[] = [-0.35, 0, 0.35]): FieldSegment[] {
  const result: FieldSegment[] = [];
  const step = Math.max(24, cell);
  for (let y = -step; y < height + step; y += step) {
    for (let x = -step; x < width + step; x += step) {
      const tl: FieldPoint = { x, y };
      const tr: FieldPoint = { x: x + step, y };
      const br: FieldPoint = { x: x + step, y: y + step };
      const bl: FieldPoint = { x, y: y + step };
      const values: [number, number, number, number] = [scalar(x, y, time, 0.7), scalar(x + step, y, time, 0.7), scalar(x + step, y + step, time, 0.7), scalar(x, y + step, time, 0.7)];
      for (const level of levels) {
        const mask = (values[0] > level ? 8 : 0) | (values[1] > level ? 4 : 0) | (values[2] > level ? 2 : 0) | (values[3] > level ? 1 : 0);
        const points = [
          edge(tl, tr, values[0], values[1], level),
          edge(tr, br, values[1], values[2], level),
          edge(bl, br, values[3], values[2], level),
          edge(tl, bl, values[0], values[3], level)
        ];
        const pairs: [number, number][] = [[3, 2], [2, 1], [3, 1], [0, 1], [0, 3], [0, 3], [0, 2], [0, 1], [0, 1], [0, 2], [1, 3], [0, 2], [3, 1], [2, 1], [3, 2], [0, 1]];
        const pair = pairs[mask];
        if (pair) result.push({ a: points[pair[0]]!, b: points[pair[1]]!, level });
      }
    }
  }
  return result;
}

export function fieldNodes(width: number, height: number, time: number, count = 18): FieldPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    x: hash(index * 11.7 + 2) * width,
    y: (hash(index * 19.3 + 9) * height + time * 0.004 * (index % 3)) % Math.max(1, height)
  }));
}

/** Stable star points for the VISCSS-inspired deep-space layer. */
export function fieldStars(width: number, height: number, time: number, count = 72): FieldStar[] {
  return Array.from({ length: count }, (_, index) => {
    const x0 = hash(index * 7.13 + 41) * width;
    const y0 = hash(index * 13.91 + 73) * height;
    const drift = 0.0008 + hash(index * 5.77 + 19) * 0.0018;
    return {
      x: (x0 + time * drift * (index % 2 === 0 ? 1 : -0.55) + width) % Math.max(1, width),
      y: (y0 + time * drift * 0.18 + height) % Math.max(1, height),
      size: hash(index * 3.17 + 11) > 0.84 ? 1.6 : 1,
      phase: hash(index * 17.31 + 7) * Math.PI * 2,
      drift
    };
  });
}

export function reducedMotion(motion: 'system' | 'reduced' | 'full', systemPreference: boolean): boolean {
  return motion === 'reduced' || (motion === 'system' && systemPreference);
}
