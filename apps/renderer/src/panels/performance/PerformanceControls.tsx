import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PerformanceCase, PerformanceTargetOption, PerformanceTargetSelection } from '@rh/protocol';
import { performanceTargetKey, usePerformance } from '../../state/performance';
import { Button } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';

interface FileLike { id: string; relPath: string; content: string; }

function livePerformanceCases(cases: readonly PerformanceCase[], files: readonly FileLike[]): PerformanceCase[] {
  return cases.map((item) => {
    const ref = item.sourceRef;
    if (ref === undefined) return item;
    const file = files.find((candidate) => (ref.fileId !== undefined && candidate.id === ref.fileId) || candidate.relPath === ref.relPath);
    if (file === undefined || item.sourceMode !== 'selection') return file === undefined ? item : { ...item, body: file.content.trim(), sourceSnapshot: undefined };
    const lines = file.content.split(/\r?\n/);
    const start = Math.max(0, ref.startLine - 1);
    const end = Math.min(lines.length - 1, ref.endLine - 1);
    if (start > end || lines[start] === undefined) return item;
    const selected = lines.slice(start, end + 1);
    if (selected.length === 1) selected[0] = (selected[0] ?? '').slice(Math.max(0, ref.startCol - 1), Math.max(0, ref.endCol - 1));
    else {
      selected[0] = (selected[0] ?? '').slice(Math.max(0, ref.startCol - 1));
      const last = selected.length - 1;
      selected[last] = (selected[last] ?? '').slice(0, Math.max(0, ref.endCol - 1));
    }
    return { ...item, body: selected.join('\n').trim() || item.body, sourceSnapshot: undefined };
  });
}

function RunMatrixDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const state = usePerformance(useShallow(({ catalog, runTargets, running, setRunTargets }) => ({ catalog, runTargets, running, setRunTargets })));
  const [draft, setDraft] = useState<PerformanceTargetSelection[]>(state.runTargets);
  useEffect(() => { if (open) setDraft(state.runTargets); }, [open, state.runTargets]);
  if (!open) return null;
  const targets = state.catalog?.targets.filter((target) => target.available) ?? [];
  const isSelected = (target: PerformanceTargetOption): boolean => draft.some((item) => performanceTargetKey(item.target) === performanceTargetKey(target));
  const selectedProfiles = (target: PerformanceTargetOption): string[] => draft.find((item) => performanceTargetKey(item.target) === performanceTargetKey(target))?.profiles.map((profile) => profile.id) ?? [];
  const toggleTarget = (target: PerformanceTargetOption): void => {
    const key = performanceTargetKey(target);
    if (isSelected(target)) setDraft((items) => items.filter((item) => performanceTargetKey(item.target) !== key));
    else {
      const profile = target.profiles.find((item) => item.available);
      if (profile) setDraft((items) => [...items, { target: target.ref, profiles: [{ id: profile.id, label: profile.label }] }]);
    }
  };
  const toggleProfile = (target: PerformanceTargetOption, profileId: string): void => {
    const key = performanceTargetKey(target);
    setDraft((items) => items.map((item) => {
      if (performanceTargetKey(item.target) !== key) return item;
      const ids = item.profiles.map((profile) => profile.id);
      const next = ids.includes(profileId) ? ids.filter((id) => id !== profileId) : [...ids, profileId];
      return { ...item, profiles: next.length ? next.map((id) => ({ id, label: target.profiles.find((profile) => profile.id === id)?.label ?? id })) : item.profiles };
    }));
  };
  return <Dialog label="Runtimes and profiles" className="rh-perf-run-dialog" onClose={onClose}>
      <header><div><strong>Runtimes and profiles</strong><span>Each selected profile runs every code sample.</span></div><button type="button" className="rh-perf-dialog-close" onClick={onClose} aria-label="Close runtimes and profiles">×</button></header>
      <div className="rh-perf-run-dialog-list">
        {targets.map((target) => <div className={`rh-perf-run-target ${isSelected(target) ? 'is-selected' : ''}`} key={performanceTargetKey(target)}>
          <label className="rh-perf-run-target-head"><input type="checkbox" checked={isSelected(target)} disabled={state.running} onChange={() => toggleTarget(target)} /><strong>{target.label}</strong><small>{target.engineId ?? 'runtime'}</small></label>
          {isSelected(target) && <div className="rh-perf-run-profiles">{target.profiles.filter((profile) => profile.available).map((profile) => <label key={profile.id} title={profile.description}><input type="checkbox" checked={selectedProfiles(target).includes(profile.id)} disabled={state.running} onChange={() => toggleProfile(target, profile.id)} /><span>{profile.label}</span><small>{profile.classification}</small></label>)}</div>}
        </div>)}
        {targets.length === 0 && <span className="rh-perf-muted">No available runtimes found.</span>}
      </div>
      <footer><span>{draft.length} runtime{draft.length === 1 ? '' : 's'} · {draft.reduce((count, item) => count + item.profiles.length, 0)} profile runs</span><div><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={state.running || draft.length === 0} onClick={() => { state.setRunTargets(draft); onClose(); }}>Apply</Button></div></footer>
  </Dialog>;
}

