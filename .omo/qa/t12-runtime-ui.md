# t12-runtime-ui.md — Runtimes version selector UI (plan todo 12)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `packages/protocol/src/manifest.ts` — BinariesListResponse
  {system, installed, available(LTS-first bounded slice), availableError},
  BinaryInstallRequest/Response (accepted/rejected), BinaryRemoveRequest/
  Response, BinaryProgressEvent (streamed, done-flagged).
- `apps/main/src/runtimes/runtime-resolver.ts` — PURE resolution order:
  **managed selected version → system installation → none (offer download)**;
  ignores partial manifest rows; newest-first display sort helper.
- `apps/main/src/binaries/binaries-controller.ts` — list/install/remove with
  streamed progress events; index-fetch failure degrades to `availableError`
  (panel stays usable offline); system detection cached until mutation.
- `apps/main/src/ipc/router.ts` + `index.ts` — binariesList / binariesInstall /
  binariesRemove handlers; progress streamed via binariesProgress.
- `ExecutionManager` — honors `runtimeVersion` from RunStartRequest through
  the resolver order; system probe cached, manifest read per-run (mutable).
- Preload: typed listBinaries/installRuntime/removeRuntime/onBinariesProgress.
- Renderer: `state/runtimes.ts` + `panels/runtimes/RuntimesPanel.tsx` —
  system chip, managed installs (radio select = per-workspace override,
  interim localStorage `rh.runtime.selectedVersion`, documented for todo 21),
  available versions with live % progress, remove blocked while that version
  drives an active run ("in use — removal blocked"), resolution-order line,
  pairing note (Node → V8).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 18 files: 17 passed | 1 skipped; 98 passed | 2 skipped

RH_NET_TESTS=1 pnpm vitest run apps/main/src/binaries/binaries-controller.net.test.ts
→ exit 0; Tests 1 passed (1) — Duration 13.41s
```

Network happy scenario (REAL nodejs.org artifacts):
- listed index → pinned v22.17.0 LTS installed through the controller
  (download >1MB progress events recorded, final event done:true)
- spawned installed exe: `node --version` → `v22.17.0` (exact match)
- removed via controller → manifest no longer lists it

Unit coverage: resolver decision table (6 cases incl. partial-install rows
and vanished-selection fallback), controller list degradation on network
failure, structured remove-of-missing failure, protocol round-trips.

## Failure scenario (plan spec)

Network cut mid-download: downloadTo rejects → BinaryManager aborts before
manifest mutation, temp staging removed (todo-7 suite asserts orphan cleanup);
UI surfaces install-failed message with progress reset. Removal of a version
currently executing a run is BLOCKED in the panel (`runPhase === 'running'`)
and double-remove races resolve idempotently (second call → structured
"not installed" failure, manifest consistent).
