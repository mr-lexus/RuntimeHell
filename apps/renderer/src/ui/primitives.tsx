import { forwardRef, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export type FrameState = 'idle' | 'active' | 'focused' | 'warning' | 'error';

export interface InstrumentFrameProps extends HTMLAttributes<HTMLElement> {
  index: string;
  title: string;
  metadata?: ReactNode;
  actions?: ReactNode;
  state?: FrameState;
  connectedEdges?: 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none';
  readout?: ReactNode;
}

/** Shared Runtime Hell frame: the geometry carries state, not a card fill. */
export function InstrumentFrame({ index, title, metadata, actions, state = 'idle', connectedEdges = 'all', readout, className = '', children, ...props }: InstrumentFrameProps): React.JSX.Element {
  const id = useId();
  return (
    <section className={`rh-instrument-frame rh-frame-state-${state} rh-frame-connect-${connectedEdges} ${className}`} aria-labelledby={`${id}-title`} {...props}>
      <header className="rh-instrument-header">
        <span className="rh-frame-index">{index}</span>
        <span className="rh-frame-title" id={`${id}-title`}>{title}</span>
        <span className="rh-frame-rule" aria-hidden="true" />
        {metadata && <span className="rh-frame-meta">{metadata}</span>}
        {actions && <div className="rh-frame-actions">{actions}</div>}
      </header>
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
  return <span className={`rh-status rh-status-${status}`}><span aria-hidden="true">{glyph}</span>{label}</span>;
}

export function Separator({ vertical = false, ...props }: HTMLAttributes<HTMLDivElement> & { vertical?: boolean }): React.JSX.Element {
  return <div className={`rh-separator${vertical ? ' rh-separator-vertical' : ''}`} role="separator" {...props} />;
}

export function KeyboardHint({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="rh-keyboard-hint">{children}</kbd>;
}

export function EmptyState({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }): React.JSX.Element {
  return <div className="rh-empty-state"><div className="rh-empty-mark" aria-hidden="true">◇</div><strong>{title}</strong>{detail && <span>{detail}</span>}{children}</div>;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className = '', ...props }, ref): React.JSX.Element {
  return <input ref={ref} className={`rh-input ${className}`} {...props} />;
});
