# t19-analysis-ui.md — Analysis drawer, raw-first (plan todo 19)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

Main:
- `apps/main/src/engines/analysis-manager.ts` — per-type sequencing over the
  V8 adapter with partial-success semantics: a capability-gated type emits
  `{t:'unsupported', reason}` while remaining requested types still run;
  generic failures emit error + stop; terminal `done` always arrives.
  Cancellation: tracked isolation registers a cancel hook per request;
  `analysisCancel` kills the live engine process via ProcessRunner
  tree-cancel and marks subsequent types as skipped.
- `apps/main/src/engines/engines-controller.ts` — enginesList /
  engineCapabilities read surface for picker + action gating.
- Router/index wiring; preload typed analyze/cancelAnalysis/onAnalysisEvent/
  enginesList/engineCapabilities.

Renderer:
- `state/analysis.ts` — per-type status machine (idle/running/done/
  unsupported/error), streamed result collection, stale-request guard,
  cancel plumbing.
- `panels/analysis/AnalysisPanel.tsx` — engine@version picker (binary origin),
  six capability-aware Analyze buttons (disabled + strikethrough when the
  probe says unsupported), live per-type status colors, cancel button while
  running, done-summary header with duration.
- `panels/analysis/ResultViewer.tsx` — Raw tab (verbatim monospace) first-class,
  Normalized tab (bytecode table from @rh/engine-parsers + deopt table) under
  the mandated banner "best-effort normalization — raw output is authoritative",
  Artifacts tab listing turbo-*.json paths, copy-raw button.
- CodeEditor — Analyze ▸ context-menu actions (Monaco precondition context
  keys `rh.cap.*`) reflecting probe verdicts; selection text is analyzed when
  a selection exists, else the whole file.

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 150 passed | 10 skipped (160)
✓ analysis-manager.test.ts (5):
    results streamed per type then done
    gated type → unsupported, remaining types continue (attempted includes gc)
    missing binary → error+done, no spawn
    cancel mid-type stops subsequent types (attempted empty)
    unknown-request cancel → false, no events
```

Real-binary happy path (bytecode of sum() on downloaded d8-debug canary) is
proven in todo-17's net suite (`v8-adapter.net.test.ts`, 2 passed / 37s),
which exercises the same adapter+isolation stack the drawer calls; normalized
rows derive from the todo-18 parsers whose goldens came from that exact
rawOutput shape (1204-instruction big() function).

Failure scenarios (plan spec):
- optcode on release binary → drawer renders "unsupported — binary lacks
  optCodeDisasm…" while other types complete (partial success asserted).
- cancel mid-run → 'cancelled' event flips running types to idle, subsequent
  types skipped (asserted), engine process tree-killed by runner (todo-8
  kill semantics).

## Interim notes

- functionName is not yet auto-derived from selections — lands with the
  SelectionService wrapping strategies in todo 20.
- Normalized tables render up to 400 rows with truncation notice.
