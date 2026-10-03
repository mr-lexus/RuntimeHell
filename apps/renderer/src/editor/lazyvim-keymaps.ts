export type VimContext = 'normal' | 'insert' | 'visual';

export type LazyVimAction =
  | 'buffer.previous'
  | 'buffer.next'
  | 'buffer.alternate'
  | 'buffer.delete'
  | 'buffer.deleteOthers'
  | 'buffer.deleteInvisible'
  | 'file.new'
  | 'file.save'
  | 'file.find'
  | 'editor.moveLineDown'
  | 'editor.moveLineUp'
  | 'editor.commentBelow'
  | 'editor.commentAbove'
  | 'editor.format'
  | 'editor.hover'
  | 'editor.definition'
  | 'editor.declaration'
  | 'editor.implementation'
  | 'editor.typeDefinition'
  | 'editor.references'
  | 'editor.signatureHelp'
  | 'editor.codeAction'
  | 'editor.rename'
  | 'diagnostic.open'
  | 'diagnostic.next'
  | 'diagnostic.previous'
  | 'diagnostic.nextError'
  | 'diagnostic.previousError'
  | 'diagnostic.nextWarning'
  | 'diagnostic.previousWarning'
  | 'ui.clearSearch'
  | 'ui.toggleWrap'
  | 'ui.toggleRelativeNumbers'
  | 'ui.toggleLineNumbers'
  | 'ui.toggleTheme'
  | 'ui.toggleSmoothScrolling'
  | 'window.grow'
  | 'window.shrink'
  | 'tab.first'
  | 'tab.last'
  | 'tab.next'
  | 'tab.previous'
  | 'tab.new'
  | 'tab.close'
  | 'tab.closeOthers'
  | 'app.quit'
  | 'app.help';

export interface LazyVimBinding {
  readonly keys: string;
  readonly modes: readonly VimContext[];
  readonly description: string;
  readonly group: string;
  readonly action?: LazyVimAction;
  readonly toKeys?: string;
  readonly unavailableReason?: string;
}

const NORMAL = ['normal'] as const;
const NORMAL_VISUAL = ['normal', 'visual'] as const;
const ALL = ['normal', 'insert', 'visual'] as const;

/**
 * RuntimeHell's LazyVim compatibility profile.
 *
 * The keys and labels intentionally follow LazyVim's current core keymap.
 * Bindings for concepts RuntimeHell does not own stay in the catalog so the
 * help panel is honest, but are not registered as misleading no-op commands.
 */
