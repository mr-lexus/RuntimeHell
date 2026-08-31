import { useEffect, useMemo } from 'react';
import type { PerformanceCase, PerformanceRunResult, PerformanceTargetOption } from '@rh/protocol';
import type { SelectionInfo } from '../../editor/selection-service';
import { Button, EmptyState, InstrumentFrame } from '../../ui/primitives';
import { performanceTargetKey, usePerformance } from '../../state/performance';

interface ActiveFileLike { relPath: string; content: string }
interface PerformancePanelProps { activeFile: ActiveFileLike | null; selection: SelectionInfo | null }

function formatNs(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ms`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} µs`;
  return `${value.toFixed(2)} ns`;
}

function makeCase(activeFile: ActiveFileLike, selection: SelectionInfo | null, index: number): PerformanceCase | null {
  const body = (selection?.text ?? activeFile.content).trim();
  if (!body) return null;
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `case-${Date.now()}-${index}`;
  return {
    id, label: `Case ${String.fromCharCode(65 + (index % 26))}`, sourceLabel: activeFile.relPath, body, sourceSnapshot: body,
    ...(selection ? { sourceRef: { relPath: activeFile.relPath, startLine: selection.startLine, startCol: selection.startCol, endLine: selection.endLine, endCol: selection.endCol } } : {})
  };
}

