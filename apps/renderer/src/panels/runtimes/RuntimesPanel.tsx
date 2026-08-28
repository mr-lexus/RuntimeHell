import { useEffect, useState } from 'react';
import type { RuntimeId } from '@rh/protocol';
import { useRuntimes, type RuntimeDetection } from '../../state/runtimes';
import { useRun } from '../../state/run';
import { usePackages } from '../../state/packages';
import type { RuntimeCatalogEntry } from './runtime-catalog';

const MONO = "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace";
const HOVER_BG = 'var(--bg-hover)';

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
  display: 'flex',
  flexDirection: 'column',
  gap: 0
};

const CARD: React.CSSProperties = {
  background: 'transparent',
  border: '0',
  borderTop: '1px solid var(--frame-weak)',
  padding: '10px 4px',
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
  boxShadow: 'none'
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

const SOURCE_BADGE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  borderRadius: 2,
  padding: '0 4px',
  lineHeight: '14px',
  border: '1px solid var(--border)'
};

/** Chip marking the runtime currently used to run code. */
const ACTIVE_BADGE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: 'var(--result)',
  border: '1px solid var(--result)',
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

/** Bordered chip for the "Default runtime" selector row. */
const DEFAULT_CHIP: React.CSSProperties = {
  ...BTN,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6
};

const DEFAULT_CHIP_ACTIVE: React.CSSProperties = {
  ...DEFAULT_CHIP,
  borderColor: 'var(--result)',
  color: 'var(--result)'
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

/* ── collapse state persistence (localStorage: rh.runtime.collapsed) ───── */

const COLLAPSE_KEY = 'rh.runtime.collapsed';

/**
 * Read persisted collapse state. Malformed JSON or a non-object value falls
 * back to `{}` (defaults then apply: installable runtimes expanded, the rest
 * collapsed). Non-boolean values are dropped defensively.
 */
function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'boolean') out[key] = value;
        }
        return out;
      }
    }
  } catch {
    /* storage unavailable or malformed — session-only defaults */
  }
  return {};
}

/* ── card header shared by every entry — click toggles collapse ────────── */

function CardHeader({
  entry,
  collapsed,
  onToggle,
  active = false
}: {
  entry: RuntimeCatalogEntry;
  collapsed: boolean;
  onToggle: () => void;
  /** Renders an "active" chip when this runtime currently runs code. */
  active?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="rh-runtime-card-header"
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      title={collapsed ? 'expand' : 'collapse'}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="rh-runtime-disclosure" aria-hidden="true">
        {collapsed ? '▸' : '▾'}
      </span>
      <span style={dot(entry.color)} />
      <strong style={{ fontSize: 12, color: 'var(--text)' }}>{entry.name}</strong>
      {active && <span style={ACTIVE_BADGE}>active</span>}
      <span style={BADGE}>{entry.engine}</span>
      {entry.version !== undefined && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>{entry.version}</span>
      )}
      <a
        href={entry.website}
        target="_blank"
        rel="noreferrer"
        style={{ ...LINK, marginLeft: 'auto' }}
        title={entry.website}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        site ↗
      </a>
    </div>
  );
}

/* ── workspace-local polyfill card ─────────────────────────────────────── */

