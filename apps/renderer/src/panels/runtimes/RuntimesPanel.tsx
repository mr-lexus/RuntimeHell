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

const STACK: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%'
};

const CARD: React.CSSProperties = {
  background: 'transparent',
  border: '0',
  borderTop: '1px solid var(--frame-weak)',
  padding: '10px 4px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box'
};

const ICONS = {
  chevronRight: '\uf054',
  chevronDown: '\uf078',
  external: '\uf08e',
  play: '\uf04b',
  download: '\uf019',
  trash: '\uf1f8',
  copy: '\uf0c5',
  check: '\uf00c',
  info: '\uf129',
  wrench: '\uf0ad',
  versions: '\uf1b3',
  ruler: '\uf1d8'
} as const;

function RuntimeIcon({ glyph }: { glyph: string }): React.JSX.Element {
  return (
    <span className="rh-runtime-icon" aria-hidden="true">
      {glyph}
    </span>
  );
}

function RuntimeInfo({
  entry,
  version,
  path,
  source
}: {
  entry: RuntimeCatalogEntry;
  version: string;
  path: string | undefined;
  source: string;
}): React.JSX.Element {
  return (
    <details className="rh-runtime-info">
      <summary className="rh-runtime-info-trigger" title={`show ${entry.name} details`} aria-label={`show ${entry.name} details`}>
        <RuntimeIcon glyph={ICONS.info} />
      </summary>
      <div className="rh-runtime-info-popover" role="tooltip">
        <strong>{entry.name} · v{version}</strong>
        <span>{source}</span>
        <code>{path ?? 'path unavailable'}</code>
      </div>
    </details>
  );
}

/* Nerd Font Devicons are used where the bundled font has a stable brand mark.
 * The rest intentionally use compact monograms: an unknown glyph would render
 * as a tofu square and make the catalog look broken. */
const RUNTIME_MARKS: Readonly<Record<string, string>> = {
  node: '\ue718',
  deno: '\ue7c0',
  bun: '\ue76f',
  browser: 'WEB',
  firefox: '\uf269',
  txiki: 'TX',
  v8: 'V8',
  'd8-debug': 'V8',
  spidermonkey: 'SM',
  javascriptcore: 'JS',
  hermes: 'HM',
  quickjs: 'QJ',
  graaljs: 'GJ',
  chakra: 'CH',
  'moddable-xs': 'XS',
  'core-js': 'CJ',
  tc39: 'TC'
};

