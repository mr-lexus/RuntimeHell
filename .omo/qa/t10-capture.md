# t10-capture.md — ResultCapture: expression reporting + value serializer (plan todo 10)

Date: 2026-08-24
Executed by: Sisyphus session (resuming parallel implementer's WIP)

## Scope delivered

- `apps/main/src/execution/result-capture.ts` — babel transform injecting
  `__rh.report(index, value)` after top-level expression statements and
  variable-declaration bindings; `InjectCaptureOptions.captureDeclarations`
  config flag (default ON) per acceptance criteria.
- `apps/main/src/execution/templates/serialize-value.cjs` — capped structural
  serializer (depth 20 / nodes 5000 / strings 10k, all configurable), circular
  back-edges via ancestor-indexed `refId`, throwing getters → `<threw>`,
  TypedArrays/DataView sized by length/byteLength. Fixed DataView sizing in
  this pass (`length ?? byteLength ?? 0`).
- `apps/main/src/execution/templates/bootstrap.cjs` — child-side prelude
  (`node --require`). Frames `__RH__{json}\n` carry a monotonic nonce `n`;
  emitted on BOTH fd-3 (when parent probed + opted in via
  `RH_REPORT_TRANSPORT=fd3`) AND stderr sentinel lines unconditionally
  (fd3 is never load-bearing).
- `apps/main/src/execution/templates/probe-fd3.cjs` — one-shot probe child.
- `apps/main/src/execution/fd3-probe.ts` — startup probe, cached per exe path,
  5s watchdog, safe fallback semantics.
- `apps/main/src/execution/report-transport.ts` — `SentinelLineSplitter`
  (chunk-boundary-safe line reassembly; malformed sentinels surfaced as text,
  never dropped silently) + `parseReportFrame` (zod-free narrow parse to the
  protocol's SerializedValue contract).
- `apps/main/src/execution/process-runner.ts` — `reportTransport` option;
  stdio[3] pipe when 'fd3'; stderr routed through splitter so user output and
  protocol frames separate cleanly; nonce dedup across dual channels;
  `RunResult.reports` populated last-wins-per-index ordered by index.
- `apps/main/src/execution/run-journal.ts` — journal/tree-kill primitives
  extracted behavior-preserving from process-runner during this pass (LOC
  ceiling discipline); re-exported from process-runner so existing consumers
  are untouched.
- Incidental repair (pre-existing HEAD breakage): transpile-service TraceMap
  dynamic-import/cast produced a duplicate-type TS error under the restored
  lockfile; replaced with direct static class usage. Typecheck now passes.

## Commands & evidence

```
pnpm typecheck                      → exit 0 (all four TS projects)
pnpm test                           → exit 0; 10 passed | 1 skipped files,
                                      66 passed | 2 skipped tests
pnpm vitest run --reporter=verbose  → per-test listing below
```

New suites:

```
✓ serializer.test.ts (15)            every value kind, caps, circularity, <threw>
✓ result-capture.test.ts (6)         wrapping order, decl flag on/off, TS/JSX, failure shape
✓ report-transport.test.ts (7)       chunk-boundary reassembly, garbage handling, frame parsing
✓ process-runner.reports.test.ts (3) REAL node children, BOTH transports:
    ✓ delivers reports via stderr sentinel transport without leaking protocol lines 100ms
    ✓ delivers identical reports via fd-3 pipe when supported 188ms
    ✓ caches the fd-3 probe decision per executable 73ms
```

Pre-existing skips (unrelated, network/binary gated):
`binary-manager.integration.test.ts > node runtime install (network)` ×2.

## Happy scenario (plan spec)

Program mixing objects, Map, settled Promise, circular refs executed through
`ProcessRunner` with system node.exe + bootstrap prelude. Asserted:
`RunResult.reports.length === 4`; promise index resolves to `{t:'number',
prim:'42'}` (settled frame overwrites placeholder); Map children keys
`[0] key/[0] value`; user stdout/stderr text survives filtering while zero
`__RH__` lines leak into rendered stderr.

## Failure scenario (plan spec)

Self-referential object + getter that throws, inside the same real-process
run (`process-runner.reports.test.ts`, index 0 / index 3):

```
const evil = { get broken() { throw new Error('getter blew up'); } };
__rh.report(0, evil);           // → child {k:'broken', node.prim === '<threw>'}
var circ = {}; circ.self = circ;
__rh.report(3, circ);           // → child {k:'self', node.refId === 0}
```

Observed: reports still emitted for both; serializer never throws; run
completes with status 'completed'. Evidence encoded in assertions above.

## Transport guarantee

fd-3 probe returns true on win64 + official node v24.18.0; delivery asserted
identical via both carriers with nonce dedup verified by event counts.
