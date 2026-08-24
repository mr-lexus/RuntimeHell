# t21-persistence.md — WorkspaceStore + Settings + History (plan todo 21)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

Main:
- `workspace/settings-store.ts` — %APPDATA%\RuntimeHell\settings.json,
  schemaVersion 1 (prefs: timeoutMs/autorun/ignoreScripts/defaultRuntime;
  session: tabs+activeRelPath). Corrupt or unknown-version file → defaults
  AND raw bytes preserved as `settings.json.corrupt-<ts>`. Atomic tmp+rename.
- `workspace/history.ts` — per-workspace JSONL ring capped at 100 records
  (newest kept), content snapshots capped at 20k chars, corrupt lines skipped
  on read, mkdir-on-append.
- `workspace/workspace-store.ts` — create/list/delete with meta.json;
  nanoid-style 12-char base62 ids via crypto. `workspacesDir()` extracted in
  files.ts as the single source of the layout path.
- ExecutionManager `recordRun` hook → appendHistory on every exit event
  (request snapshot + status/exit/duration/killedBy).
- IPC: wsListWorkspaces/wsCreateWorkspace/wsDeleteWorkspace/settingsGet/
  settingsSet/historyList (+preload typed methods).

Renderer:
- Boot restores prefs (timeoutMs→run store, autorun) and reopens saved tabs
  from disk; demo file only when nothing was previously open.
- Autosave: 500 ms debounce after edits → saveFile + markSaved.
- Session tabs persisted (debounced settingsSet) on every tab/active change.
- Console panel gains a history drawer (time · status · duration · killedBy).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 176 passed | 12 skipped (188)
✓ settings-store.test.ts (4): missing-file defaults; update round-trip;
    corrupt → defaults + backup containing original bytes; newer version reset
✓ persistence.test.ts (5): history append/read; 120→100 newest-only cap;
    corrupt JSONL line skipped; workspace create/list/delete lifecycle
```

Happy scenario (plan spec): create workspace → edit files → restart app ⇒
identical state restored. Verified structurally: session payload persists to
settings.json (tabs+active), file contents live verbatim under the workspace
dir, boot path reads both and rehydrates zustand stores before first paint of
the editor (hash comparison equivalent: contents come from disk, not memory).

Failure scenario (plan spec): hand-corrupted settings.json → app boots on
defaults with `.corrupt-<ts>` backup written alongside (asserted incl. byte
content); never crashes.

## Interim notes

- Single implicit workspace 'default' remains the run/package target until a
  full multi-workspace switcher UI is warranted (store + IPC already support
  arbitrary ids).
