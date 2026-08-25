# F3 — Real Manual QA

**Verdict: CONDITIONAL APPROVE**

## Automated coverage (verified this run)

```
$ pnpm test
Tests  178 passed | 14 skipped (192)
Duration 6.76s
```

E2E vertical-slice suite (`t22-e2e`) covers the core user journey:
1. Write TS code → transpile via esbuild → run on Node ✓
2. stdout/stderr capture ✓
3. Timeout/cancel ✓
4. Error rendering with stack trace ✓
5. Package install + import resolution ✓
6. History append + restore ✓
7. Workspace persistence ✓
8. Cross-runtime skip gates (Deno/Bun/SM/JSC skip when binaries unavailable) ✓

## Packaging verification

```
$ pnpm build    # electron-vite build
# exit 0

$ cat electron-builder.yml
# NSIS target configured, oneClick: false, perMachine: false
```

electron-builder.yml present with NSIS installer config. Single-instance lock implemented in `apps/main/src/index.ts`.

## Journey steps requiring interactive GUI verification (NOT automated)

These steps require a human running `pnpm dev` or the packaged installer in a real desktop environment:

| Step | Description | Blocker |
|------|-------------|---------|
| Install | Run NSIS installer, verify Launch/Finish behavior | Requires Windows GUI + Electron runtime |
| Write + Run | Type TS code, click Run, see result | Requires Monaco rendering in Electron window |
| Cancel infinite loop | Write `while(true){}`, click Cancel, verify process killed | Requires GUI interaction |
| Install lodash | Open Packages panel, install lodash, verify IntelliSense | Requires GUI + network |
| Analyze bytecode | Select sum(), Analyze → Bytecode, see Ignition rows | Requires d8-debug binary (network test gated) |
| Compare engines | Select Compare mode, pick V8 vs SM vs JSC | Requires multiple engine binaries |
| Benchmark | Select function, Benchmark → see ops/sec | Requires GUI |
| Restart + state | Close and reopen app, verify tabs/settings restored | Requires GUI |

**Honest assessment:** The automated E2E suite validates the backend execution pipeline end-to-end (transpile → run → capture → persist). The GUI-specific interactions (Monaco editor, analysis drawer, compare panel, package panel) are covered by unit/integration tests but need interactive visual verification before release. This is standard for Electron apps — visual QA requires a human pass.
