import { useEffect, useRef, useState } from 'react';
import type { PkgSearchRow } from '@rh/protocol';
import { usePackages, useDebouncedSearch } from '../../state/packages';

const MONO = "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace";
const HOVER_BG = 'rgba(255,255,255,0.04)';
const WARN_BG = 'rgba(220,220,170,0.12)';

/* ── shared styles (VSCode-dark palette via CSS variables) ─────────────── */

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
  margin: '10px 0 4px'
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '4px 6px',
  fontFamily: MONO,
  fontSize: 12,
  borderRadius: 2
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

const BTN_DISABLED: React.CSSProperties = { opacity: 0.45, cursor: 'default' };

function btn(disabled: boolean): React.CSSProperties {
  return disabled ? { ...BTN, ...BTN_DISABLED } : BTN;
}

const VERSION_CHIP: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--result)',
  border: '1px solid var(--border)',
  borderRadius: 2,
  padding: '0 6px',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: MONO,
  lineHeight: '16px'
};

const UPDATE_BADGE: React.CSSProperties = {
  background: WARN_BG,
  color: 'var(--warn)',
  border: '1px solid var(--warn)',
  borderRadius: 2,
  padding: '0 6px',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: MONO,
  lineHeight: '16px'
};

const LINK: React.CSSProperties = {
  color: 'var(--result)',
  textDecoration: 'none',
  fontSize: 11,
  flexShrink: 0
};

const SEARCH_INPUT: React.CSSProperties = {
  background: 'var(--bg-app)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '5px 8px',
  fontFamily: MONO,
  fontSize: 12,
  width: '100%',
  outline: 'none'
};

const PICKER: React.CSSProperties = {
  margin: '2px 0 6px',
  padding: '6px 8px',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 6
};

const PICKER_LABEL: React.CSSProperties = {
  color: 'var(--text-faint)',
  fontSize: 10,
  fontFamily: MONO
};

const EXACT_INPUT: React.CSSProperties = {
  background: 'var(--bg-app)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 2,
  padding: '1px 6px',
  fontFamily: MONO,
  fontSize: 11,
  width: 110,
  outline: 'none'
};

function npmUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

/* ── installed package row with inline version picker ──────────────────── */

