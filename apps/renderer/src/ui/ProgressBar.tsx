/** Unknown duration is activity, not an invented percentage. */
export function ProgressBar({ label, value, active = false }: { label: string; value?: number; active?: boolean }): React.JSX.Element {
  const fraction = value === undefined ? undefined : Math.max(0, Math.min(1, value));
  return <div className={`rh-progress-bar ${fraction === undefined ? 'is-indeterminate' : ''} ${active ? 'is-active' : ''}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}>
    <span className="rh-progress-fill" style={{ transform: `scaleX(${fraction ?? 0})` }} />
    {active && <span className="rh-progress-sweep" />}
  </div>;
}