export const LAZYVIM_BINDINGS: readonly LazyVimBinding[] = [
  { keys: 'j', modes: NORMAL_VISUAL, toKeys: 'gj', description: 'Down by display line', group: 'Motion' },
  { keys: 'k', modes: NORMAL_VISUAL, toKeys: 'gk', description: 'Up by display line', group: 'Motion' },
  { keys: '<A-j>', modes: ALL, action: 'editor.moveLineDown', description: 'Move line/selection down', group: 'Editing' },
  { keys: '<A-k>', modes: ALL, action: 'editor.moveLineUp', description: 'Move line/selection up', group: 'Editing' },
  { keys: 'H', modes: NORMAL, action: 'buffer.previous', description: 'Previous buffer', group: 'Buffers' },
  { keys: 'L', modes: NORMAL, action: 'buffer.next', description: 'Next buffer', group: 'Buffers' },
  { keys: '[b', modes: NORMAL, action: 'buffer.previous', description: 'Previous buffer', group: 'Buffers' },
  { keys: ']b', modes: NORMAL, action: 'buffer.next', description: 'Next buffer', group: 'Buffers' },
  { keys: '<Space>bb', modes: NORMAL, action: 'buffer.alternate', description: 'Switch to other buffer', group: 'Buffers' },
  { keys: '<Space>`', modes: NORMAL, action: 'buffer.alternate', description: 'Switch to other buffer', group: 'Buffers' },
  { keys: '<Space>bd', modes: NORMAL, action: 'buffer.delete', description: 'Delete buffer', group: 'Buffers' },
  { keys: '<Space>bo', modes: NORMAL, action: 'buffer.deleteOthers', description: 'Delete other buffers', group: 'Buffers' },
  { keys: '<Space>bi', modes: NORMAL, action: 'buffer.deleteInvisible', description: 'Delete invisible buffers', group: 'Buffers', unavailableReason: 'All RuntimeHell source tabs are visible buffers.' },
  { keys: '<Space>bD', modes: NORMAL, action: 'buffer.delete', description: 'Delete buffer and window', group: 'Buffers' },
  { keys: '<C-s>', modes: ALL, action: 'file.save', description: 'Save file', group: 'Files' },
  { keys: '<Space>fn', modes: NORMAL, action: 'file.new', description: 'New file', group: 'Files' },
  { keys: '<Space><Space>', modes: NORMAL, action: 'file.find', description: 'Find files', group: 'Files' },
  { keys: '<Space>,', modes: NORMAL, action: 'file.find', description: 'Buffers', group: 'Files' },
  { keys: '<Space>fb', modes: NORMAL, action: 'file.find', description: 'Buffers', group: 'Files' },
  { keys: '<Space>ff', modes: NORMAL, action: 'file.find', description: 'Find files (root)', group: 'Files' },
  { keys: '<Space>fF', modes: NORMAL, action: 'file.find', description: 'Find files (cwd)', group: 'Files' },
  { keys: '<Space>fg', modes: NORMAL, action: 'file.find', description: 'Find git files', group: 'Files' },
  { keys: '<Space>fr', modes: NORMAL, action: 'file.find', description: 'Recent files', group: 'Files' },
  { keys: '<Space>cf', modes: NORMAL_VISUAL, action: 'editor.format', description: 'Format', group: 'Code' },
  { keys: 'K', modes: NORMAL, action: 'editor.hover', description: 'Hover documentation', group: 'Code' },
  { keys: '<Space>K', modes: NORMAL, action: 'editor.hover', description: 'Keywordprg', group: 'Code' },
  { keys: 'gco', modes: NORMAL, action: 'editor.commentBelow', description: 'Add comment below', group: 'Code' },
  { keys: 'gcO', modes: NORMAL, action: 'editor.commentAbove', description: 'Add comment above', group: 'Code' },
  { keys: 'gd', modes: NORMAL, action: 'editor.definition', description: 'Go to definition', group: 'Code' },
  { keys: 'gD', modes: NORMAL, action: 'editor.declaration', description: 'Go to declaration', group: 'Code' },
  { keys: 'gI', modes: NORMAL, action: 'editor.implementation', description: 'Go to implementation', group: 'Code' },
  { keys: 'gy', modes: NORMAL, action: 'editor.typeDefinition', description: 'Go to type definition', group: 'Code' },
  { keys: 'gr', modes: NORMAL, action: 'editor.references', description: 'References', group: 'Code' },
  { keys: 'gK', modes: NORMAL, action: 'editor.signatureHelp', description: 'Signature help', group: 'Code' },
  { keys: '<Space>ca', modes: NORMAL_VISUAL, action: 'editor.codeAction', description: 'Code action', group: 'Code' },
  { keys: '<Space>cr', modes: NORMAL, action: 'editor.rename', description: 'Rename symbol', group: 'Code' },
  { keys: '<Space>cd', modes: NORMAL, action: 'diagnostic.open', description: 'Line diagnostics', group: 'Diagnostics' },
  { keys: ']d', modes: NORMAL, action: 'diagnostic.next', description: 'Next diagnostic', group: 'Diagnostics' },
  { keys: '[d', modes: NORMAL, action: 'diagnostic.previous', description: 'Previous diagnostic', group: 'Diagnostics' },
  { keys: ']e', modes: NORMAL, action: 'diagnostic.nextError', description: 'Next error', group: 'Diagnostics' },
  { keys: '[e', modes: NORMAL, action: 'diagnostic.previousError', description: 'Previous error', group: 'Diagnostics' },
  { keys: ']w', modes: NORMAL, action: 'diagnostic.nextWarning', description: 'Next warning', group: 'Diagnostics' },
  { keys: '[w', modes: NORMAL, action: 'diagnostic.previousWarning', description: 'Previous warning', group: 'Diagnostics' },
  { keys: '<Space>ur', modes: NORMAL, action: 'ui.clearSearch', description: 'Redraw / clear search', group: 'UI' },
  { keys: '<Space>uw', modes: NORMAL, action: 'ui.toggleWrap', description: 'Toggle word wrap', group: 'UI' },
  { keys: '<Space>uL', modes: NORMAL, action: 'ui.toggleRelativeNumbers', description: 'Toggle relative numbers', group: 'UI' },
  { keys: '<Space>ul', modes: NORMAL, action: 'ui.toggleLineNumbers', description: 'Toggle line numbers', group: 'UI' },
  { keys: '<Space>ub', modes: NORMAL, action: 'ui.toggleTheme', description: 'Toggle background', group: 'UI' },
  { keys: '<Space>uS', modes: NORMAL, action: 'ui.toggleSmoothScrolling', description: 'Toggle smooth scroll', group: 'UI' },
  { keys: '<C-Up>', modes: NORMAL, action: 'window.grow', description: 'Increase window height', group: 'Windows' },
  { keys: '<C-Down>', modes: NORMAL, action: 'window.shrink', description: 'Decrease window height', group: 'Windows' },
  { keys: '<Space><Tab>l', modes: NORMAL, action: 'tab.last', description: 'Last tab', group: 'Tabs' },
  { keys: '<Space><Tab>o', modes: NORMAL, action: 'tab.closeOthers', description: 'Close other tabs', group: 'Tabs' },
  { keys: '<Space><Tab>f', modes: NORMAL, action: 'tab.first', description: 'First tab', group: 'Tabs' },
  { keys: '<Space><Tab><Tab>', modes: NORMAL, action: 'tab.new', description: 'New tab', group: 'Tabs' },
  { keys: '<Space><Tab>]', modes: NORMAL, action: 'tab.next', description: 'Next tab', group: 'Tabs' },
  { keys: '<Space><Tab>d', modes: NORMAL, action: 'tab.close', description: 'Close tab', group: 'Tabs' },
  { keys: '<Space><Tab>[', modes: NORMAL, action: 'tab.previous', description: 'Previous tab', group: 'Tabs' },
  { keys: '<Space>qq', modes: NORMAL, action: 'app.quit', description: 'Quit all', group: 'Application' },
  { keys: '<Space>?', modes: NORMAL, action: 'app.help', description: 'LazyVim keymaps', group: 'Application' },
  { keys: '<C-h/j/k/l>', modes: NORMAL, description: 'Move between split windows', group: 'Unavailable', unavailableReason: 'RuntimeHell has no Neovim split windows.' },
  { keys: '<C-Left/Right>', modes: NORMAL, description: 'Resize window width', group: 'Unavailable', unavailableReason: 'RuntimeHell has no vertical split windows.' },
  { keys: '<Space>-/|/wd/wm', modes: NORMAL, description: 'Create, close or zoom split window', group: 'Unavailable', unavailableReason: 'RuntimeHell has no Neovim split windows.' },
  { keys: '<Space>fT/ft · <C-/>', modes: NORMAL, description: 'Floating terminal', group: 'Unavailable', unavailableReason: 'RuntimeHell does not embed a shell terminal.' },
  { keys: '<Space>gg/gG/gL/gb/gf/gl', modes: NORMAL, description: 'Lazygit and git pickers', group: 'Unavailable', unavailableReason: 'RuntimeHell does not ship Lazygit or Snacks git pickers.' },
  { keys: '<Space>l/L', modes: NORMAL, description: 'Lazy plugin UI / changelog', group: 'Unavailable', unavailableReason: 'RuntimeHell is not a Neovim plugin host.' },
  { keys: '<Space>xl/xq · [q/]q', modes: NORMAL, description: 'Location / quickfix lists', group: 'Unavailable', unavailableReason: 'RuntimeHell has no Neovim location or quickfix list.' },
  { keys: '<Space>uf/uF/us/ud/uc/uA/uT/uD/ua/ug/uh', modes: NORMAL, description: 'Neovim plugin/UI toggles', group: 'Unavailable', unavailableReason: 'These options belong to Neovim format, spell, diagnostics, conceal, Treesitter, dim, animation, indent and inlay-hint plugins.' },
  { keys: '<Space>ui/uI · dpp/dph', modes: NORMAL, description: 'Inspect position/tree and profiler toggles', group: 'Unavailable', unavailableReason: 'These commands require Neovim Treesitter and Snacks profiler.' },
  { keys: '<LocalLeader>r', modes: NORMAL_VISUAL, description: 'Run Lua', group: 'Unavailable', unavailableReason: 'RuntimeHell source lanes execute JavaScript and TypeScript, not embedded Neovim Lua.' }
] as const;

