import { useEffect, useMemo, useState } from 'react';
import type { AnalysisType } from '@rh/protocol';
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

function statusColor(s: TypeState): string {
  if (s.status === 'running') return '#dcdcaa';
  if (s.status === 'done') return '#6a9955';
  if (s.status === 'unsupported') return '#777';
  if (s.status === 'error') return '#f48771';
  return '#888';
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
export function AnalysisPanel({ code, selection, lang }: { code: string; selection: SelectionInfo | null; lang: 'js' | 'ts' }): React.JSX.Element {
  const state = useAnalysis();
  const [showWrapper, setShowWrapper] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState<ScannedFunction | null>(null);
  const functions = useMemo(() => scanFunctions(code), [code]);
  const selected = state.engines.find((e) => e.id === state.engineId);
  const caps = selected?.capabilities ?? null;
  const doneTypes = ANALYSIS_ALL_TYPES.filter((t) => state.types[t].status === 'done');

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

  // Track the last analysis type run so function changes can auto-retrigger.
  const [lastAnalysisType, setLastAnalysisType] = useState<AnalysisType | null>(null);

  // When the function selector changes AND there are already-done results, auto-retrigger.
  useEffect(() => {
    if (lastAnalysisType === null) return;
    if (state.requestId !== null) return; // don't interrupt running analysis
    runAnalysis(lastAnalysisType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFunction]);

  const runAnalysis = (type: AnalysisType): void => {
    setLastAnalysisType(type);
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
      state.requestFromSelection(syntheticSelection, code, [type], false, lang, focusName);
      return;
    }
    state.requestFromSelection(selection, code, [type], false, lang);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#bbb', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>
          engine:{' '}
          <select
            value={state.engineId}
            onChange={(e) => state.setEngine(e.target.value as 'v8' | 'd8-debug')}
            style={{ background: '#111', color: '#ddd', border: '1px solid #333', fontSize: 12 }}
          >
            {state.engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id}@{e.version ?? 'not installed'}
                {e.binaryPath !== null ? '' : ' (missing)'}
              </option>
            ))}
          </select>
        </label>
        {caps !== null && (
          <span style={{ color: '#666' }}>
            {Object.entries(caps)
              .filter(([k, v]) => k !== 'notes' && v === true)
              .map(([k]) => k)
              .join(' · ') || 'no capabilities probed'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>
          function:{' '}
          <select
            value={selectedFunction !== null ? functionKey(selectedFunction) : ''}
            disabled={state.requestId !== null}
            onChange={(e) => {
              const key = e.target.value;
              setSelectedFunction(key === '' ? null : functions.find((f) => functionKey(f) === key) ?? null);
            }}
            style={{ background: '#111', color: '#ddd', border: '1px solid #333', fontSize: 12, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace" }}
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

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {ANALYSIS_ALL_TYPES.map((type) => {
          const t = state.types[type];
          const capKey = `${type}` as keyof typeof caps;
          const supported = caps === null ? true : caps[capKey] !== false;
          const tooltip = !supported ? `unsupported by this binary — ${selected?.reason ?? 'capability unavailable'}` : '';
          return (
            <button
              key={type}
              title={tooltip}
              disabled={state.requestId !== null}
              onClick={() => runAnalysis(type)}
              style={{
                background: t.status === 'running' ? '#3a3325' : '#2a2a2a',
                color: supported ? '#ccc' : '#555',
                border: 'none',
                padding: '3px 10px',
                cursor: state.requestId !== null ? 'wait' : 'pointer',
                fontSize: 11,
                textDecoration: supported ? 'none' : 'line-through'
              }}
            >
              {TYPE_LABEL[type]}
              {t.status === 'running' ? '…' : ''}
            </button>
          );
        })}
        {state.requestId !== null && (
          <button onClick={() => void state.cancel()} style={{ background: '#5a1d1d', color: '#f48771', border: 'none', padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
            cancel
          </button>
        )}
      </div>

      {state.lastError !== null && <div style={{ color: '#f48771' }}>{state.lastError}</div>}
      {state.cancelledNotice && <div style={{ color: '#dcdcaa' }}>analysis cancelled</div>}

      {state.generatedCode !== null && (
        <div>
          <label style={{ color: '#888', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={showWrapper} onChange={(e) => setShowWrapper(e.target.checked)} /> show
            generated wrapper
          </label>
          {showWrapper && (
            <pre
              style={{
                margin: 0,
                background: '#111',
                border: '1px solid #222',
                padding: 6,
                maxHeight: 160,
                overflow: 'auto',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                color: '#9cdcfe'
              }}
            >
              {state.generatedCode}
            </pre>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0 }}>
        {ANALYSIS_ALL_TYPES.filter((t) => state.types[t].status !== 'idle').map((type) => {
          const t = state.types[type];
          return (
            <div key={type} style={{ border: '1px solid #222', padding: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ color: statusColor(t) }}>{TYPE_LABEL[type]}</strong>
                <span style={{ color: '#666', fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 10 }}>
                  {t.result !== null &&
                    `${t.result.engine}@${t.result.engineVersion} · ${t.result.metadata.durationMs}ms`}
                </span>
              </div>
              {t.status === 'running' && <div style={{ color: '#dcdcaa' }}>running…</div>}
              {t.status === 'unsupported' && <div style={{ color: '#f48771' }}>unsupported — {t.reason}</div>}
              {t.status === 'error' && <div style={{ color: '#f48771' }}>{t.reason}</div>}
              {t.result !== null && <ResultViewer result={t.result} focusFunction={state.focusFunction} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
