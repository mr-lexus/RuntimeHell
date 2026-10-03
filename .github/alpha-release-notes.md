# RuntimeHell v0.1.0-alpha.8

This alpha replaces the partial home-grown Vim emulation with a mature modal editing engine and adds a reviewable LazyVim compatibility profile.

## What to expect

- Vim editing now uses `monaco-vim` 0.4.4, adding reliable text objects, registers, marks, macros, visual-block mode, search/Ex history, repeat operations, and broader command coverage.
- LazyVim's Space leader, display-line movement, buffer navigation, line movement, save, formatting, LSP navigation, diagnostics, UI toggles, and tab mappings are wired to RuntimeHell/Monaco equivalents.
- `H`/`L`, `[b`/`]b`, `Space bd`, `Space fn`, `Space cf`, `]d`/`[d`, `Space uw`, and the standard LazyVim tab group are available.
- `Space ?` and `:help` open a generated keymap reference; the help view, which-key hints, and registered shortcuts share one catalog.
- Physical punctuation normalization keeps `:`, `/`, brackets, and related Vim keys working on Cyrillic and other non-US keyboard layouts.
- RuntimeHell global shortcuts no longer steal Vim's `Ctrl+W` and `Ctrl+J` behavior while modal editing is enabled.
- Neovim-only features that RuntimeHell cannot represent—split windows, floating terminal, Lazy/Lazygit, and quickfix/location lists—are clearly marked unavailable instead of becoming deceptive no-ops.
- Regression coverage drives a packaged Electron build through `diw`, undo, macro recording/replay, and the LazyVim leader help mapping.
- Builds are provided for Windows x64, macOS Intel/Apple Silicon, and Linux x64. This alpha remains unsigned and macOS is not notarized.
