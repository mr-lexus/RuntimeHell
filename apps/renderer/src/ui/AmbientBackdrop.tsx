import { useEffect, useRef } from 'react';
import type { AccentPreset, BackgroundIntensity, BackgroundPreset, MotionMode } from '@rh/protocol';
import { contourLevelsForPreset, FIELD_FRAME_INTERVAL, fieldNodes, fieldStars, generateContourSegments, reducedMotion, shouldScheduleFrame } from './procedural-field';

interface AmbientBackdropProps {
  preset: BackgroundPreset;
  intensity: BackgroundIntensity;
  motion: MotionMode;
  accent?: AccentPreset;
  theme?: 'dark' | 'light';
}

const ACCENT: Record<string, [number, number, number]> = {
  cyan: [92, 199, 216],
  amber: [216, 168, 76],
  silver: [170, 185, 199],
  violet: [139, 124, 255],
  magenta: [214, 93, 177],
  green: [84, 179, 122],
  orange: [224, 121, 63],
  ruby: [217, 87, 103]
};

function accentRgb(value: AccentPreset): [number, number, number] {
  const preset = ACCENT[value];
  if (preset !== undefined) return preset;
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match?.[1] !== undefined) {
    return [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16)
    ];
  }
  return ACCENT.cyan ?? [92, 199, 216];
}

export function AmbientBackdrop({ preset, intensity, motion, accent = 'cyan', theme = 'dark' }: AmbientBackdropProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || preset === 'off') return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    let raf = 0;
    let width = 0;
    let height = 0;
    let last = -Infinity;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let staticMotion = reducedMotion(motion, media.matches);
    const intensityAlpha = intensity === 'low' ? 0.52 : intensity === 'high' ? 1 : 0.76;
    const [r, g, b] = accentRgb(accent);
    const foreground = theme === 'light' ? [20, 54, 66] : [r, g, b];

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(0);
    };

    const stroke = (alpha: number): string => `rgba(${foreground[0]}, ${foreground[1]}, ${foreground[2]}, ${alpha * intensityAlpha})`;
    const draw = (time: number): void => {
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);
      const aura = ctx.createRadialGradient(width * 0.68, height * 0.24, 0, width * 0.68, height * 0.24, Math.max(width, height) * 0.72);
      aura.addColorStop(0, stroke(preset === 'blueprint' ? 0.018 : 0.045));
      aura.addColorStop(0.52, stroke(0.012));
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);

      const starCount = preset === 'topology' ? Math.max(54, Math.floor((width * height) / 15000)) : preset === 'signal' ? 42 : 24;
      for (const star of fieldStars(width, height, staticMotion ? 0 : time, starCount)) {
        const twinkle = 0.5 + 0.5 * Math.sin((staticMotion ? 0 : time * 0.0012) + star.phase);
        ctx.fillStyle = stroke((preset === 'blueprint' ? 0.055 : 0.11) + twinkle * (preset === 'blueprint' ? 0.035 : 0.12));
        ctx.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size);
      }

      const contourLevels = contourLevelsForPreset(preset);
      ctx.lineWidth = preset === 'blueprint' ? 0.7 : 0.8;
      for (const segment of generateContourSegments(width, height, preset === 'blueprint' ? 56 : 48, staticMotion ? 0 : time, contourLevels)) {
        const levelAlpha = preset === 'blueprint' ? 0.11 : 0.08 + Math.abs(segment.level) * 0.035;
        ctx.strokeStyle = stroke(levelAlpha);
        ctx.beginPath();
        ctx.moveTo(segment.a.x, segment.a.y);
        ctx.lineTo(segment.b.x, segment.b.y);
        ctx.stroke();
      }

      if (preset === 'blueprint') {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = stroke(0.06);
        const step = 84;
        for (let x = 0; x < width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
        for (let y = 0; y < height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      }

      if (preset === 'signal') {
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = stroke(0.12);
        const offset = staticMotion ? 0 : (time * 0.012) % 96;
        for (let i = 0; i < 5; i += 1) {
          const y = ((i + 1) * height) / 6 + offset - 48;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width * 0.22, y); ctx.lineTo(width * 0.28, y + 18); ctx.lineTo(width * 0.72, y + 18); ctx.lineTo(width * 0.78, y); ctx.lineTo(width, y); ctx.stroke();
        }
      }

      ctx.fillStyle = stroke(0.24);
      for (const node of fieldNodes(width, height, staticMotion ? 0 : time, Math.max(6, Math.floor((width * height) / 115000)))) {
        ctx.fillRect(Math.round(node.x), Math.round(node.y), 2, 2);
        if (preset !== 'blueprint') {
          ctx.fillRect(Math.round(node.x) - 4, Math.round(node.y), 2, 1);
          ctx.fillRect(Math.round(node.x) + 4, Math.round(node.y), 2, 1);
        }
      }
    };

    const tick = (time: number): void => {
      if (!shouldScheduleFrame(document.hidden, staticMotion)) return;
      if (time - last < FIELD_FRAME_INTERVAL) { raf = requestAnimationFrame(tick); return; }
      last = time;
      draw(time);
      raf = requestAnimationFrame(tick);
    };
    const restart = (): void => {
      staticMotion = reducedMotion(motion, media.matches);
      cancelAnimationFrame(raf);
      last = -Infinity;
      draw(0);
      if (shouldScheduleFrame(document.hidden, staticMotion)) raf = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const onVisibility = (): void => restart();
    media.addEventListener?.('change', restart);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    restart();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      media.removeEventListener?.('change', restart);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accent, intensity, motion, preset, theme]);

  return <canvas ref={canvasRef} className={`rh-ambient-backdrop rh-ambient-${preset}`} aria-hidden="true" data-preset={preset} data-motion={motion} />;
}