function InstalledRow({ name, range }: { name: string; range: string }): React.JSX.Element {
  const busy = usePackages((s) => s.busy);
  const meta = usePackages((s) => s.meta[name]);
  const latest = usePackages((s) => s.outdated[name]);
  const install = usePackages((s) => s.install);
  const installVersioned = usePackages((s) => s.installVersioned);
  const remove = usePackages((s) => s.remove);
  const checkUpdates = usePackages((s) => s.checkUpdates);
  const [open, setOpen] = useState(false);
  const [exact, setExact] = useState('');

  const runInstall = (rangeArg?: string): void => {
    setOpen(false);
    void (rangeArg === undefined ? install(name) : installVersioned(name, rangeArg)).then(() => checkUpdates());
  };

  const submitExact = (): void => {
    const v = exact.trim();
    if (v === '' || busy) return;
    setExact('');
    runInstall(v);
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={ROW}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = HOVER_BG;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <strong style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
        <button style={VERSION_CHIP} title="choose a different version" onClick={() => setOpen((o) => !o)}>
          {range} {open ? '▾' : '▸'}
        </button>
        <a href={npmUrl(name)} target="_blank" rel="noreferrer" style={LINK} title={npmUrl(name)}>
          npm ↗
        </a>
        <span style={{ flex: 1 }} />
        {latest != null && (
          <button
            style={busy ? { ...UPDATE_BADGE, ...BTN_DISABLED } : UPDATE_BADGE}
            disabled={busy}
            title={`update available: ${range} → ${latest}`}
            onClick={() => runInstall()}
          >
            ↑ {latest}
          </button>
        )}
        <button style={btn(busy)} disabled={busy} title={`remove ${name}`} onClick={() => void remove(name)}>
          remove
        </button>
      </div>
      {open && (
        <div style={PICKER}>
          {meta === undefined ? (
            <span style={PICKER_LABEL}>loading version list from registry…</span>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                <span style={PICKER_LABEL}>major</span>
                {meta.majors.map((m) => (
                  <button key={m} style={btn(busy)} disabled={busy} title={`install latest ${m}.x`} onClick={() => runInstall(m)}>
                    v{m}
                  </button>
                ))}
                <span style={{ ...PICKER_LABEL, marginLeft: 'auto' }}>latest {meta.latest}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={PICKER_LABEL}>exact</span>
                <input
                  value={exact}
                  onChange={(e) => setExact(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitExact();
                  }}
                  placeholder="4.17.21"
                  style={EXACT_INPUT}
                  disabled={busy}
                />
                <button style={btn(busy || exact.trim() === '')} disabled={busy || exact.trim() === ''} onClick={submitExact}>
                  install
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── registry search result row ────────────────────────────────────────── */

function SearchResultRow({ row }: { row: PkgSearchRow }): React.JSX.Element {
  const busy = usePackages((s) => s.busy);
  const installedRange = usePackages((s) => s.installed[row.name]);
  const install = usePackages((s) => s.install);
  const remove = usePackages((s) => s.remove);

  return (
    <div
      style={{ ...ROW, borderBottom: '1px solid var(--border)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = HOVER_BG;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <strong style={{ color: 'var(--text)' }}>{row.name}</strong>
      <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>v{row.version}</span>
      <a href={npmUrl(row.name)} target="_blank" rel="noreferrer" style={LINK} title={npmUrl(row.name)}>
        npm ↗
      </a>
      <span style={{ color: 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.description}
      </span>
      {installedRange !== undefined ? (
        <>
          <span style={{ color: 'var(--ok)', fontSize: 11 }} title="installed version range">
            {installedRange}
          </span>
          <button style={btn(busy)} disabled={busy} onClick={() => void remove(row.name)}>
            remove
          </button>
        </>
      ) : (
        <button style={btn(busy)} disabled={busy} onClick={() => void install(row.name)}>
          install
        </button>
      )}
    </div>
  );
}

/* ── collapsible verbatim npm log ──────────────────────────────────────── */

function NpmLog({ log }: { log: string[] }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log.length, open]);

  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', userSelect: 'none', color: 'var(--text-dim)', fontSize: 11, padding: '2px 0' }}
        title={open ? 'collapse log' : 'expand log'}
      >
        {open ? '▾' : '▸'} npm log (verbatim){log.length > 0 ? ` · ${log.length}` : ''}
      </div>
      {open && (
        <div
          ref={bodyRef}
          style={{
            height: 120,
            overflow: 'auto',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 6px'
          }}
        >
          {log.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontFamily: MONO, fontSize: 11 }}>no npm output yet</div>
          )}
          {log.map((line, i) => {
            const isErr = line.startsWith('[npm err]') || line.includes('failed');
            return (
              <div
                key={i}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: isErr ? 'var(--err)' : 'var(--text-dim)'
                }}
              >
                {line}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── panel ─────────────────────────────────────────────────────────────── */

/**
 * Packages panel: full npm package-manager surface — debounced registry
 * search, per-workspace install/remove, update badges fed by checkUpdates,
 * an inline version picker per installed package (major shortcuts + exact
 * version input fed by fetchMeta), and a collapsible verbatim npm log with
 * stderr/failure lines highlighted.
 */
export function PackagesPanel(): React.JSX.Element {
  const installed = usePackages((s) => s.installed);
  const results = usePackages((s) => s.results);
  const searching = usePackages((s) => s.searching);
  const log = usePackages((s) => s.log);
  const query = usePackages((s) => s.query);
  const checking = usePackages((s) => s.checking);
  const setQuery = usePackages((s) => s.setQuery);
  const refresh = usePackages((s) => s.refresh);
  const bindEvents = usePackages((s) => s.bindEvents);
  const fetchMeta = usePackages((s) => s.fetchMeta);
  const checkUpdates = usePackages((s) => s.checkUpdates);

  useDebouncedSearch();

  useEffect(() => {
    void refresh();
    const off = bindEvents();
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy, non-blocking registry metadata + update checks, debounced and
  // re-run whenever the installed set changes (post install/remove).
  const namesKey = Object.keys(installed)
    .sort()
    .join('\n');
  useEffect(() => {
    if (namesKey === '') return;
    const timer = setTimeout(() => {
      for (const name of namesKey.split('\n')) void fetchMeta(name);
      void checkUpdates();
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  const names = namesKey === '' ? [] : namesKey.split('\n');
  const queryActive = query.trim() !== '';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
        color: 'var(--text)',
        height: '100%',
        minHeight: 0
      }}
    >
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search npm…" style={SEARCH_INPUT} />

      <div style={{ flex: 1, overflow: 'auto', minHeight: 60 }}>
        {queryActive && (
          <>
            <div style={{ ...SECTION_TITLE, marginTop: 2 }}>search results{searching ? ' …' : ''}</div>
            {!searching && results.length === 0 && (
              <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>no packages match “{query.trim()}”</div>
            )}
            {results.map((row) => (
              <SearchResultRow key={row.name} row={row} />
            ))}
          </>
        )}

        <div style={SECTION_TITLE}>
          installed ({names.length}){checking ? ' — checking updates…' : ''}
        </div>
        {names.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>no dependencies yet</div>}
        {names.map((name) => (
          <InstalledRow key={name} name={name} range={installed[name] ?? ''} />
        ))}
      </div>

      <NpmLog log={log} />
    </div>
  );
}
