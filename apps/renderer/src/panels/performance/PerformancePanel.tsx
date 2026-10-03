import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PerformanceCase, PerformanceCaseResult, PerformanceRunResult } from '@rh/protocol';
import type { SelectionInfo } from '../../editor/selection-service';
import { Button, EmptyState, InstrumentFrame } from '../../ui/primitives';
import { PerformanceStatus } from './PerformanceStatus';
import { PerformanceControls } from './PerformanceControls';
import { usePerformance } from '../../state/performance';
import { useUi } from '../../state/ui';

interface ActiveFileLike { id?: string; relPath: string; content: string; language: string }
interface PerformancePanelProps { activeFile: ActiveFileLike | null; selection: SelectionInfo | null }

function formatNs(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ms`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} µs`;
  return `${value.toFixed(2)} ns`;
}

function caseLetter(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function makeCase(activeFile: ActiveFileLike, selection: SelectionInfo | null, index: number): PerformanceCase | null {
  const body = (selection?.text ?? activeFile.content).trim();
  if (!body) return null;
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `case-${Date.now()}-${index}`;
  const lines = activeFile.content.split(/\r?\n/);
  const lastLine = Math.max(1, lines.length);
  const fileRange = { ...(activeFile.id ? { fileId: activeFile.id } : {}), relPath: activeFile.relPath, startLine: 1, startCol: 1, endLine: lastLine, endCol: (lines[lastLine - 1]?.length ?? 0) + 1 };
  return {
    id, label: `Case ${caseLetter(index)}`, sourceLabel: activeFile.relPath, body, mode: /\bawait\b/.test(body) ? 'async' : 'sync', sourceSnapshot: body,
    sourceMode: selection ? 'selection' : 'file', sourceRef: selection ? { ...(activeFile.id ? { fileId: activeFile.id } : {}), relPath: activeFile.relPath, startLine: selection.startLine, startCol: selection.startCol, endLine: selection.endLine, endCol: selection.endCol } : fileRange
  };
}

function exportJson(results: readonly PerformanceRunResult[], cases: readonly PerformanceCase[]): void {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), cases, results }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `runtimehell-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click(); URL.revokeObjectURL(url);
}

function groupLabel(group: PerformanceRunResult): string {
  return `${group.environment.runtimeId} ${group.environment.runtimeVersion} / ${group.profile.label ?? group.profile.id}`;
}

function caseResult(group: PerformanceRunResult, caseId: string): PerformanceCaseResult | undefined {
  return group.results.find((item) => item.caseId === caseId);
}

function percentDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}


function PerformanceChart({ results, cases }: { results: readonly PerformanceRunResult[]; cases: readonly PerformanceCase[] }): React.JSX.Element | null {
  const rows = results.flatMap((group) => cases.map((item, index) => {
    const result = caseResult(group, item.id);
    return result === undefined ? null : { group, item, result, index };
  })).filter((item): item is { group: PerformanceRunResult; item: PerformanceCase; result: PerformanceCaseResult; index: number } => item !== null);
  const max = Math.max(...rows.map((row) => row.result.metrics.medianNsPerOp), 0);
  if (rows.length === 0 || max <= 0) return null;
  return <section className="rh-perf-chart" aria-label="Median benchmark chart">
    <div className="rh-perf-chart-head"><strong>MEDIAN TIME / OPERATION</strong><span>shorter bars are faster</span></div>
    <div className="rh-perf-chart-legend">{cases.map((item, index) => <span key={item.id}><i className={`is-case-${index % 2}`} />{item.label}</span>)}</div>
    <div className="rh-perf-chart-rows">
      {rows.map((row) => {
        const value = row.result.metrics.medianNsPerOp;
        const width = Math.max(2, Math.min(100, (value / max) * 100));
        return <div className="rh-perf-chart-row" key={`${row.group.groupId}:${row.item.id}`}>
          <span className="rh-perf-chart-label" title={`${groupLabel(row.group)} · ${row.item.label}`}>{groupLabel(row.group)} · {row.item.label}</span>
          <div className="rh-perf-chart-track"><div className="rh-perf-chart-grow"><span className={`is-case-${row.index % 2}`} style={{ transform: `scaleX(${width / 100})` }} /></div></div>
          <strong>{formatNs(value)}</strong>
        </div>;
      })}
    </div>
  </section>;
}

export function PerformancePanel({ activeFile, selection, active = true }: PerformancePanelProps & { active?: boolean }): React.JSX.Element {
  // Progress samples should update only the small status readout, not every
  // code card and result cell. These slices change at user/group boundaries.
  const state = usePerformance(useShallow(({
    cases, runTargets, results, running, outcome, finishedAt, catalog, loadingCatalog, errors, totalGroups,
    addCase, renameCase, setCaseMode, duplicateCase, removeCase, clearResults, refreshCatalog
  }) => ({
    cases, runTargets, results, running, outcome, finishedAt, catalog, loadingCatalog, errors, totalGroups,
    addCase, renameCase, setCaseMode, duplicateCase, removeCase, clearResults, refreshCatalog
  })));
  const files = useUi((current) => current.files);
  const [baselineGroupId, setBaselineGroupId] = useState<string>('');
  const [compactView, setCompactView] = useState<'cases' | 'results'>('cases');
  useEffect(() => { if (active) void usePerformance.getState().refreshCatalog(); }, [active]);
  useEffect(() => { if (state.running || state.outcome) setCompactView('results'); }, [state.running, state.outcome, state.finishedAt]);
  useEffect(() => {
    if (!state.results.some((item) => item.groupId === baselineGroupId)) setBaselineGroupId(state.results[0]?.groupId ?? '');
  }, [baselineGroupId, state.results]);

  const sourceText = (selection?.text ?? activeFile?.content ?? '').trim();
  const canCapture = activeFile !== null && Boolean(sourceText) && !state.running;
  const canAdd = canCapture;
  const baselineGroup = state.results.find((item) => item.groupId === baselineGroupId) ?? state.results[0];
  const baselineCase = state.cases[0];
  const fastest = useMemo(() => state.results.flatMap((group) => group.results.map((result) => ({ group, result }))).filter((item) => item.result.metrics.medianNsPerOp > 0).sort((a, b) => a.result.metrics.medianNsPerOp - b.result.metrics.medianNsPerOp)[0], [state.results]);
  const slowest = useMemo(() => state.results.flatMap((group) => group.results.map((result) => ({ group, result }))).filter((item) => item.result.metrics.medianNsPerOp > 0).sort((a, b) => b.result.metrics.medianNsPerOp - a.result.metrics.medianNsPerOp)[0], [state.results]);
  const spread = fastest && slowest ? ((slowest.result.metrics.medianNsPerOp / fastest.result.metrics.medianNsPerOp) - 1) * 100 : null;

  const addCase = (): void => {
    if (!activeFile) return;
    const item = makeCase(activeFile, selection, state.cases.length);
    if (item) state.addCase(item);
  };

  return <div className={`rh-perf is-${compactView}`}>
    <div className="rh-perf-toolbar">
    <div className="rh-perf-view-switch" role="group" aria-label="Performance sections">
      <button type="button" aria-pressed={compactView === 'cases'} className={compactView === 'cases' ? 'is-active' : ''} onClick={() => setCompactView('cases')}>
        Code samples <span>{state.cases.length}</span>
      </button>
      <button type="button" aria-pressed={compactView === 'results'} className={compactView === 'results' ? 'is-active' : ''} onClick={() => setCompactView('results')}>
        Results <span>{state.running ? 'running' : state.results.length}</span>
      </button>
    </div>
    <PerformanceControls files={files} />
    </div>
    <PerformanceStatus active={active} />
    <div className="rh-perf-scroll" key={compactView} tabIndex={0} role="region" aria-label={compactView === 'cases' ? 'Performance code samples' : 'Performance results'}>
    <InstrumentFrame className="rh-perf-cases-frame" index="PERF" title="CASES" showHeader={false} state={state.running ? 'focused' : 'active'}>
      <div className="rh-perf-builder">
        <section className="rh-perf-section">
         <div className="rh-perf-section-title"><span>{state.cases.length} samples × {state.runTargets.reduce((count, item) => count + item.profiles.length, 0)} runs</span><span className="rh-perf-section-actions"><Button onClick={addCase} disabled={!canAdd}>{selection ? 'Add selection' : 'Add file'}</Button></span></div>
          {state.cases.length === 0 && <EmptyState title="Compare code, not guesses" detail="1. Add a file or selection. 2. Choose runtimes. 3. Run comparison. Linked samples use your latest edits." />}
          {state.cases.length > 0 && <p className="rh-perf-guidance">Linked samples use the latest editor content when you run. Every runtime/profile measures every sample.</p>}
          <div className="rh-perf-cases">
            {state.cases.map((item, index) => {
              const linkedFile = item.sourceRef === undefined ? undefined : files.find((file) => (item.sourceRef?.fileId !== undefined && file.id === item.sourceRef.fileId) || file.relPath === item.sourceRef?.relPath);
              return <article className={`rh-perf-case ${item.body.trim() ? '' : 'is-invalid'}`} key={item.id}>
              <div className="rh-perf-case-head">
                <span className="rh-perf-case-index">{caseLetter(index)}</span>
                <input aria-label={`Case ${index + 1} label`} value={item.label} disabled={state.running} onChange={(event) => state.renameCase(item.id, event.target.value)} />
                <select aria-label={`${item.label} execution mode`} value={item.mode} disabled={state.running} onChange={(event) => state.setCaseMode(item.id, event.target.value as PerformanceCase['mode'])}>
                  <option value="sync">sync</option><option value="async">async / await</option>
                </select>
                <Button className="rh-perf-icon-button" aria-label={`Clone ${item.label}`} title="Clone case" onClick={() => state.duplicateCase(item.id)} disabled={state.running}>⧉</Button>
                <Button className="rh-perf-icon-button" aria-label={`Remove ${item.label}`} title="Remove case" onClick={() => state.removeCase(item.id)} disabled={state.running}>×</Button>
              </div>
              {item.sourceRef ? <div className="rh-perf-case-reference" title={item.sourceRef.relPath}>
                <span>{item.sourceMode === 'selection' ? `selection · ${linkedFile ? 'live' : 'snapshot'}` : `file · ${linkedFile ? 'live' : 'snapshot'}`}</span>
                <code>{item.sourceRef.relPath}</code>
                {item.sourceMode === 'selection' && <small>L{item.sourceRef.startLine}:{item.sourceRef.startCol}–L{item.sourceRef.endLine}:{item.sourceRef.endCol}</small>}
              </div> : <div className="rh-perf-case-reference is-missing"><span>source</span><code>link unavailable</code></div>}
              {!item.body.trim() && <small className="rh-perf-case-warning">Case code cannot be empty.</small>}
            </article>;
            })}
          </div>
        </section>

        {!state.loadingCatalog && state.errors.catalog && <div className="rh-loading-state is-error" role="alert"><span>{state.errors.catalog}</span><Button onClick={() => { void state.refreshCatalog(true); }}>Retry discovery</Button></div>}
        {!state.loadingCatalog && !state.errors.catalog && !state.catalog?.targets.some((target) => target.available) && <EmptyState title="No benchmark targets" detail="Install a runtime in the Runtimes tool." />}
      </div>
    </InstrumentFrame>

    <InstrumentFrame className="rh-perf-results-frame" index="RUN" title="COMPARISON" state={Object.keys(state.errors).length ? 'error' : state.running ? 'focused' : 'idle'} actions={<>
      {state.results.length > 0 && <Button onClick={() => exportJson(state.results, state.cases)} disabled={state.running}>export JSON</Button>}
      {(state.outcome || state.results.length > 0 || Object.keys(state.errors).length > 0) && <Button onClick={state.clearResults} disabled={state.running}>clear results</Button>}
    </>}>
      {Object.entries(state.errors).map(([key, message]) => <div className="rh-perf-error" key={key}><strong>{key}</strong><span>{message}</span></div>)}
      {state.results.length === 0 && Object.keys(state.errors).length === 0 && <div className="rh-perf-muted">{state.running ? 'Results appear as each runtime/profile finishes. You can stop at any time and keep completed measurements.' : 'No measurements yet. Add code samples, choose runtimes and run a comparison.'}</div>}
      {state.results.length > 0 && <div className="rh-perf-results-scroll">
        <div className="rh-perf-insights" aria-label="Performance summary">
          <div><small>FASTEST CELL</small><strong>{fastest ? formatNs(fastest.result.metrics.medianNsPerOp) : '—'}</strong><span>{fastest ? `${groupLabel(fastest.group)} · ${fastest.result.label}` : 'Run an experiment first'}</span></div>
          <div><small>SPREAD</small><strong>{spread === null ? '—' : percentDelta(spread)}</strong><span>{slowest && fastest ? `${formatNs(slowest.result.metrics.medianNsPerOp)} slowest → ${formatNs(fastest.result.metrics.medianNsPerOp)} fastest` : 'Across completed cells'}</span></div>
          <div><small>COMPLETED</small><strong>{state.results.length}/{state.totalGroups || state.results.length}</strong><span>{state.cases.length > 1 ? `${state.cases.length} cases · compared with ${baselineCase?.label ?? 'Code A'}` : 'runtime/profile comparison'}</span></div>
        </div>
        <PerformanceChart results={state.results} cases={state.cases} />
        <div className="rh-perf-compare-controls">
          <strong>COMPARE</strong>
           <span>{state.cases.length > 1 ? `${state.cases.length} cases · each vs ${baselineCase?.label ?? 'Code A'}` : 'same code across runtimes / profiles'}</span>
          {state.cases.length === 1 && <label>baseline runtime<select value={baselineGroup?.groupId ?? ''} onChange={(event) => setBaselineGroupId(event.target.value)}>{state.results.map((group) => <option value={group.groupId} key={group.groupId}>{groupLabel(group)}</option>)}</select></label>}
          <span>Negative delta is faster; positive delta is slower.</span>
        </div>
        <div className="rh-perf-matrix-wrap"><table className="rh-perf-matrix" style={{ minWidth: (state.cases.length + 1) * 164 }}>
           <thead><tr><th>runtime / profile</th>{state.cases.map((item, index) => <th key={item.id}>{item.label}<small>{index > 0 ? `delta vs ${baselineCase?.label ?? 'Code A'}` : 'median time / operation'}</small></th>)}</tr></thead>
          <tbody>{state.results.map((group) => <tr key={group.groupId} className={state.cases.length === 1 && group.groupId === baselineGroup?.groupId ? 'is-baseline-row' : ''}>
            <th><strong>{group.environment.runtimeId} {group.environment.runtimeVersion}</strong><span>{group.profile.label ?? group.profile.id}</span><small>{group.environment.engineId} {group.environment.engineVersion ?? '—'} · GC {group.environment.gcMode}</small></th>
            {state.cases.map((item, index) => {
              const result = caseResult(group, item.id);
              const baseline = state.cases.length > 1 ? caseResult(group, baselineCase?.id ?? '') : caseResult(baselineGroup ?? group, item.id);
              const isBaseline = state.cases.length > 1 ? index === 0 : group.groupId === baselineGroup?.groupId;
              const delta = result && baseline && baseline.metrics.medianNsPerOp > 0 && !isBaseline ? ((result.metrics.medianNsPerOp / baseline.metrics.medianNsPerOp) - 1) * 100 : null;
              const paired = state.cases.length > 1 && index > 0 ? group.comparisons.find((candidate) => candidate.candidateCaseId === item.id) : undefined;
              return <td key={item.id} className={isBaseline ? 'is-baseline' : delta !== null && delta < 0 ? 'is-faster' : delta !== null && delta > 0 ? 'is-slower' : ''}>
                {result ? <><strong>{formatNs(result.metrics.medianNsPerOp)}</strong><span>{result.metrics.throughput.toFixed(0)} ops/s</span>{isBaseline ? <small>baseline</small> : delta !== null && <small>{percentDelta(delta)}{paired ? ` · ${paired.significance.replaceAll('-', ' ')}` : ' · median ratio'}</small>}{result.warnings.map((warning) => <small className="is-warning" title={warning.code} key={warning.code}>⚠ {warning.message}</small>)}</> : '—'}
              </td>;
            })}
          </tr>)}</tbody>
        </table></div>
        {state.results.map((group) => <details className="rh-perf-details" key={`${group.groupId}:details`}><summary>{groupLabel(group)} · diagnostics</summary><div><code>{group.environment.executable} {group.environment.flags.join(' ')}</code><span>GC policy: {group.environment.gcMode}</span>{group.results.map((item) => <span key={item.caseId}>{item.label}: mean {formatNs(item.metrics.meanNsPerOp)}, p95 {formatNs(item.metrics.p95NsPerOp)}, p99 {formatNs(item.metrics.p99NsPerOp)}, σ {formatNs(item.metrics.stddevNsPerOp)}, {item.metrics.sampleCount} samples</span>)}</div></details>)}
      </div>}
    </InstrumentFrame>
    </div>
  </div>;
}