function PolyfillCard({
  entry,
  collapsed,
  onToggle
}: {
  entry: RuntimeCatalogEntry;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const packageName = entry.packageName;
  const installed = usePackages((s) => (packageName === undefined ? undefined : s.installed[packageName]));
  const busy = usePackages((s) => s.busy);
  const refreshPackages = usePackages((s) => s.refresh);
  const installVersioned = usePackages((s) => s.installVersioned);
  const remove = usePackages((s) => s.remove);
  const [requestedVersion, setRequestedVersion] = useState('');

  useEffect(() => {
    if (packageName !== undefined) void refreshPackages();
  }, [packageName, refreshPackages]);

  return (
    <div style={CARD}>
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{entry.description}</div>
          {packageName === undefined ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
              reference only — this catalog entry has no installable package
            </div>
          ) : (
            <div style={{ ...ROW, flexWrap: 'wrap' }}>
              <span style={SOURCE_BADGE}>workspace-local</span>
              {installed !== undefined ? (
                <>
                  <strong>{packageName}</strong>
                  <span style={{ color: 'var(--ok)' }}>{installed}</span>
                  <span style={{ flex: 1 }} />
                  <button style={BTN} disabled={busy} onClick={() => void remove(packageName)}>
                    remove
                  </button>
                </>
              ) : (
                <>
                  <strong>{packageName}</strong>
                  <input
                    value={requestedVersion}
                    onChange={(event) => setRequestedVersion(event.target.value)}
                    placeholder="latest or exact version"
                    aria-label={`${entry.name} version`}
                    style={{ ...BTN, width: 150, boxSizing: 'border-box' }}
                    disabled={busy}
                  />
                  <button
                    style={BTN}
                    disabled={busy}
                    onClick={() => void installVersioned(packageName, requestedVersion.trim() || undefined)}
                  >
                    {busy ? 'installing…' : 'install locally'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── generic catalog card (non-installable entries) ────────────────────── */

function CatalogCard({
  entry,
  detection,
  collapsed,
  onToggle
}: {
  entry: RuntimeCatalogEntry;
  detection: RuntimeDetection | undefined;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const state = useRuntimes();
  const kind = entry.category === 'runtime' ? 'runtime' : 'engine';
  const imported = state.installed.find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.id === entry.id &&
      candidate.installedPath !== undefined
  );
  const [sourcePath, setSourcePath] = useState('');
  const [version, setVersion] = useState(entry.version ?? 'local');
  const busy = state.progress !== null;

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
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <>
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
          <div style={{ ...ROW, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span style={SOURCE_BADGE}>sandbox-local</span>
            {imported !== undefined ? (
              <>
                <span style={{ color: 'var(--ok)' }}>imported · v{imported.version}</span>
                <span style={{ color: 'var(--text-faint)', flex: 1, minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {imported.installedPath}
                </span>
                <button
                  type="button"
                  style={BTN}
                  disabled={busy}
                  onClick={() => void state.remove(kind, entry.id, imported.version)}
                >
                  remove
                </button>
              </>
            ) : (
              <>
                <input
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  placeholder="C:\\path\\to\\exe-or-folder"
                  aria-label={`${entry.name} local path`}
                  style={{ ...BTN, flex: 1, minWidth: 240, boxSizing: 'border-box' }}
                  disabled={busy}
                />
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="version"
                  aria-label={`${entry.name} local version`}
                  style={{ ...BTN, width: 110, boxSizing: 'border-box' }}
                  disabled={busy}
                />
                <button
                  type="button"
                  style={BTN}
                  disabled={busy || sourcePath.trim() === '' || version.trim() === ''}
                  onClick={() => void state.importLocal(kind, entry.id, sourcePath, version)}
                >
                  {busy ? 'copying…' : 'copy to sandbox'}
                </button>
              </>
            )}
          </div>
          <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>
            {imported === undefined
              ? 'No managed build is bundled for this entry. Select an existing Windows file or folder; it is copied under RuntimeHell cache.'
              : 'Stored in the RuntimeHell cache. This catalog entry has no execution adapter yet.'}
          </div>
        </>
      )}
    </div>
  );
}

/* ── installable runtime card — system / nvm / managed / available ─────── */

function RuntimeCard({
  entry,
  collapsed,
  onToggle
}: {
  entry: RuntimeCatalogEntry;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const state = useRuntimes();
  const runPhase = useRun((s) => s.phase);
  const runtimeVersion = useRun((s) => s.runtimeVersion);

  const id = entry.id;
  const system = state.systemRuntimes[id] ?? null;
  const nvm = id === 'node' ? state.nvm : null;
  const managed = state.installed.filter((e) => e.kind === 'runtime' && e.id === id && e.installedPath !== undefined);
  const installedVersions = new Set(managed.map((e) => e.version));
  const available = state.availableVersions[id] ?? [];
  const availableError = state.availableErrors[id] ?? null;
  const selected = state.selected[id] ?? null;
  const isActiveRuntime = state.activeRuntime === id;

  const radioName = `runtime-${id}`;
  const busy = state.progress !== null;

  return (
    <div
      style={{
        ...CARD,
        gridColumn: '1 / -1',
        ...(isActiveRuntime ? { border: '1px solid var(--result)' } : {})
      }}
    >
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} active={isActiveRuntime} />
      {!collapsed && (
        <>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        {entry.description} Auto uses global → local; choose a managed version to pin the sandbox.
      </div>

      {/* System (global) detection */}
      <div style={SUB_LABEL}>System</div>
      <div style={ROW}>
        <input
          type="radio"
          name={radioName}
          checked={selected === null}
          onChange={() => state.select(id, null)}
        />
        <span style={SOURCE_BADGE}>auto</span>
        <span>prefer global, then local fallback</span>
      </div>
      <div style={ROW}>
        <input
          type="radio"
          name={radioName}
          checked={selected === 'system'}
          disabled={system === null}
          onChange={() => state.select(id, 'system')}
        />
        {system !== null ? (
          <span>
            <span style={SOURCE_BADGE}>global</span>
            <span style={{ marginLeft: 6 }}>
              v{system.version} <span style={{ color: 'var(--text-faint)' }}>— {system.exePath}</span>
            </span>
          </span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>not detected on PATH</span>
        )}
      </div>

      {/* nvm-windows versions (Node only) */}
      {nvm !== null && (
        <>
          <div style={SUB_LABEL}>nvm-windows ({nvm.root})</div>
          {nvm.versions.map((v) => (
            <div key={v.version} style={ROW}>
              <input
                type="radio"
                name={radioName}
                checked={selected === `nvm:${v.version}`}
                onChange={() => state.select(id, `nvm:${v.version}`)}
              />
              <span style={SOURCE_BADGE}>nvm</span>
              <strong style={{ width: 90, marginLeft: 6 }}>v{v.version}</strong>
              {v.active && <span style={{ color: 'var(--result)' }}>active</span>}
              <span style={{ color: 'var(--text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v.exePath}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Managed installs */}
      <div style={SUB_LABEL}>Managed installs</div>
      {managed.length === 0 && (
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>none yet — install a version below</div>
      )}
      {managed.map((e) => (
        <div key={e.version} style={ROW}>
          <input
            type="radio"
            name={radioName}
            checked={selected === e.version}
            onChange={() => state.select(id, e.version)}
          />
          <span style={SOURCE_BADGE}>managed</span>
          <strong style={{ width: 90, marginLeft: 6 }}>v{e.version}</strong>
          <span style={{ color: 'var(--text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.installedPath}
          </span>
          {isActiveRuntime && runtimeVersion === e.version && runPhase === 'running' && (
            <span style={{ color: 'var(--warn)' }}>in use — removal blocked</span>
          )}
          <button
            style={BTN}
            disabled={runPhase === 'running'}
            title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${e.version}`}
            onClick={() => void state.remove('runtime', id, e.version)}
          >
            remove
          </button>
        </div>
      ))}

      {/* Available versions */}
      <div style={SUB_LABEL}>Available</div>
      {available.map((row) => {
      const installing = state.progress?.id === id && state.progress?.version === row.version;
        return (
          <div key={row.version} style={ROW}>
            <span style={{ width: 90 }}>
              v{row.version} {row.lts === true ? <span style={{ color: 'var(--result)' }}>LTS</span> : ''}
            </span>
            <span style={{ color: 'var(--text-faint)', flex: 1 }}>{row.date}</span>
            {installedVersions.has(row.version) ? (
              <span style={{ color: 'var(--ok)' }}>installed</span>
            ) : installing ? (
              <span style={{ color: 'var(--warn)' }}>
                {pct(state.progress?.receivedBytes ?? 0, state.progress?.totalBytes ?? null)}
              </span>
            ) : (
              <button style={BTN} disabled={busy} onClick={() => void state.install('runtime', id, row.version)}>
                install
              </button>
            )}
          </div>
        );
      })}
      {!state.loading && available.length === 0 && availableError === null && (
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>no versions listed</div>
      )}
      {availableError !== null && (
        <div style={{ color: 'var(--warn)', fontSize: 11 }}>index unavailable: {availableError}</div>
      )}
        </>
      )}
    </div>
  );
}

/* ── managed engine card — install, keep multiple versions, remove ─────── */

function EngineCard({
  entry,
  collapsed,
  onToggle
}: {
  entry: RuntimeCatalogEntry;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const state = useRuntimes();
  const runPhase = useRun((s) => s.phase);
  const [requestedVersion, setRequestedVersion] = useState('');
  const id = entry.id;
  const managed = state.installed.filter((e) => e.kind === 'engine' && e.id === id && e.installedPath !== undefined);
  const webkitRequirements = state.installed.find(
    (e) => e.kind === 'runtime-support' && e.id === 'webkit-requirements' && e.installedPath !== undefined
  );
  const busy = state.progress !== null;
  const installing = state.progress?.id === id;
  const canPinVersion = id === 'v8' || id === 'd8-debug';

  const install = (): void => {
    const version = requestedVersion.trim();
    void state.install('engine', id, canPinVersion && version !== '' ? version : undefined);
  };

  return (
    <div style={{ ...CARD, gridColumn: '1 / -1' }}>
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{entry.description}</div>

          {id === 'javascriptcore' && (
            <div style={{ ...ROW, color: webkitRequirements === undefined ? 'var(--text-faint)' : 'var(--ok)' }}>
              <span style={SOURCE_BADGE}>support</span>
              WebKitRequirements
              <span style={{ flex: 1 }} />
              {webkitRequirements === undefined ? 'installed automatically with JSC' : `ready · ${webkitRequirements.version}`}
            </div>
          )}

          <div style={SUB_LABEL}>Managed versions</div>
          {managed.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>none yet — install a version below</div>
          )}
          {managed.map((e) => (
            <div key={`${e.id}:${e.version}`} style={ROW}>
              <span style={SOURCE_BADGE}>managed</span>
              <strong style={{ width: 110, marginLeft: 6 }}>v{e.version}</strong>
              <span style={{ color: 'var(--text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.installedPath}
              </span>
              <button
                type="button"
                style={BTN}
                disabled={runPhase === 'running' || busy}
                title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${e.version}`}
                onClick={() => void state.remove('engine', id, e.version)}
              >
                remove
              </button>
            </div>
          ))}

          <div style={SUB_LABEL}>Install</div>
          <div style={{ ...ROW, borderBottom: 0, flexWrap: 'wrap' }}>
            {canPinVersion && (
              <input
                value={requestedVersion}
                onChange={(event) => setRequestedVersion(event.target.value)}
                placeholder="version (optional)"
                aria-label={`${entry.name} version`}
                style={{ ...BTN, width: 150, boxSizing: 'border-box' }}
                disabled={busy}
              />
            )}
            <button type="button" style={BTN} disabled={busy} onClick={install}>
              {installing
                ? `installing ${pct(state.progress?.receivedBytes ?? 0, state.progress?.totalBytes ?? null)}`
                : canPinVersion && requestedVersion.trim() !== ''
                  ? `install v${requestedVersion.trim()}`
                  : 'install latest'}
            </button>
            {!canPinVersion && <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>latest official build</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ── panel ─────────────────────────────────────────────────────────────── */

/** Run-capable runtimes offered in the "Default runtime" selector. */
const DEFAULT_RUNTIMES: readonly { id: RuntimeId; name: string }[] = [
  { id: 'node', name: 'Node.js' },
  { id: 'deno', name: 'Deno' },
  { id: 'bun', name: 'Bun' }
];

/**
 * Runtimes panel: a catalog of every known JS runtime and engine. Node, Deno,
 * and Bun are installable runtimes with the full system/nvm/managed/available
 * surface. Supported analysis engines use the same managed install/remove
 * surface so versions can be kept side by side.
 */
export function RuntimesPanel(): React.JSX.Element {
  const state = useRuntimes();

  // Collapse state persists across reloads. Default: installable runtimes
  // (node/deno/bun and supported engines) expanded, other cards collapsed.
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(loadCollapsed);

  const isCollapsed = (entry: RuntimeCatalogEntry): boolean =>
    collapsedMap[entry.id] ?? !entry.installable;

  const toggleCollapsed = (entry: RuntimeCatalogEntry): void => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [entry.id]: !(prev[entry.id] ?? !entry.installable) };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — session-only state */
      }
      return next;
    });
  };

  useEffect(() => {
    void state.refresh().then(() => state.detectRuntimes());
    const off = state.bindEvents();
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtimes = state.catalog.filter((e) => e.category === 'runtime');
  const engines = state.catalog.filter((e) => e.category === 'engine');
  const polyfills = state.catalog.filter((e) => e.category === 'polyfill');
  const installable = runtimes.filter((e) => e.installable);
  const informational = runtimes.filter((e) => !e.installable);
  const installableEngines = engines.filter((e) => e.installable);
  const informationalEngines = engines.filter((e) => !e.installable);

  return (
    <div style={{ fontSize: 12, color: 'var(--text)', paddingBottom: 8 }}>
      {state.notice !== null && <div style={{ color: 'var(--err)', marginBottom: 6 }}>{state.notice}</div>}

      {/* Default runtime: which runtime executes code (Ctrl+Enter / auto-run). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)'
          }}
        >
          Default runtime
        </span>
        {DEFAULT_RUNTIMES.map((r) => {
          const active = state.activeRuntime === r.id;
          const version = state.systemRuntimes[r.id]?.version;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={active}
              title={`run code with ${r.name}`}
              style={active ? DEFAULT_CHIP_ACTIVE : DEFAULT_CHIP}
              onClick={() => state.setActiveRuntime(r.id)}
            >
              {r.name}
              {version !== undefined && (
                <span style={{ color: active ? undefined : 'var(--text-faint)', fontSize: 10 }}>v{version}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={GRID}>
        {installable.map((e) => (
          <RuntimeCard key={e.id} entry={e} collapsed={isCollapsed(e)} onToggle={() => toggleCollapsed(e)} />
        ))}
        {informational.map((e) => (
          <CatalogCard
            key={e.id}
            entry={e}
            detection={state.detectionResults[e.id]}
            collapsed={isCollapsed(e)}
            onToggle={() => toggleCollapsed(e)}
          />
        ))}
      </div>

      <div style={SECTION_TITLE}>🔧 Engines</div>
      <div style={GRID}>
        {installableEngines.map((e) => (
          <EngineCard key={e.id} entry={e} collapsed={isCollapsed(e)} onToggle={() => toggleCollapsed(e)} />
        ))}
        {informationalEngines.map((e) => (
          <CatalogCard
            key={e.id}
            entry={e}
            detection={state.detectionResults[e.id]}
            collapsed={isCollapsed(e)}
            onToggle={() => toggleCollapsed(e)}
          />
        ))}
      </div>

      <div style={SECTION_TITLE}>📐 Standards &amp; Polyfills</div>
      <div style={GRID}>
        {polyfills.map((e) => (
          <PolyfillCard
            key={e.id}
            entry={e}
            collapsed={isCollapsed(e)}
            onToggle={() => toggleCollapsed(e)}
          />
        ))}
      </div>
    </div>
  );
}