function exportJson(results: readonly PerformanceRunResult[], cases: readonly PerformanceCase[]): void {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), cases, results }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `runtimehell-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click(); URL.revokeObjectURL(url);
}

function targetTitle(target: PerformanceTargetOption): string {
  return `${target.label} · ${target.engineId ?? 'engine unknown'}`;
}

export function PerformancePanel({ activeFile, selection }: PerformancePanelProps): React.JSX.Element {
  const state = usePerformance();
  useEffect(() => { void usePerformance.getState().refreshCatalog(); }, []);

  const selectedTargets = useMemo(() => (state.catalog?.targets ?? []).filter((target) => (state.selectedProfiles[performanceTargetKey(target)]?.length ?? 0) > 0), [state.catalog, state.selectedProfiles]);
  const groupCount = selectedTargets.reduce((sum, target) => sum + (state.selectedProfiles[performanceTargetKey(target)]?.length ?? 0), 0);
  const cellCount = groupCount * state.cases.length;
  const workload = cellCount * state.measurement.samples * state.measurement.iterationsPerSample;
  const canAdd = activeFile !== null && Boolean((selection?.text ?? activeFile.content).trim()) && state.cases.length < 12 && !state.running;

  const addCase = (): void => {
    if (!activeFile) return;
    const item = makeCase(activeFile, selection, state.cases.length);
    if (item) state.addCase(item);
  };
  const setSetup = (): void => {
    if (!activeFile) return;
    const value = (selection?.text ?? activeFile.content).trim();
    if (value) state.setSetup(value);
  };

  return <div className="rh-perf">
    <InstrumentFrame index="PERF" title="EXPERIMENT" metadata={`${state.cases.length} CASES / ${groupCount} GROUPS / ${cellCount} CELLS`} state={state.running ? 'focused' : 'active'} actions={<>
      <Button onClick={setSetup} disabled={!canAdd}>set shared setup</Button>
      <Button onClick={addCase} disabled={!canAdd}>add selection</Button>
      <Button variant="primary" onClick={() => void state.run()} disabled={state.running || state.cases.length === 0 || groupCount === 0}>run experiment</Button>
      {state.running && <Button variant="danger" onClick={() => void state.cancel()}>cancel</Button>}
    </>}>
      <div className="rh-perf-builder">
        <section className="rh-perf-section">
          <div className="rh-perf-section-title"><span>WHAT · CASES</span><span>{state.cases.length}/12</span></div>
          {state.cases.length === 0 && <EmptyState title="Add benchmark cases" detail="Select code in the source editor. One-case experiments are supported." />}
          <div className="rh-perf-cases">
            {state.cases.map((item, index) => <div className="rh-perf-case" key={item.id}>
              <span className="rh-perf-case-index">{String.fromCharCode(65 + index)}</span>
              <input aria-label={`Case ${index + 1} label`} value={item.label} disabled={state.running} onChange={(event) => state.renameCase(item.id, event.target.value)} />
              <span className="rh-perf-case-source" title={item.body}>{item.sourceRef ? `${item.sourceRef.relPath}:${item.sourceRef.startLine}` : item.sourceLabel ?? 'snapshot'}</span>
              <span className="rh-perf-case-code" title={item.body}>{item.body.replace(/\s+/g, ' ')}</span>
              <Button onClick={() => state.removeCase(item.id)} disabled={state.running}>remove</Button>
            </div>)}
          </div>
          <div className={`rh-perf-setup ${state.setup ? 'is-set' : ''}`}>
            <span>SHARED SETUP</span>
            <code title={state.setup}>{state.setup ? state.setup.replace(/\s+/g, ' ') : 'not set · setup is excluded from measurement'}</code>
            {state.setup && <Button onClick={state.clearSetup} disabled={state.running}>clear</Button>}
          </div>
        </section>

        <section className="rh-perf-section">
          <div className="rh-perf-section-title"><span>WHERE × HOW · TARGETS / PROFILES</span><span>{groupCount} process groups</span></div>
          {state.loadingCatalog && <div className="rh-perf-muted">probing installed runtimes and V8 flags…</div>}
          {!state.loadingCatalog && (state.catalog?.targets.length ?? 0) === 0 && <EmptyState title="No benchmark targets" detail="Install a runtime in the Runtimes tool." />}
          <div className="rh-perf-targets">
            {(state.catalog?.targets ?? []).map((target) => {
              const key = performanceTargetKey(target);
              const selected = state.selectedProfiles[key] ?? [];
              return <div className={`rh-perf-target ${selected.length ? 'is-selected' : ''} ${target.available ? '' : 'is-disabled'}`} key={key}>
                <label className="rh-perf-target-head" title={target.reason ?? targetTitle(target)}>
                  <input type="checkbox" checked={selected.length > 0} disabled={state.running || !target.available} onChange={() => state.toggleTarget(target)} />
                  <strong>{target.label}</strong><span>{target.engineId ?? '—'}</span>
                </label>
                {target.reason && <div className="rh-perf-target-reason">{target.reason}</div>}
                <div className="rh-perf-profiles">
                  {target.profiles.map((profile) => <label key={profile.id} title={profile.description} className={profile.available ? '' : 'is-disabled'}>
                    <input type="checkbox" checked={selected.includes(profile.id)} disabled={state.running || !target.available || !profile.available} onChange={() => state.toggleProfile(target, profile.id)} />
                    <span>{profile.label}</span><small>{profile.classification}</small>
                  </label>)}
                </div>
              </div>;
            })}
          </div>
        </section>

        <section className="rh-perf-section rh-perf-settings">
          <div className="rh-perf-section-title"><span>MEASUREMENT</span><span>{workload.toLocaleString()} planned operations</span></div>
          <div className="rh-perf-presets">
            {(['quick', 'reliable', 'cold', 'steady'] as const).map((preset) => <Button key={preset} onClick={() => state.applyPreset(preset)} disabled={state.running}>{preset}</Button>)}
          </div>
          <label>samples<input type="number" min={3} max={200} value={state.measurement.samples} disabled={state.running} onChange={(event) => state.setMeasurement({ samples: Math.max(3, Math.min(200, Number(event.target.value) || 3)) })} /></label>
          <label>warmup rounds<input type="number" min={0} max={10_000} value={state.measurement.warmupRounds} disabled={state.running} onChange={(event) => state.setMeasurement({ warmupRounds: Math.max(0, Math.min(10_000, Number(event.target.value) || 0)) })} /></label>
          <label>cycles / sample<input type="number" min={1} max={10_000_000} value={state.measurement.iterationsPerSample} disabled={state.running} onChange={(event) => state.setMeasurement({ iterationsPerSample: Math.max(1, Math.min(10_000_000, Number(event.target.value) || 1)) })} /></label>
          <label>timeout ms<input type="number" min={1_000} max={600_000} value={state.measurement.timeoutMs} disabled={state.running} onChange={(event) => state.setMeasurement({ timeoutMs: Math.max(1_000, Math.min(600_000, Number(event.target.value) || 1_000)) })} /></label>
          <span className="rh-perf-isolation">isolation: fresh process per target/profile</span>
        </section>
      </div>
    </InstrumentFrame>

    <InstrumentFrame index="RUN" title="RESULT MATRIX" metadata={state.running ? `${state.completedGroups}/${state.totalGroups} · ${state.progress}` : state.progress} state={Object.keys(state.errors).length ? 'error' : state.running ? 'focused' : 'idle'} actions={<>
      {state.results.length > 0 && <Button onClick={() => exportJson(state.results, state.cases)} disabled={state.running}>export JSON</Button>}
      {(state.results.length > 0 || Object.keys(state.errors).length > 0) && <Button onClick={state.clearResults} disabled={state.running}>clear results</Button>}
    </>}>
      {Object.entries(state.errors).map(([key, message]) => <div className="rh-perf-error" key={key}><strong>{key}</strong><span>{message}</span></div>)}
      {state.results.length === 0 && Object.keys(state.errors).length === 0 && <div className="rh-perf-muted">No measurements yet. Each row will represent one target/profile process.</div>}
      {state.results.length > 0 && <div className="rh-perf-matrix-wrap"><table className="rh-perf-matrix">
        <thead><tr><th>target / profile</th>{state.cases.map((item) => <th key={item.id}>{item.label}<small>median ns/op</small></th>)}</tr></thead>
        <tbody>{state.results.map((group) => <tr key={group.groupId}>
          <th><strong>{group.environment.runtimeId} {group.environment.runtimeVersion}</strong><span>{group.profile.label ?? group.profile.id}</span><small>{group.environment.engineId} {group.environment.engineVersion ?? '—'}</small></th>
          {state.cases.map((item) => {
            const result = group.results.find((candidate) => candidate.caseId === item.id);
            const comparison = group.comparisons.find((candidate) => candidate.candidateCaseId === item.id);
            return <td key={item.id} className={comparison?.significance === 'candidate-faster' ? 'is-faster' : comparison?.significance === 'baseline-faster' ? 'is-slower' : ''}>
              {result ? <><strong>{formatNs(result.metrics.medianNsPerOp)}</strong><span>{result.metrics.throughput.toFixed(0)} ops/s</span>{comparison && <small>{comparison.percentChange > 0 ? '+' : ''}{comparison.percentChange.toFixed(1)}% · {comparison.significance.replaceAll('-', ' ')}</small>}{result.warnings.map((warning) => <small className="is-warning" title={warning.code} key={warning.code}>⚠ {warning.message}</small>)}</> : '—'}
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>}
      {state.results.map((group) => <details className="rh-perf-details" key={`${group.groupId}:details`}><summary>{group.environment.runtimeId} {group.environment.runtimeVersion} / {group.profile.label ?? group.profile.id} · raw details</summary><div><code>{group.environment.executable} {group.environment.flags.join(' ')}</code>{group.results.map((item) => <span key={item.caseId}>{item.label}: mean {formatNs(item.metrics.meanNsPerOp)}, p95 {formatNs(item.metrics.p95NsPerOp)}, p99 {formatNs(item.metrics.p99NsPerOp)}, σ {formatNs(item.metrics.stddevNsPerOp)}, {item.metrics.sampleCount} samples</span>)}</div></details>)}
    </InstrumentFrame>

    <div className="rh-perf-footer"><Button onClick={state.clearExperiment} disabled={state.running}>reset experiment</Button><span>Definitions and the last result matrix persist across tool switches and app restarts.</span></div>
  </div>;
}
