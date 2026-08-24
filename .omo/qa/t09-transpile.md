# Todo 9 QA Evidence — TranspileService

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
apps/main/src/transpile/transpile-service.ts:
- esbuild API transform (loader ts/tsx, format cjs, target node22, external sourcemap) into workspace .rhbuild/
- passthrough for plain JS; structured diagnostics on syntax errors (runner never invoked)
- stack remapping via @jridgewell/trace-mapping: node frames pointing at generated .cjs rewritten to authored .ts positions; unmappable frames pass through

## Happy path (REAL transform + REAL execution)
transpile-service.test.ts (.omo/qa/t09-test.txt, TEST-PASS 35/35+2 skipped):
1. entry.ts with interface/annotations → runnable .cjs + .map
2. child throws 'boom at known line' at generated entry.cjs:3 → remapped stack contains ':4:' (authored line)
3. syntax-error TS → ok:false with esbuild diagnostics text
4. passthrough copies JS untouched, no map

## Failure paths exercised during bring-up
1. Windows drive-letter colon broke frame regex ('C:' captured as path) → replaced regex with structured frame parser `/^\s*at\s+(?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?\s*$/`.
2. Path-separator mismatch (backslash vs forward slash) in target comparison → normalized both sides.
Both failures reproduced via failing test before fix.
