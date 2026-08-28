import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardHint, TextInput } from './primitives';

export interface PaletteCommand { id: string; label: string; category: string; shortcut?: string; keywords?: string; enabled?: boolean; reason?: string; run: () => void; }

export function CommandPalette({ commands, onClose }: { commands: readonly PaletteCommand[]; onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = commands.filter((command) => !needle || `${command.label} ${command.category} ${command.keywords ?? ''}`.toLowerCase().includes(needle));
    return rows.slice(0, 80);
  }, [commands, query]);

  useEffect(() => { inputRef.current?.focus(); return () => previousFocus.current?.focus(); }, []);
  useEffect(() => { setIndex((value) => Math.min(value, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  const execute = (command: PaletteCommand | undefined): void => { if (!command || command.enabled === false) return; command.run(); onClose(); };

  return (
    <div className="rh-command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="rh-command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, filtered.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
        if (event.key === 'Enter') { event.preventDefault(); execute(filtered[index]); }
      }}>
        <TextInput ref={inputRef} className="rh-palette-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands…" aria-label="Search commands" />
        <div className="rh-palette-results" role="listbox">
          {filtered.length === 0 && <div className="rh-empty-state">No matching commands</div>}
          {filtered.map((command, rowIndex) => <div key={command.id} className={`rh-palette-row ${rowIndex === index ? 'is-highlighted' : ''} ${command.enabled === false ? 'is-disabled' : ''}`} role="option" aria-selected={rowIndex === index} aria-disabled={command.enabled === false} title={command.reason} onMouseEnter={() => setIndex(rowIndex)} onMouseDown={(event) => event.preventDefault()} onClick={() => execute(command)}><span className="rh-palette-label">{command.label}</span>{command.shortcut && <KeyboardHint>{command.shortcut}</KeyboardHint>}</div>)}
        </div>
      </div>
    </div>
  );
}

