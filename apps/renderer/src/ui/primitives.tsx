import { forwardRef, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export type FrameState = 'idle' | 'active' | 'focused' | 'warning' | 'error';

export interface InstrumentFrameProps extends HTMLAttributes<HTMLElement> {
  index: string;
  title: string;
  metadata?: ReactNode;
  actions?: ReactNode;
  showHeader?: boolean;
  state?: FrameState;
  connectedEdges?: 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none';
  readout?: ReactNode;
}

/** Shared Runtime Hell frame: the geometry carries state, not a card fill. */
export function InstrumentFrame({ index, title, metadata, actions, showHeader = true, state = 'idle', connectedEdges = 'all', readout, className = '', children, ...props }: InstrumentFrameProps): React.JSX.Element {
  const id = useId();
  return (
    <section className={`rh-instrument-frame rh-frame-state-${state} rh-frame-connect-${connectedEdges} ${className}`} aria-labelledby={showHeader ? `${id}-title` : undefined} {...props}>
      {showHeader && <header>
          <span className="rh-frame-index">{index}</span>
          <span className="rh-frame-title" id={`${id}-title`}>{title}</span>
          <span className="rh-frame-rule" aria-hidden="true" />
          {metadata && <span className="rh-frame-meta">{metadata}</span>}
          {actions && <div className="rh-frame-actions">{actions}</div>}
        </header>}
      <div className="rh-instrument-body">{children}</div>
      {readout && <footer className="rh-frame-readout">{readout}</footer>}
    </section>
  );
}

export function Panel({ className = '', children, ...props }: HTMLAttributes<HTMLElement>): React.JSX.Element {
  return <section className={`rh-panel ${className}`} {...props}>{children}</section>;
}

export function PanelHeader({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`rh-panel-header ${className}`} {...props}>{children}</div>;
}

export function Toolbar({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`rh-toolbar ${className}`} {...props}>{children}</div>;
}

export function Button({ variant = 'ghost', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'ghost' | 'primary' | 'danger' | 'active' }): React.JSX.Element {
  return <button className={`rh-button rh-button-${variant} ${className}`} {...props}>{children}</button>;
}

const BLOCK_LOADER_PATTERNS: readonly string[] = [
  '⠁⠂⠄⡀⢀⠠⠐⠈',
  '⣾⣽⣻⢿⡿⣟⣯⣷',
  '▖▘▝▗',
  '▁▂▃▄▅▆▇█',
  '▉▊▋▌▍▎▏',
  '←↖↑↗→↘↓↙',
  '┤┘┴└├┌┬┐',
  '◢◣◤◥',
  '◰◳◲◱',
  '◴◷◶◵',
  '◐◓◑◒',
  '...'
];

/** Terminal-style animated single-character loader. */
export function BlockLoader({ mode = 1, interval = 80, label, className = '' }: { mode?: number; interval?: number; label?: string; className?: string }): React.JSX.Element {
  const pattern = BLOCK_LOADER_PATTERNS[Math.max(0, Math.min(BLOCK_LOADER_PATTERNS.length - 1, Math.round(mode)))] ?? BLOCK_LOADER_PATTERNS[1]!;
  const frames = Array.from(pattern);
  const style = {
    '--rh-loader-duration': `${Math.max(200, frames.length * interval)}ms`,
    '--rh-loader-steps': String(frames.length),
    '--rh-loader-distance': `-${(frames.length * 1.1).toFixed(2)}em`
  } as React.CSSProperties;
  const accessibility = label === undefined
    ? { 'aria-hidden': true }
    : { role: 'status' as const, 'aria-label': label };
  return (
    <span className={`rh-block-loader ${className}`} style={style} {...accessibility}>
      <span className="rh-block-loader-glyph" aria-hidden="true">
        <span className="rh-block-loader-track">
          {frames.concat(frames[0]!).map((frame, index) => <span key={`${frame}-${index}`}>{frame}</span>)}
        </span>
      </span>
      {label !== undefined && <span className="rh-loader-label">{label}</span>}
    </span>
  );
}

/** Terminal-style determinate or indeterminate horizontal loader. */
export function BarLoader({ progress, width = 20, fillChar = '█', emptyChar = '░', interval = 100, label, className = '' }: { progress?: number; width?: number; fillChar?: string; emptyChar?: string; interval?: number; label?: string; className?: string }): React.JSX.Element {
  const safeWidth = Math.max(4, Math.round(width));
  const value = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));
  const fillCount = value === undefined ? Math.max(2, Math.round(safeWidth * .18)) : Math.round(safeWidth * value / 100);
  const style = {
    '--rh-bar-block-width': `${fillCount}ch`,
    '--rh-bar-travel': `${Math.max(0, safeWidth - fillCount)}ch`,
    '--rh-bar-duration': `${Math.max(600, safeWidth * interval)}ms`
  } as React.CSSProperties;
  const accessibility = value === undefined
    ? label === undefined
      ? { 'aria-hidden': true }
      : { role: 'status' as const, 'aria-label': label }
    : { role: 'progressbar' as const, 'aria-label': label ?? 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value };
  return (
    <span className={`rh-bar-loader ${value === undefined ? 'is-indeterminate' : 'is-determinate'} ${className}`} style={style} {...accessibility}>
      <span className="rh-bar-loader-visual" aria-hidden="true">
        <span className="rh-bar-loader-bracket">[</span>
        <span className="rh-bar-loader-track">
          <span className="rh-bar-loader-empty">{emptyChar.repeat(safeWidth)}</span>
          {fillCount > 0 && <span className={`rh-bar-loader-fill ${value === undefined ? 'is-indeterminate' : ''}`} style={value === undefined ? undefined : { width: `${fillCount}ch` }}>{fillChar.repeat(fillCount)}</span>}
        </span>
        <span className="rh-bar-loader-bracket">]</span>
      </span>
      {label !== undefined && <span className="rh-loader-label">{label}</span>}
    </span>
  );
}

export function SegmentedControl({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`rh-segmented ${className}`} role="group" {...props}>{children}</div>;
}

export function TechnicalToggle({ label, checked, onChange, detail }: { label: string; checked: boolean; onChange: (checked: boolean) => void; detail?: string }): React.JSX.Element {
  return (
    <label className="rh-toggle-row">
      <span><span className="rh-setting-label">{label}</span>{detail && <small>{detail}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="rh-toggle-mark" aria-hidden="true"><span /></span>
    </label>
  );
}

export function StatusIndicator({ status, label }: { status: 'ready' | 'running' | 'warning' | 'error' | 'idle'; label: string }): React.JSX.Element {
  const glyph = status === 'ready' ? '✓' : status === 'running' ? '↻' : status === 'warning' ? '!' : status === 'error' ? '×' : '○';
  return <span className={`rh-status rh-status-${status}`}>{status === 'running' ? <BlockLoader /> : <span aria-hidden="true">{glyph}</span>}{label}</span>;
}

export function Separator({ vertical = false, ...props }: HTMLAttributes<HTMLDivElement> & { vertical?: boolean }): React.JSX.Element {
  return <div className={`rh-separator${vertical ? ' rh-separator-vertical' : ''}`} role="separator" {...props} />;
}

export function KeyboardHint({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd>{children}</kbd>;
}

export function EmptyState({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }): React.JSX.Element {
  return <div className="rh-empty-state"><div className="rh-empty-mark" aria-hidden="true">◇</div><strong>{title}</strong>{detail && <span>{detail}</span>}{children}</div>;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className = '', ...props }, ref): React.JSX.Element {
  return <input ref={ref} className={`rh-input ${className}`} {...props} />;
});
