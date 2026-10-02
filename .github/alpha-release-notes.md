# RuntimeHell v0.1.0-alpha.6

This alpha focuses on security, reliability, maintainability, and dependency compatibility across the Electron application.

## What to expect

- Builds are provided for Windows x64, macOS Intel/Apple Silicon, and Linux x64.
- Electron IPC now accepts requests and emits privileged events only through the trusted application renderer.
- Workspace paths reject traversal and symbolic-link escapes; file and process-journal writes are atomic and schema-validated.
- Runtime downloads stream directly to disk with size limits, checksums, cleanup on failure, and hardened ZIP/TAR extraction.
- Package operations validate package/version specifications, avoid unsafe Windows shell fallbacks, and bound captured output.
- Performance Lab child messages and browser-runtime payloads are runtime-validated; pathological output can no longer grow buffers without limit.
- npm Registry ranking is displayed correctly, and JavaScriptCore discovery consistently uses its injected network transport.
- React, Electron, TypeScript, Vitest, pnpm, Zod, Playwright, Babel, Prettier, and supporting dependencies are updated; `react-window` is migrated to its v2 API.
- CI and release workflows use current GitHub Actions, verify peer dependencies, audit known vulnerabilities, and build installers on every supported platform.
- The release is unsigned and macOS is not notarized yet; the operating system may show a first-run security prompt.
- This is an alpha: some runtimes and engine downloads remain platform-specific. Please report reproducible issues with the OS, architecture, RuntimeHell version, and a short log.
