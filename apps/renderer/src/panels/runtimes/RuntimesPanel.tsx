import { useEffect } from 'react';
import { useRuntimes, type RuntimeDetection } from '../../state/runtimes';
import { useRun } from '../../state/run';
import type { RuntimeCatalogEntry } from './runtime-catalog';

const MONO = "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace";
const HOVER_BG = 'rgba(255,255,255,0.04)';

/* ── shared styles (VSCode-dark palette via CSS variables) ─────────────── */

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
  margin: '14px 0 6px'
};

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 8
};

const CARD: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4
};

const dot = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
  boxShadow: `0 0 6px ${color}66`
});

const BADGE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  borderRadius: 2,
  padding: '0 4px',
  lineHeight: '14px'
};

const LINK: React.CSSProperties = {
  color: 'var(--result)',
  textDecoration: 'none',
  fontSize: 11,
  marginLeft: 'auto',
  flexShrink: 0
};

const BTN: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 2,
  padding: '1px 8px',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: MONO
};

const SUB_LABEL: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 11,
  marginTop: 8,
  marginBottom: 2
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '3px 0',
  borderBottom: '1px solid var(--border)',
  fontFamily: MONO,
  fontSize: 12
};

function pct(received: number, total: number | null): string {
  if (total === null || total === 0) return `${(received / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round((received / total) * 100)}%`;
}

/* ── card header shared by every entry ─────────────────────────────────── */

function CardHeader({ entry }: { entry: RuntimeCatalogEntry }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={dot(entry.color)} />
      <strong style={{ fontSize: 12, color: 'var(--text)' }}>{entry.name}</strong>
      <span style={BADGE}>{entry.engine}</span>
      {entry.version !== undefined && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>{entry.version}</span>
      )}
      <a href={entry.website} target="_blank" rel="noreferrer" style={LINK} title={entry.website}>
        site ↗
      </a>
    </div>
  );
}

/* ── generic catalog card (non-Node entries) ───────────────────────────── */

function CatalogCard({
  entry,
  detection
}: {
  entry: RuntimeCatalogEntry;
  detection: RuntimeDetection | undefined;
}): React.JSX.Element {
  return (
    <div
      style={CARD}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = HOVER_BG;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-panel)';
      }}
    >
      <CardHeader entry={entry} />
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{entry.description}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        {detection?.installed === true ? (
          <span style={{ color: 'var(--ok)', fontFamily: MONO }}>
            installed{detection.version !== undefined ? ` · ${detection.version}` : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>not detected on this system</span>
        )}
        {entry.detectCommand !== undefined && (
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>
            $ {entry.detectCommand}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Node.js card — full install / manage / select surface ─────────────── */

function NodeCard({ entry }: { entry: RuntimeCatalogEntry }): React.JSX.Element {
  const state = useRuntimes();
  const runPhase = useRun((s) => s.phase);
  const runtimeVersion = useRun((s) => s.runtimeVersion);

  const managed = state.installed.filter((e) => e.installedPath !== undefined);
  const installedVersions = new Set(managed.map((e) => e.version));

  return (
    <div style={{ ...CARD, gridColumn: '1 / -1' }}>
      <CardHeader entry={entry} />
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        {entry.description} Resolution order: managed selected version → system installation → offer download.
      </div>

      <div style={SUB_LABEL}>System</div>
      <div style={ROW}>
        {state.system !== null ? (
          <span>
            node v{state.system.version} <span style={{ color: 'var(--text-faint)' }}>— {state.system.exePath}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>not detected</span>
        )}
      </div>

      <div style={SUB_LABEL}>Managed installs</div>
      {managed.length === 0 && (
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>none yet — install a pinned LTS below</div>
      )}
      {managed.map((e) => (
        <div key={e.version} style={ROW}>
          <input
            type="radio"
            name="selected-runtime"
            checked={state.selectedVersion === e.version}
            onChange={() => state.select(e.version)}
          />
          <strong style={{ width: 90 }}>{e.version}</strong>
          <span style={{ color: 'var(--text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.installedPath}
          </span>
          {runtimeVersion === e.version && runPhase === 'running' && (
            <span style={{ color: 'var(--warn)' }}>in use — removal blocked</span>
          )}
          <button
            style={BTN}
            disabled={runPhase === 'running'}
            title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${e.version}`}
            onClick={() => void state.remove(e.version)}
          >
            remove
          </button>
        </div>
      ))}

      <div style={SUB_LABEL}>Available (nodejs.org)</div>
      {state.available.map((row) => {
        const installing = state.progress?.version === row.version;
        return (
          <div key={row.version} style={ROW}>
            <span style={{ width: 90 }}>
              v{row.version} {row.lts ? <span style={{ color: 'var(--result)' }}>LTS</span> : ''}
            </span>
            <span style={{ color: 'var(--text-faint)', flex: 1 }}>{row.date}</span>
            {installedVersions.has(row.version) ? (
              <span style={{ color: 'var(--ok)' }}>installed</span>
            ) : installing ? (
              <span style={{ color: 'var(--warn)' }}>
                {pct(state.progress?.receivedBytes ?? 0, state.progress?.totalBytes ?? null)}
              </span>
            ) : (
              <button style={BTN} disabled={state.progress !== null} onClick={() => void state.install(row.version)}>
                install
              </button>
            )}
          </div>
        );
      })}
      {!state.loading && state.available.length === 0 && state.availableError === null && (
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>no versions listed</div>
      )}
    </div>
  );
}

/* ── panel ─────────────────────────────────────────────────────────────── */

/**
 * Runtimes panel: a catalog of every known JS runtime and engine. Node.js is
 * the primary runtime and keeps its full managed-install surface; the rest are
 * informational entries with system-detection status (detection IPC pending).
 */
export function RuntimesPanel(): React.JSX.Element {
  const state = useRuntimes();

  useEffect(() => {
    void state.refresh().then(() => state.detectRuntimes());
    const off = state.bindEvents();
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtimes = state.catalog.filter((e) => e.category === 'runtime');
  const engines = state.catalog.filter((e) => e.category === 'engine');
  const polyfills = state.catalog.filter((e) => e.category === 'polyfill');
  const nodeEntry = runtimes.find((e) => e.id === 'node');

  return (
    <div style={{ fontSize: 12, color: 'var(--text)', paddingBottom: 8 }}>
      {state.notice !== null && <div style={{ color: 'var(--err)', marginBottom: 6 }}>{state.notice}</div>}
      {state.availableError !== null && (
        <div style={{ color: 'var(--warn)', marginBottom: 6 }}>index unavailable: {state.availableError}</div>
      )}

      <div style={{ ...SECTION_TITLE, marginTop: 0 }}>⚡ Runtimes</div>
      <div style={GRID}>
        {nodeEntry !== undefined && <NodeCard entry={nodeEntry} />}
        {runtimes
          .filter((e) => e.id !== 'node')
          .map((e) => (
            <CatalogCard key={e.id} entry={e} detection={state.detectionResults[e.id]} />
          ))}
      </div>

      <div style={SECTION_TITLE}>🔧 Engines</div>
      <div style={GRID}>
        {engines.map((e) => (
          <CatalogCard key={e.id} entry={e} detection={state.detectionResults[e.id]} />
        ))}
      </div>

      <div style={SECTION_TITLE}>📐 Standards &amp; Polyfills</div>
      <div style={GRID}>
        {polyfills.map((e) => (
          <CatalogCard key={e.id} entry={e} detection={state.detectionResults[e.id]} />
        ))}
      </div>
    </div>
  );
}
