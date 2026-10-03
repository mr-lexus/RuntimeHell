import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardHint, TextInput } from './primitives';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export interface PaletteCommand { id: string; label: string; category: string; shortcut?: string; keywords?: string; enabled?: boolean; reason?: string; run: () => void; }

export function CommandPalette({ commands, onClose }: { commands: readonly PaletteCommand[]; onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => words.every((word) => `${command.label} ${command.category} ${command.keywords ?? ''}`.toLowerCase().includes(word))).slice(0, 80);
  }, [commands, query]);
  const selectedIndex = Math.max(0, Math.min(index, filtered.length - 1));
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex, query]);
  const execute = (command: PaletteCommand | undefined): void => { if (!command || command.enabled === false) return; onClose(); command.run(); };
  return <Dialog label="Command palette" className="rh-palette-dialog" onClose={onClose}>
    <div className="rh-command-palette" onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((selectedIndex + 1) % Math.max(1, filtered.length)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((selectedIndex - 1 + filtered.length) % Math.max(1, filtered.length)); }
      if (event.key === 'Enter') { event.preventDefault(); execute(filtered[selectedIndex]); }
    }}>
      <div className="rh-palette-search"><Icon name="search" size={19} /><TextInput autoFocus className="rh-palette-input" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder="Find a file, tool or command…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="rh-command-results" aria-activedescendant={filtered[selectedIndex] ? `palette-${filtered[selectedIndex]!.id}` : undefined} /><KeyboardHint>Esc</KeyboardHint></div>
      <div className="rh-palette-results" id="rh-command-results" role="listbox" aria-label="Commands and files" ref={listRef}>
        {filtered.length === 0 && <div className="rh-empty-state"><strong>No results for “{query}”</strong><span>Try a filename, “layout”, “run” or “settings”.</span></div>}
        {filtered.map((command, rowIndex) => <div key={command.id} id={`palette-${command.id}`} className={`rh-palette-row ${rowIndex === selectedIndex ? 'is-highlighted' : ''} ${command.enabled === false ? 'is-disabled' : ''}`} role="option" aria-selected={rowIndex === selectedIndex} aria-disabled={command.enabled === false} title={command.reason} onMouseEnter={() => setIndex(rowIndex)} onMouseDown={(event) => event.preventDefault()} onClick={() => execute(command)}><Icon name={command.category === 'Open files' ? 'code' : 'chevron'} size={14} /><span className="rh-palette-label">{command.label}</span><span className="rh-palette-category">{command.category}</span>{command.shortcut && <KeyboardHint>{command.shortcut}</KeyboardHint>}</div>)}
      </div>
      <footer className="rh-palette-footer"><span><kbd>↑ ↓</kbd> navigate</span><span><kbd>Enter</kbd> select</span><span>{filtered.length} results</span></footer>
    </div>
  </Dialog>;
}
