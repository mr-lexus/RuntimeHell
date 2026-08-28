import { useEffect, useMemo, useState } from 'react';
import type { AnalysisType, EngineCapabilities } from '@rh/protocol';
import { useRef } from 'react';
import type { SelectionInfo } from '../../editor/selection-service';
import { scanFunctions, type ScannedFunction } from '../../editor/scan-functions';
import { ANALYSIS_ALL_TYPES, useAnalysis, type TypeState } from '../../state/analysis';
import { ResultViewer } from './ResultViewer';

const TYPE_LABEL: Record<AnalysisType, string> = {
  ast: 'AST',
  bytecode: 'Bytecode',
  optcode: 'Optimized code',
  'ir-graph': 'IR graph',
  deopts: 'Deopts',
  gc: 'GC'
};

// Protocol capability names are intentionally descriptive, while the panel
// actions use compact analysis ids. Keep the mapping explicit so an engine
// that lacks (for example) bytecodeDump is disabled before a request is sent.
const CAPABILITY_FOR_TYPE: Record<AnalysisType, keyof Omit<EngineCapabilities, 'notes'>> = {
  ast: 'astDump',
  bytecode: 'bytecodeDump',
  optcode: 'optCodeDisasm',
  'ir-graph': 'irGraphDump',
  deopts: 'deoptTrace',
  gc: 'gcLog'
};

function statusColor(s: TypeState): string {
  if (s.status === 'running') return 'var(--warn)';
  if (s.status === 'done') return 'var(--ok)';
  if (s.status === 'unsupported') return 'var(--text-faint)';
  if (s.status === 'error') return 'var(--err)';
  return 'var(--text-dim)';
}

/** Stable identity for a scanned function — survives re-scans while the span is unchanged. */
function functionKey(f: ScannedFunction): string {
  return `${f.startOffset}:${f.endOffset}`;
}

/** Compact picker label, e.g. "function sum", "const double = () => {}", "(anonymous)". */
function describeFunction(f: ScannedFunction): string {
  switch (f.kind) {
    case 'declaration':
      return `function ${f.name}`;
    case 'arrow':
      return f.name === '(anonymous)' ? f.name : `const ${f.name} = () => {}`;
    case 'expression':
      return f.name === '(anonymous)' ? f.name : `function ${f.name}`;
    case 'iife':
      return '(IIFE)';
  }
}

/**
 * Analysis drawer (plan todo 19): raw-first per-type results with
 * capability-aware actions. The selected engine gates the buttons; the
 * backend probe re-verifies before spawning.
 */
