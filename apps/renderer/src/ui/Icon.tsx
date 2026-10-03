import type { CSSProperties } from 'react';

const paths = {
  search: 'm21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  play: 'm8 5 11 7-11 7Z',
  stop: 'M6 6h12v12H6Z',
  layout: 'M3 4h18v16H3ZM3 14h18',
  right: 'M3 4h18v16H3ZM14 4v16',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  close: 'm6 6 12 12M6 18 18 6',
  expand: 'M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7',
  restore: 'M4 9h11v11H4ZM9 9V4h11v11h-5',
  chevron: 'm8 10 4 4 4-4',
  console: 'm4 6 6 6-6 6m9 0h7',
  inspector: 'm12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8m-9 5v9',
  analysis: 'M5 3v7m0 4v7m7-18v3m0 4v11m7-18v11m0 4v3M2 10h6m1-4h6m1 8h6',
  performance: 'M4 20V10m8 10V4m8 16v-7',
  packages: 'm12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5m-9 5v9M8 5l9 5',
  runtimes: 'M6 6h12v12H6ZM9 9h6v6H9Zm0-8v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-2 3 1 3-3 3-3-1-2 3-4-1-1-3-3-1-1-4 2-2-1-3 3-3Z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  plus: 'M12 5v14M5 12h14',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20',
  help: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  check: 'm5 12 4 4L19 6'
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }): React.JSX.Element {
  return <svg className="rh-ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}><path d={paths[name]} /></svg>;
}
