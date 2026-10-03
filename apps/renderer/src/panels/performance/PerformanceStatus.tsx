import { useEffect, useState } from 'react';
import { usePerformance } from '../../state/performance';
import { ProgressBar } from '../../ui/ProgressBar';

const phases = { resolving: 'Checking runtimes', preparing: 'Preparing code', warmup: 'Warming up', measurement: 'Measuring' };
const outcomes = { completed: 'Comparison complete', partial: 'Completed with errors', cancelled: 'Comparison stopped', failed: 'Comparison failed' };

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** A small persistent readout; only the clock rerenders on a one-second timer.
 * Motion itself is compositor-driven CSS, independent of IPC frequency. */
export function PerformanceStatus({ active }: { active: boolean }): React.JSX.Element | null {
  const state = usePerformance();
  const [now, setNow] = useState(Date.now);
  const [catalogStartedAt, setCatalogStartedAt] = useState(Date.now);
  useEffect(() => { if (state.loadingCatalog) setCatalogStartedAt(Date.now()); }, [state.loadingCatalog]);
  const busy = state.running || state.loadingCatalog;
  useEffect(() => {
    if (!active || !busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, busy]);

  if (!busy && !state.outcome) return null;
  const probing = state.loadingCatalog && !state.running;
  const value = probing || (state.running && state.progressTotal === 0) ? undefined : state.progressTotal > 0 ? state.progressCompleted / state.progressTotal : 0;
  const startedAt = probing ? catalogStartedAt : state.startedAt;
  const elapsed = duration(startedAt === null ? 0 : (state.finishedAt && !probing ? state.finishedAt : now) - startedAt);
  const title = probing ? 'Finding available runtimes' : state.cancelling ? 'Stopping safely…'
    : state.outcome ? outcomes[state.outcome] : value !== undefined && value >= 1 ? 'Finalizing results'
    : phases[state.progressPhase ?? 'resolving'];
  const detail = probing ? 'Checking installed runtimes and supported profiles. This can take a few seconds.'
    : state.cancelling ? 'Waiting for the active process to exit. Completed results will be kept.'
    : state.outcome === 'failed' && state.totalGroups === 0 ? 'Could not start. See the error in Results.'
    : state.outcome ? `${state.completedGroups} of ${state.totalGroups} runtime/profile runs succeeded${state.outcome === 'partial' || state.outcome === 'failed' ? ' · See errors in Results' : ''}.`
    : state.progress;
  return <section className={`rh-perf-status is-${probing ? 'probing' : state.outcome ?? 'running'}`} aria-label="Performance status">
    <div className="rh-perf-status-heading"><strong role="status">{title}</strong><span>{!probing && <>{state.completedGroups}/{state.totalGroups} runs · </>}{elapsed}{value !== undefined && <> · {Math.round(value * 100)}%</>}</span></div>
    <ProgressBar label={probing ? 'Runtime discovery' : 'Performance experiment progress'} value={value} active={busy} />
    <div className="rh-perf-status-detail" title={detail}>{detail}</div>
  </section>;
}
