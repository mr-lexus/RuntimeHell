# t14-ata.md — Automatic Type Acquisition (plan todo 14)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `apps/renderer/src/editor/ata.ts` — ATA controller around
  `@typescript/ata`'s setupTypeAcquisition (evidence-fact-6 library):
  500 ms debounced schedule, immediate re-run hook for dependency changes,
  status machine idle→loading→ready/offline. Acquired files enter Monaco's
  TS service via `addExtraLib(code, 'file:///node_modules/<path>')` so
  imports of installed packages resolve with full IntelliSense.
  Offline degradation: errorMessage + finished(empty) ⇒ chip
  "types unavailable (offline)"; editing is never blocked.
- App wiring: controller created once; `schedule(content)` on every edit;
  window event `rh:packages-changed` (dispatched by PackagesPanel on
  successful install/remove) triggers immediate re-acquisition; tab-bar
  status chip shows loading / ready / offline states.
- Dependency additions to renderer: `@typescript/ata`, `typescript`
  (ATA requires the real compiler instance).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 19 passed | 3 skipped files; 111 passed | 4 skipped tests
✓ ata.test.ts (3):
    debounces rapid edits into one acquisition (fake-timers)
    ready-on-types / offline-on-error transitions
    immediate=true bypasses the debounce timer
```

Delegate contract exercised by the fake factory mirrors the installed
package's d.ts exactly (receivedFile/progress/errorMessage/started/finished).
The REAL network path (jsdelivr fetch of lodash/zod types) runs inside the
app process and is covered by t22's E2E journey step (types-ready chip after
typing an lodash import); unit scope here intentionally mocks the delegate to
stay hermetic per D6.

## Failure scenario (plan spec)

Bogus import `'nonexistent-pkg-xyz'`: ATA resolves no types → finishes with
empty file set → status falls back to idle (no error chip spam), editor fully
usable, no crash. Genuine network failures surface errorMessage → offline
chip as asserted in unit test.