const RUNTIME_LOGO_ASSETS = import.meta.glob('../../assets/runtime-logos/*.{svg,png,webp,ico}', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Readonly<Record<string, string>>;

const RUNTIME_LOGO_ALIASES: Readonly<Record<string, readonly string[]>> = {
  node: ['node', 'nodejs'],
  browser: ['browser', 'chromium'],
  firefox: ['firefox', 'mozilla', 'gecko'],
  'd8-debug': ['d8-debug', 'd8', 'v8-debug', 'v8'],
  spidermonkey: ['spidermonkey', 'spider-monkey'],
  javascriptcore: ['javascriptcore', 'jsc', 'webkit'],
  'core-js': ['core-js', 'corejs'],
  tc39: ['tc39', 'tc-39']
};

function normalizeLogoName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function runtimeLogoAsset(id: string, variant?: 'dark' | 'light'): string | undefined {
  const names = RUNTIME_LOGO_ALIASES[id] ?? [id];
  return Object.entries(RUNTIME_LOGO_ASSETS).find(([path]) => {
    const fileName = path.replace(/\\/g, '/').split('/').pop() ?? '';
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const normalizedFileName = normalizeLogoName(baseName);
    return names.some((name) => {
      const normalizedName = normalizeLogoName(name);
      return variant === undefined
        ? normalizedName === normalizedFileName
        : `${normalizedName}${variant}` === normalizedFileName;
    });
  })?.[1];
}

function RuntimeLogo({ entry }: { entry: RuntimeCatalogEntry }): React.JSX.Element {
  const mark = RUNTIME_MARKS[entry.id] ?? entry.name.slice(0, 2).toUpperCase();
  const asset = runtimeLogoAsset(entry.id);
  const darkAsset = runtimeLogoAsset(entry.id, 'dark');
  const lightAsset = runtimeLogoAsset(entry.id, 'light');
  const isGlyph = mark.codePointAt(0)! >= 0xe000;
  const hasThemeAssets = darkAsset !== undefined && lightAsset !== undefined;
  if (asset !== undefined || hasThemeAssets) {
    return (
      <span
        className={`rh-runtime-logo is-asset${entry.id === 'core-js' ? ' is-theme-adaptive' : ''}`}
        title={`${entry.name} logo`}
        aria-label={`${entry.name} logo`}
        role="img"
      >
        {hasThemeAssets ? (
          <>
            <img className="rh-runtime-logo-theme is-dark" src={darkAsset} alt="" />
            <img className="rh-runtime-logo-theme is-light" src={lightAsset} alt="" />
          </>
        ) : (
          <img src={asset} alt="" />
        )}
      </span>
    );
  }
  return (
    <span
      className={`rh-runtime-logo${isGlyph ? ' is-glyph' : ' is-monogram'}`}
      style={{ color: entry.color }}
      title={`${entry.name} logo`}
      aria-label={`${entry.name} logo`}
      role="img"
    >
      {mark}
    </span>
  );
}

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

const ICON_BTN: React.CSSProperties = {
  ...BTN,
  display: 'inline-grid',
  placeItems: 'center',
  width: 25,
  height: 23,
  padding: 0,
  borderColor: 'transparent'
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
  active = false,
  summary = entry.description
}: {
  entry: RuntimeCatalogEntry;
  collapsed: boolean;
  onToggle: () => void;
  /** Renders an "active" chip when this runtime currently runs code. */
  active?: boolean;
  /** Optional compact summary rendered on the same line as the title. */
  summary?: string;
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
        <RuntimeIcon glyph={collapsed ? ICONS.chevronRight : ICONS.chevronDown} />
      </span>
      <RuntimeLogo entry={entry} />
      <strong style={{ fontSize: 12, color: 'var(--text)' }}>{entry.name}</strong>
      {active && <span style={ACTIVE_BADGE}><RuntimeIcon glyph={ICONS.check} /> active</span>}
      <span style={BADGE}>{entry.engine}</span>
      {entry.version !== undefined && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>{entry.version}</span>
      )}
      <span className="rh-runtime-card-summary" title={summary}>
        {summary}
      </span>
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
        <RuntimeIcon glyph={ICONS.external} /> site
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
          {packageName === undefined ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
              reference only — this catalog entry has no installable package
            </div>
          ) : (
            <div className="rh-runtime-inline-row">
              <span style={SOURCE_BADGE}>workspace-local</span>
              {installed !== undefined ? (
                <>
                  <strong>{packageName}</strong>
                  <span style={{ color: 'var(--ok)' }}>{installed}</span>
                  <button style={BTN} disabled={busy} onClick={() => void remove(packageName)}>
                    <RuntimeIcon glyph={ICONS.trash} /> remove
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
                    {busy ? 'installing…' : <><RuntimeIcon glyph={ICONS.download} /> install locally</>}
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
  const busy = Object.values(state.progress).some((progress) => progress.id === entry.id);
  const systemBrowser = state.systemBrowsers[entry.id] ?? null;

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
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} active={entry.id === 'browser' && state.activeRuntime === 'browser'} />
      {!collapsed && (
        <>
          {entry.id === 'browser' ? (
            <div className="rh-runtime-inline-row">
              <span style={SOURCE_BADGE}>built-in · always available</span>
              <span style={{ color: 'var(--ok)' }}>Chromium {typeof navigator !== 'undefined' ? navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'embedded' : 'embedded'}</span>
              <button
                type="button"
                style={state.activeRuntime === 'browser' ? DEFAULT_CHIP_ACTIVE : BTN}
                onClick={() => state.setActiveRuntime('browser')}
              >
                {state.activeRuntime === 'browser' ? <><RuntimeIcon glyph={ICONS.check} /> active runtime</> : <><RuntimeIcon glyph={ICONS.play} /> use for runs</>}
              </button>
            </div>
          ) : entry.id === 'firefox' ? (
            <div className="rh-runtime-inline-row">
              <span style={SOURCE_BADGE}>system browser</span>
              {systemBrowser !== null ? (
                <>
                  <span style={{ color: 'var(--ok)' }}>detected · v{systemBrowser.version}</span>
                  <RuntimeInfo entry={entry} version={systemBrowser.version} path={systemBrowser.exePath} source="desktop installation" />
                </>
              ) : (
                <span style={{ color: 'var(--text-faint)' }}>not detected on this system</span>
              )}
              <span className="rh-runtime-note" style={{ margin: 0 }}>
                Firefox uses Gecko and SpiderMonkey; it is not yet a selectable embedded runner in RuntimeHell.
              </span>
            </div>
          ) : (
            <>
          <div className="rh-runtime-meta-row">
            {detection?.installed === true ? (
              <span style={{ color: 'var(--ok)', fontFamily: MONO }}>
                installed{detection.version !== undefined ? ` · ${detection.version}` : ''}
              </span>
            ) : (
              <span style={{ color: 'var(--text-faint)' }}>not detected on this system</span>
            )}
            {entry.detectCommand !== undefined && (
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>
                $ {entry.detectCommand}
              </span>
            )}
          </div>
          <div className="rh-runtime-inline-row">
            <span style={SOURCE_BADGE}>sandbox-local</span>
            {imported !== undefined ? (
              <>
                <span style={{ color: 'var(--ok)' }}>imported · v{imported.version}</span>
                <span style={{ color: 'var(--text-faint)', maxWidth: 'min(360px, 42vw)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {imported.installedPath}
                </span>
                <button
                  type="button"
                  style={BTN}
                  disabled={busy}
                  onClick={() => void state.remove(kind, entry.id, imported.version)}
                >
                  <RuntimeIcon glyph={ICONS.trash} />
                </button>
              </>
            ) : (
              <>
                <input
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  placeholder="C:\\path\\to\\exe-or-folder"
                  aria-label={`${entry.name} local path`}
                  style={{ ...BTN, width: 'min(360px, 42vw)', minWidth: 220, boxSizing: 'border-box' }}
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
                  {busy ? 'copying…' : <><RuntimeIcon glyph={ICONS.copy} /> copy to sandbox</>}
                </button>
              </>
            )}
          </div>
          <div className="rh-runtime-note">
            {imported === undefined
              ? 'No managed build is bundled for this entry. Select an existing Windows file or folder; it is copied under RuntimeHell cache.'
              : 'Stored in the RuntimeHell cache. This catalog entry has no execution adapter yet.'}
          </div>
            </>
          )}
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
  const managedByVersion = new Map(managed.map((e) => [e.version, e]));
  const available = state.availableVersions[id] ?? [];
  const availableError = state.availableErrors[id] ?? null;
  const selected = state.selected[id] ?? null;
  const isActiveRuntime = state.activeRuntime === id;

  const radioName = `runtime-${id}`;

  return (
    <div
      style={{
        ...CARD,
        maxWidth: '100%',
        ...(isActiveRuntime ? { border: '1px solid var(--result)' } : {})
      }}
    >
      <CardHeader
        entry={entry}
        collapsed={collapsed}
        onToggle={onToggle}
        active={isActiveRuntime}
        summary={`${entry.description} · auto uses global → local`}
      />
      {!collapsed && (
        <>
      {/* System (global) detection */}
      <div style={SUB_LABEL}>System</div>
      <div className="rh-runtime-choice-stack">
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
            <strong style={{ marginLeft: 6 }}>v{system.version}</strong>
            <RuntimeInfo entry={entry} version={system.version} path={system.exePath} source="global · system PATH" />
          </span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>not detected on PATH</span>
        )}
      </div>
      </div>

      {/* nvm-windows versions (Node only) */}
      {nvm !== null && (
        <>
          <div style={SUB_LABEL}>nvm-windows ({nvm.root})</div>
          <div className="rh-runtime-version-grid">
          {nvm.versions.map((v) => (
              <div key={v.version} className={`rh-runtime-version-row${selected === `nvm:${v.version}` ? ' is-selected' : ''}`} style={ROW}>
              <input
                type="radio"
                name={radioName}
                checked={selected === `nvm:${v.version}`}
                onChange={() => state.select(id, `nvm:${v.version}`)}
              />
              <span style={SOURCE_BADGE}>nvm</span>
              <strong style={{ width: 90, marginLeft: 6 }}>v{v.version}</strong>
              {v.active && <span style={{ color: 'var(--result)' }}>active</span>}
              <RuntimeInfo entry={entry} version={v.version} path={v.exePath} source="nvm-windows" />
            </div>
          ))}
          </div>
        </>
      )}

      {/* Installed and available versions share one compact control surface. */}
      <div style={SUB_LABEL}><RuntimeIcon glyph={ICONS.versions} /> Versions</div>
      <div className="rh-runtime-catalog-grid">
        {available.map((row) => {
          const installed = managedByVersion.get(row.version);
          if (installed !== undefined) {
            const isSelected = selected === installed.version;
            const removalBlocked = isActiveRuntime && runtimeVersion === installed.version && runPhase === 'running';
            return (
              <div key={`managed:${installed.version}`} className={`rh-runtime-version-card is-managed${isSelected ? ' is-selected' : ''}`}>
                <div className="rh-runtime-version-main">
                  <input
                    type="radio"
                    name={radioName}
                    checked={isSelected}
                    onChange={() => state.select(id, installed.version)}
                  />
                  <strong>v{installed.version}</strong>
                  {isSelected && <span className="rh-runtime-version-active"><RuntimeIcon glyph={ICONS.check} /> active</span>}
                </div>
                <RuntimeInfo entry={entry} version={installed.version} path={installed.installedPath} source="RuntimeHell cache" />
                {removalBlocked && <span className="rh-runtime-version-status">in use — removal blocked</span>}
                <button
                  type="button"
                  className="rh-runtime-icon-button"
                  style={{ ...ICON_BTN, color: 'var(--err)' }}
                  disabled={runPhase === 'running'}
                  aria-label={`remove ${installed.version}`}
                  title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${installed.version}`}
                  onClick={() => void state.remove('runtime', id, installed.version)}
                >
                  <RuntimeIcon glyph={ICONS.trash} />
                </button>
              </div>
            );
          }

          const installingProgress = Object.values(state.progress).find(
            (progress) => progress.id === id && progress.version === row.version
          );
          const installing = installingProgress !== undefined;
          return (
            <div key={`available:${row.version}`} className="rh-runtime-version-card is-available">
              <div className="rh-runtime-version-main">
                <strong>v{row.version}</strong>
                {row.lts === true && <span className="rh-runtime-version-lts">LTS</span>}
                <span className="rh-runtime-version-date">{row.date}</span>
              </div>
              {installing ? (
                <span className="rh-runtime-version-progress">
                  {pct(installingProgress.receivedBytes, installingProgress.totalBytes)}
                </span>
              ) : (
                <button
                  type="button"
                  className="rh-runtime-icon-button"
                  style={{ ...ICON_BTN, color: 'var(--result)' }}
                  disabled={installing}
                  aria-label={`install ${entry.name} ${row.version}`}
                  title={`install ${entry.name} ${row.version}`}
                  onClick={() => void state.install('runtime', id, row.version)}
                >
                  <RuntimeIcon glyph={ICONS.download} />
                </button>
              )}
            </div>
          );
        })}
        {managed
          .filter((installed) => !available.some((row) => row.version === installed.version))
          .map((installed) => {
            const isSelected = selected === installed.version;
            const removalBlocked = isActiveRuntime && runtimeVersion === installed.version && runPhase === 'running';
            return (
              <div key={`managed:${installed.version}`} className={`rh-runtime-version-card is-managed${isSelected ? ' is-selected' : ''}`}>
                <div className="rh-runtime-version-main">
                  <input
                    type="radio"
                    name={radioName}
                    checked={isSelected}
                    onChange={() => state.select(id, installed.version)}
                  />
                  <strong>v{installed.version}</strong>
                  {isSelected && <span className="rh-runtime-version-active"><RuntimeIcon glyph={ICONS.check} /> active</span>}
                </div>
                <RuntimeInfo entry={entry} version={installed.version} path={installed.installedPath} source="RuntimeHell cache" />
                {removalBlocked && <span className="rh-runtime-version-status">in use — removal blocked</span>}
                <button
                  type="button"
                  className="rh-runtime-icon-button"
                  style={{ ...ICON_BTN, color: 'var(--err)' }}
                  disabled={runPhase === 'running'}
                  aria-label={`remove ${installed.version}`}
                  title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${installed.version}`}
                  onClick={() => void state.remove('runtime', id, installed.version)}
                >
                  <RuntimeIcon glyph={ICONS.trash} />
                </button>
              </div>
            );
          })}
      </div>
      {!state.loading && managed.length === 0 && available.length === 0 && availableError === null && (
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
  const installingProgress = Object.values(state.progress).find((progress) => progress.id === id);
  const busy = installingProgress !== undefined;
  const installing = busy;
  const canPinVersion = id === 'v8' || id === 'd8-debug';

  const install = (): void => {
    const version = requestedVersion.trim();
    void state.install('engine', id, canPinVersion && version !== '' ? version : undefined);
  };

  return (
    <div style={CARD}>
      <CardHeader entry={entry} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <>
          {id === 'javascriptcore' && (
            <div className="rh-runtime-inline-row" style={{ color: webkitRequirements === undefined ? 'var(--text-faint)' : 'var(--ok)' }}>
              <span style={SOURCE_BADGE}>support</span>
              WebKitRequirements
              {webkitRequirements === undefined ? 'installed automatically with JSC' : `ready · ${webkitRequirements.version}`}
            </div>
          )}

          <div style={SUB_LABEL}>Versions</div>
          {managed.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>none yet — install a version below</div>
          )}
          <div className="rh-runtime-managed-grid">
          {managed.map((e) => (
            <div key={`${e.id}:${e.version}`} className="rh-runtime-managed-row">
              <strong style={{ width: 110 }}>v{e.version}</strong>
              <RuntimeInfo entry={entry} version={e.version} path={e.installedPath} source="RuntimeHell cache" />
              <button
                type="button"
                className="rh-runtime-icon-button"
                style={{ ...ICON_BTN, color: 'var(--err)' }}
                disabled={runPhase === 'running' || busy}
                aria-label={`remove ${e.version}`}
                title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${e.version}`}
                onClick={() => void state.remove('engine', id, e.version)}
              >
                <RuntimeIcon glyph={ICONS.trash} />
              </button>
            </div>
          ))}
          </div>

          <div style={SUB_LABEL}>Install</div>
          <div className="rh-runtime-inline-row">
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
              {installing ? (
                `installing ${pct(installingProgress.receivedBytes, installingProgress.totalBytes)}`
              ) : canPinVersion && requestedVersion.trim() !== '' ? (
                <><RuntimeIcon glyph={ICONS.download} /> install v{requestedVersion.trim()}</>
              ) : (
                <><RuntimeIcon glyph={ICONS.download} /> install latest</>
              )}
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
  { id: 'bun', name: 'Bun' },
  { id: 'browser', name: 'Browser V8' }
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
          <RuntimeIcon glyph={ICONS.play} /> Default runtime
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

      <div style={STACK}>
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

      <div style={SECTION_TITLE}><RuntimeIcon glyph={ICONS.wrench} /> Engines</div>
      <div style={STACK}>
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

      <div style={SECTION_TITLE}><RuntimeIcon glyph={ICONS.ruler} /> Standards &amp; Polyfills</div>
      <div style={STACK}>
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
