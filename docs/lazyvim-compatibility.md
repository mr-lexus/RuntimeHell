# LazyVim compatibility

RuntimeHell's optional Vim mode uses `monaco-vim` 0.4.4 for the editing core and a small declarative profile for LazyVim application keymaps. The core provides normal, insert, replace, visual, visual-line and visual-block modes together with Vim operators, text objects, registers, marks, macros, search, Ex commands and repeat support.

The compatibility profile tracks the current LazyVim core map in [`lua/lazyvim/config/keymaps.lua`](https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua). `<leader>` is Space. RuntimeHell maps Neovim buffers and tabs to source tabs, file pickers to the command palette, LSP and diagnostic commands to Monaco actions, formatting to the existing Prettier worker, and UI toggles to persisted RuntimeHell settings.

Open the in-app map with `Space ?` or `:help`. The list and which-key popup are generated from the same catalog that registers the shortcuts, preventing documentation drift.

## Intentional boundaries

RuntimeHell is an Electron workbench, not a Neovim host. Mappings that require the following Neovim-only subsystems are displayed as unavailable and are not registered as deceptive no-ops:

- split windows and window-local buffers;
- a floating shell terminal;
- Lazy/Lazygit and Snacks git pickers;
- location and quickfix lists.

The source of truth is `apps/renderer/src/editor/lazyvim-keymaps.ts`. When LazyVim changes its defaults, update that catalog and its regression test together.
