# Changelog

## 0.1.0-beta.2 - 2026-11-22

- Run TypeScript with the bundled native compiler in packaged desktop builds.
- Save pending editor changes across tab switches, reloads and window closure. Keep unsaved text available when a write fails.
- Restore persisted run history, support cancellation during startup and preserve UTF-8 and partial output in the console.
- Keep analysis actions consistent with engine capabilities and preserve the selected benchmark runtime across catalog refreshes.
- Scope package operations to the current workspace and allow retrying failed registry lookups.
- Restore automatic type acquisition in Monaco and update audited runtime and build dependencies.
- Install the Windows JavaScriptCore shell and its DLLs from current WebKit archives and probe the shell's supported analysis options.

## 0.1.0-beta.1 - 2026-10-03

- Redesigned the compact workspace, layout presets, settings search and motion controls.
- Reworked Performance Lab navigation, animated progress and wheel scrolling.
- Added safe package imports and optional commented examples from installed READMEs.
- Expanded inline Values with destructured/exported bindings, multiple captures per line, hidden/symbol properties and accessor-safe object/prototype inspection.
- Preserved expanded value trees during unrelated async updates; added keyboard expansion.
- Added a bilingual English/Russian product website and real application screenshots.
- Promoted packaging to beta, with native Windows/Linux/macOS builds and SHA-256 checksums.

## 0.1.0-alpha.6 - 2026-10-03

- Hardened Electron IPC, workspace file access, process journals, and archive extraction.
- Added runtime validation across protocol, preload, main-process, browser, and benchmark boundaries.
- Streamed and bounded binary/package/process output to prevent unbounded memory use.
- Fixed npm Registry ranking and JavaScriptCore network dependency injection.
- Updated supported dependencies and migrated the inspector to `react-window` v2.
- Updated CI/release actions and added peer-dependency and vulnerability gates.
- Added regression coverage for IPC, workspace containment, downloads, archives, process journals, package operations, and source discovery.
