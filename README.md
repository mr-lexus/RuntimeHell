<div align="center">
  <img src="logo.svg" alt="RuntimeHell logo" width="104" />

  # RuntimeHell

  **A multi-runtime JavaScript and TypeScript workbench for execution, engine analysis, and performance experiments.**

  [English](README.md) · [Русский](README.ru.md)

  ![Alpha](https://img.shields.io/badge/status-alpha-f5c400?style=flat-square)
  [![CI](https://github.com/mr-lexus/RuntimeHell/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-lexus/RuntimeHell/actions/workflows/ci.yml)
  ![Desktop](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-59a8ff?style=flat-square)
  ![Electron](https://img.shields.io/badge/Electron-43-47848f?style=flat-square)
  ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)
</div>

> [!WARNING]
> **RuntimeHell is alpha software.** Features may be incomplete, unstable, or unavailable on some machines; interfaces and persisted data formats may change without notice. Runtime and engine integration also depends on locally installed tools and upstream binary availability. Do not rely on this build for critical work, and keep backups of important workspace files.

RuntimeHell is a Windows-first desktop playground for developers who want to run the same JavaScript or TypeScript across different runtimes, inspect what an engine does with the code, and compare performance without leaving one workspace.

## Alpha downloads

Tagged alpha releases are built by GitHub Actions for Windows x64 (NSIS installer), macOS Intel and Apple Silicon (DMG/ZIP), and Linux x64 (AppImage/DEB). See the [GitHub Releases](https://github.com/mr-lexus/RuntimeHell/releases) page for installers. Builds are currently unsigned and macOS packages are not notarized.

### Release pipeline

Pushing a version tag such as `v0.1.0-alpha.0` starts the release workflow. It validates the alpha version, runs lint/typecheck/tests, builds on native Windows, Linux, and macOS runners, and publishes a GitHub prerelease after every platform job succeeds. The regular [CI workflow](.github/workflows/ci.yml) runs the same checks plus compatibility smoke probes on pull requests and pushes to `main`/`master`.

| Platform | Runner | Artifacts |
| --- | --- | --- |
| Windows x64 | `windows-latest` | NSIS `.exe` installer |
| Linux x64 | `ubuntu-latest` | AppImage and DEB |
| macOS x64 | `macos-15-intel` | DMG and ZIP |
| macOS arm64 | `macos-14` | DMG and ZIP |

See [platform compatibility](docs/platform-compatibility.md) for the tested native paths, runtime discovery behavior, and known engine limitations.

![RuntimeHell workbench with TypeScript source and streamed console output](docs/images/readme/workbench.png)

## What is available in the alpha

### Multi-runtime execution

- Run JavaScript and TypeScript with **Node.js**, **Deno**, **Bun**, or the embedded **Chromium** lane.
- Select system or managed runtime versions from the workbench.
- Stream stdout, stderr, structured console values, per-line output, exit status, and duration while a run is active.
- Cancel long-running code and enforce a configurable timeout with child-process tree cleanup.
- Inspect captured values as an expandable, virtualized object tree.

### Editor and workspace

- Monaco-based editor with multiple tabs, TypeScript language tooling, formatting, folding, and bracket-pair colorization.
- Automatic type acquisition for imported packages.
- Autosave, session restore, run history, command palette, and optional auto-run.
- Optional Vim-style editing plus configurable themes, accent colors, density, motion, UI scale, and editor behavior.

### Engine internals

Inspect code with **V8 / d8**, **SpiderMonkey**, and **JavaScriptCore** adapters. Depending on the selected engine and its capabilities, RuntimeHell can expose:

- AST;
- bytecode;
- optimized machine code;
- IR graphs;
- deoptimization traces;
- garbage-collection traces.

Analysis can target the whole module or an individual function. Results provide normalized views where available while retaining the raw engine output for verification. Compatible engine binaries must be installed or imported separately.

![RuntimeHell engine analysis panel](docs/images/readme/analysis.png)

### Runtime and package management

- Detect system installations of Node.js, Deno, Bun, Chrome, Firefox, and nvm-managed Node versions.
- Download supported managed runtime/engine builds, track versions in a manifest, and import existing local binaries.
- Browse the wider runtime and engine catalog, including experimental entries whose execution adapters may not be complete yet.
- Search the npm registry and install, update, pin, or remove dependencies per workspace.
- Package install scripts are ignored by default; the npm log remains visible for inspection.

![RuntimeHell runtime manager](docs/images/readme/runtimes.png)

### Performance Lab

- Turn the active file or editor selection into one or more benchmark cases.
- Run every case through a configurable runtime × optimizer-profile matrix.
- Control warmup, samples, iterations, timeout, and GC policy, or use quick/reliable presets.
- Compare median, mean, p95, p99, standard deviation, throughput, paired deltas, and warnings.
- Export experiment results as JSON.

![RuntimeHell Performance Lab](docs/images/readme/performance.png)

## Quick start

RuntimeHell is currently intended to be run from source. The primary development target is **Windows 10/11 x64**.

### Requirements (from source)

- Node.js 24
- pnpm 11.22.0
- Git

```sh
pnpm install
pnpm dev
```

The app opens with an executable TypeScript analysis demo. Press `Ctrl+Enter` (`Cmd+Enter` on macOS) or use the Run button to execute it. Install or select additional runtimes and analysis engines from the **Runtimes** panel.

## Platform compatibility

The main execution path, native config/cache directories, runtime discovery, PATH handling, process cancellation, and Node/Deno/Bun archive formats are selected at runtime for Windows, macOS, and Linux. Optional engine downloads remain availability-dependent: V8 canary packages are enabled for Windows x64, Linux x64, and Intel macOS; SpiderMonkey, JavaScriptCore, and several standalone engines still require a Windows x64 build or a local import in this alpha. See the [detailed compatibility matrix](docs/platform-compatibility.md).

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Electron with hot reload |
| `pnpm brand:icons` | Regenerate PNG/ICO assets after editing `logo.svg` |
| `pnpm lint` | Run repository architecture and lint gates |
| `pnpm typecheck` | Type-check protocol, main, preload, and renderer packages |
| `pnpm typecheck:all` | Also type-check the shared engine parsers |
| `pnpm test` | Run the Vitest unit and integration suites |
| `pnpm build` | Build the main process, preload bridge, renderer, and runtime assets |

## Project layout

| Path | Responsibility |
| --- | --- |
| `apps/main` | Electron main process, execution, runtimes, engines, packages, persistence, and performance |
| `apps/preload` | Narrow validated bridge between Electron and the renderer |
| `apps/renderer` | React, Monaco, Zustand stores, panels, and application UI |
| `packages/protocol` | Shared Zod IPC contracts and types |
| `packages/engine-parsers` | Pure engine-output parsers and fixtures |
| `docs` | Security, platform compatibility, engine licensing, custom-build, and troubleshooting notes |

## Security

> [!CAUTION]
> RuntimeHell isolates runs from the Electron UI, but it is **not a security sandbox**. Executed code runs with your user account's privileges and may access the filesystem or network. Only run code and install packages that you trust.

The renderer uses context isolation, sandboxing, and validated IPC contracts. Runtime processes have bounded timeouts and process-tree cancellation; managed downloads use official sources and checksum verification where upstream checksums are available. See [the threat model](docs/threat-model.md) for the exact guarantees and non-guarantees.

## Alpha limitations

- Windows is the primary development platform; packaged alpha builds are also produced and smoke-tested on macOS and Linux.
- Runtime and engine availability varies by architecture, installed software, network access, and upstream releases.
- Not every catalog entry has a finished execution or analysis adapter.
- Some analysis modes require debug or custom engine builds and are unsupported by release binaries.
- UI behavior, IPC contracts, workspace metadata, and benchmark formats may change before beta.

Bug reports with reproduction steps, runtime/engine versions, and relevant raw output are especially valuable during the alpha phase.
