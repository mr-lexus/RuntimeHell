# Changelog

## 0.1.0-alpha.6 - 2026-10-03

- Hardened Electron IPC, workspace file access, process journals, and archive extraction.
- Added runtime validation across protocol, preload, main-process, browser, and benchmark boundaries.
- Streamed and bounded binary/package/process output to prevent unbounded memory use.
- Fixed npm Registry ranking and JavaScriptCore network dependency injection.
- Updated supported dependencies and migrated the inspector to `react-window` v2.
- Updated CI/release actions and added peer-dependency and vulnerability gates.
- Added regression coverage for IPC, workspace containment, downloads, archives, process journals, package operations, and source discovery.