function PerformanceRunMatrixControl(): React.JSX.Element {
  const state = usePerformance(useShallow(({ runTargets, running, loadingCatalog, refreshCatalog }) => ({ runTargets, running, loadingCatalog, refreshCatalog })));
  const [open, setOpen] = useState(false);
  const runCount = state.runTargets.reduce((count, item) => count + item.profiles.length, 0);
  return <><Button className="rh-perf-run-matrix-button" onClick={() => setOpen(true)} disabled={state.running || state.loadingCatalog} title="Choose runtimes and optimizer profiles">{runCount ? `Runtimes · ${runCount} runs` : 'Choose runtimes'}</Button><Button onClick={() => void state.refreshCatalog(true)} disabled={state.running || state.loadingCatalog} title="Check installed runtimes again" aria-label="Refresh runtimes">↻</Button><RunMatrixDialog open={open} onClose={() => setOpen(false)} /></>;
}

export function PerformanceControls({ files }: { files: readonly FileLike[] }): React.JSX.Element {
  const state = usePerformance(useShallow(({ running, cancelling, loadingCatalog, measurement, cases, runTargets, run, cancel, setMeasurement, applyPreset }) => ({ running, cancelling, loadingCatalog, measurement, cases, runTargets, run, cancel, setMeasurement, applyPreset })));
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const setNumber = (key: 'samples' | 'iterationsPerSample', value: string): void => {
    const limits = key === 'samples' ? { min: 3, max: 200 } : { min: 1, max: 10_000_000 };
    state.setMeasurement({ [key]: Math.max(limits.min, Math.min(limits.max, Number(value) || limits.min)) });
  };
  return <div className="rh-perf-header-controls" aria-label="Performance measurement controls">
    <PerformanceRunMatrixControl />
    <Button onClick={() => setMeasurementOpen(true)} title="Configure samples, cycles, warmup, timeout and garbage collection">Measurement settings</Button>
    {state.running ? <Button variant="danger" disabled={state.cancelling} onClick={() => void state.cancel()}>{state.cancelling ? 'Stopping…' : 'Stop'}</Button> : <Button variant="primary" onClick={() => void state.run(livePerformanceCases(state.cases, files))} disabled={state.loadingCatalog || state.cases.length === 0 || state.runTargets.length === 0}>Run comparison</Button>}
    {measurementOpen && <Dialog label="Measurement settings" className="rh-measurement-dialog" onClose={() => setMeasurementOpen(false)}><header className="rh-dialog-heading"><div><h2>Measurement settings</h2><p>Balance speed and statistical confidence.</p></div><Button aria-label="Close measurement settings" onClick={() => setMeasurementOpen(false)}><Icon name="close" /></Button></header><div className="rh-measurement-fields">
    <div className="rh-perf-header-presets">{(['quick', 'reliable'] as const).map((preset) => <Button key={preset} title={preset === 'quick' ? '5 samples · 250 cycles' : '30 samples · 1,000 cycles'} onClick={() => state.applyPreset(preset)} disabled={state.running}>{preset}</Button>)}</div>
    <label title="Number of measured samples">samples<input type="number" min={3} max={200} value={state.measurement.samples} disabled={state.running} onChange={(event) => setNumber('samples', event.target.value)} /></label>
    <label title="Iterations per sample">cycles<input type="number" min={1} max={10_000_000} value={state.measurement.iterationsPerSample} disabled={state.running} onChange={(event) => setNumber('iterationsPerSample', event.target.value)} /></label>
      <label>warmup<input type="number" min={0} max={10_000} value={state.measurement.warmupRounds} disabled={state.running} onChange={(event) => state.setMeasurement({ warmupRounds: Math.max(0, Math.min(10_000, Number(event.target.value) || 0)) })} /></label>
      <label>timeout<input type="number" min={1_000} max={600_000} value={state.measurement.timeoutMs} disabled={state.running} onChange={(event) => state.setMeasurement({ timeoutMs: Math.max(1_000, Math.min(600_000, Number(event.target.value) || 1_000)) })} /></label>
      <label>GC<select value={state.measurement.gcMode} disabled={state.running} onChange={(event) => state.setMeasurement({ gcMode: event.target.value as typeof state.measurement.gcMode })}><option value="runtime">runtime</option><option value="before-group">before group</option><option value="before-sample">before sample</option></select></label>
    </div></Dialog>}
  </div>;
}