export function AnalysisPanel({ code, selection, lang, onLoadDemo }: { code: string; selection: SelectionInfo | null; lang: 'js' | 'ts'; onLoadDemo: () => void }): React.JSX.Element {
  const state = useAnalysis();
  const [showWrapper, setShowWrapper] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState<ScannedFunction | null>(null);
  const functions = useMemo(() => scanFunctions(code), [code]);
  const selected = state.engines.find((e) => e.id === state.engineId);
  const caps = selected?.capabilities ?? null;

  useEffect(() => {
    void state.refreshEngines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Code changed → re-scan happened; drop the selection if its span vanished.
  useEffect(() => {
    if (selectedFunction === null) return;
    const stillThere = functions.some(
      (f) =>
        f.name === selectedFunction.name &&
        f.startOffset === selectedFunction.startOffset &&
        f.endOffset === selectedFunction.endOffset
    );
    if (!stillThere) setSelectedFunction(null);
  }, [functions, selectedFunction]);

  // Keep the last explicit scope so changing the function selector reruns the
  // same analysis set. Automatic tab analysis starts with the full set.
  const [lastAnalysisTypes, setLastAnalysisTypes] = useState<AnalysisType[]>([...ANALYSIS_ALL_TYPES]);
  const previousSelectedFunctionRef = useRef<ScannedFunction | null>(selectedFunction);

  // When the function selector changes, immediately recalculate its results.
  useEffect(() => {
    if (previousSelectedFunctionRef.current === selectedFunction) return;
    previousSelectedFunctionRef.current = selectedFunction;
    if (state.requestId !== null) return; // don't interrupt running analysis
    runAnalysis(lastAnalysisTypes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFunction]);

  const runAnalysis = (types: AnalysisType[]): void => {
    setLastAnalysisTypes(types);
    if (selectedFunction !== null) {
      const syntheticSelection: SelectionInfo = {
        text: selectedFunction.text,
        startLine: selectedFunction.startLine,
        startCol: 1,
        endLine: selectedFunction.endLine,
        endCol: 1,
        kind: selectedFunction.kind === 'arrow' || selectedFunction.kind === 'expression' ? 'expression' : 'function'
      };
      const focusName = selectedFunction.name !== '(anonymous)' && selectedFunction.name !== '(IIFE)' ? selectedFunction.name : null;
      const needsExecution = types.some((type) => type === 'optcode' || type === 'ir-graph' || type === 'deopts' || type === 'gc');
      state.requestFromSelection(syntheticSelection, code, types, needsExecution, lang, focusName);
      return;
    }
    state.requestFromSelection(selection, code, types, false, lang);
  };

  const supportedCount = selected !== undefined && caps !== null
    ? ANALYSIS_ALL_TYPES.filter((type) => caps[CAPABILITY_FOR_TYPE[type]] === true).length
    : 0;

  return (
    <div className="rh-analysis-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)', minHeight: 0 }}>
      <div className="rh-analysis-controls">
        <label>
          engine:{' '}
          <select
            value={state.engineId}
            onChange={(e) => state.setEngine(e.target.value as 'v8' | 'd8-debug')}
            className="rh-panel-input"
          >
            {state.engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id}@{e.version ?? 'not installed'}
                {e.binaryPath !== null ? '' : ' (missing)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rh-analysis-controls">
        <button className="rh-analysis-action" onClick={onLoadDemo} disabled={state.requestId !== null} title="Open a V8 workload with warmup, optimization, deoptimization and allocations">
          load analysis demo
        </button>
        <button className="rh-analysis-action" onClick={() => runAnalysis([...ANALYSIS_ALL_TYPES])} disabled={state.requestId !== null || supportedCount === 0} title="Run AST, bytecode, optimized code, IR graph, deopts and GC">
          run all
        </button>
      </div>

      <div className="rh-analysis-controls">
        <label>
          function:{' '}
          <select
            value={selectedFunction !== null ? functionKey(selectedFunction) : ''}
            disabled={state.requestId !== null}
            onChange={(e) => {
              const key = e.target.value;
              setSelectedFunction(key === '' ? null : functions.find((f) => functionKey(f) === key) ?? null);
            }}
            className="rh-panel-input"
          >
            <option value="">whole file (module)</option>
            {functions.map((f) => (
              <option key={functionKey(f)} value={functionKey(f)}>
                line {f.startLine}: {describeFunction(f)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rh-analysis-actions">
        {ANALYSIS_ALL_TYPES.map((type) => {
          const t = state.types[type];
          const capKey = CAPABILITY_FOR_TYPE[type];
          const supported = selected !== undefined && caps !== null && caps[capKey] === true;
          const tooltip = !supported
            ? `unsupported by this binary — ${selected?.reason ?? 'capability unavailable or engine not installed'}`
            : '';
          return (
            <button
              key={type}
              title={tooltip}
              disabled={state.requestId !== null || !supported}
              onClick={() => runAnalysis([type])}
              className={`rh-analysis-action ${t.status === 'running' ? 'is-running' : ''}`}
            >
              {TYPE_LABEL[type]}
              {t.status === 'running' ? '…' : ''}
            </button>
          );
        })}
        {state.requestId !== null && (
          <button className="rh-analysis-action is-cancel" onClick={() => void state.cancel()}>
            cancel
          </button>
        )}
      </div>

      {state.lastError !== null && <div className="rh-analysis-notice is-error">{state.lastError}</div>}
      {state.cancelledNotice && <div className="rh-analysis-notice is-warning">analysis cancelled</div>}

      {state.generatedCode !== null && (
        <div>
          <label style={{ color: '#888', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input className="rh-native-checkbox" type="checkbox" checked={showWrapper} onChange={(e) => setShowWrapper(e.target.checked)} /> show
            generated wrapper
          </label>
          {showWrapper && (
            <pre className="rh-analysis-generated">
              {state.generatedCode}
            </pre>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0 }}>
        {ANALYSIS_ALL_TYPES.filter((t) => state.types[t].status !== 'idle').map((type) => {
          const t = state.types[type];
          return (
            <div key={type} className="rh-analysis-result">
              <div className="rh-analysis-result-header">
                <strong style={{ color: statusColor(t) }}>{TYPE_LABEL[type]}</strong>
                <span className="rh-analysis-result-meta">
                  {t.result !== null &&
                    `${t.result.engine}@${t.result.engineVersion} · ${t.result.metadata.durationMs}ms`}
                </span>
              </div>
              {t.status === 'running' && <div className="rh-analysis-notice is-warning">running…</div>}
              {t.status === 'unsupported' && <div className="rh-analysis-notice is-error">unsupported — {t.reason}</div>}
              {t.status === 'error' && <div className="rh-analysis-notice is-error">{t.reason}</div>}
              {t.result !== null && <ResultViewer result={t.result} focusFunction={state.focusFunction} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