function displayKey(keys: string): string {
  return keys.replaceAll('<Space>', 'Space ').replaceAll('<Tab>', 'Tab ').replaceAll('<LocalLeader>', '\\').replaceAll('<C-', 'Ctrl+').replaceAll('<A-', 'Alt+').replaceAll('>', '').trim();
}

export interface LazyVimHelpGroup {
  readonly title: string;
  readonly items: readonly { keys: string; action: string; unavailableReason?: string }[];
}

export function getLazyVimHelpGroups(): LazyVimHelpGroup[] {
  const groups = new Map<string, Array<{ keys: string; action: string; unavailableReason?: string }>>();
  for (const binding of LAZYVIM_BINDINGS) {
    const items = groups.get(binding.group) ?? [];
    items.push({ keys: displayKey(binding.keys), action: binding.description, unavailableReason: binding.unavailableReason });
    groups.set(binding.group, items);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

export function getLazyVimHints(prefix: string): Array<{ key: string; description: string }> {
  const seen = new Set<string>();
  const hints: Array<{ key: string; description: string }> = [];
  for (const binding of LAZYVIM_BINDINGS) {
    if (binding.unavailableReason || !binding.keys.startsWith(prefix) || binding.keys === prefix) continue;
    const remainder = binding.keys.slice(prefix.length);
    const token = remainder.startsWith('<') ? remainder.slice(0, remainder.indexOf('>') + 1) : remainder[0];
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const exact = LAZYVIM_BINDINGS.find((candidate) => candidate.keys === `${prefix}${token}`);
    hints.push({ key: displayKey(token), description: exact?.description ?? `${displayKey(token)}…` });
  }
  return hints;
}
