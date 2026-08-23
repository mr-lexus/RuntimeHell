# Todo 3 QA Evidence — Shared protocol package

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
packages/protocol/src/{ipc-channels,run,analysis,manifest,schemas}.ts — zod contracts:
- RunRequest / RunEvent (5 variants) / RunResult + recursive SerializedValue
- AnalysisRequest / AnalysisResult / EngineCapabilities / RuntimeCapabilities
- ManifestEntry / BinaryManifest / CustomBuildRecipe (C-lane)
- IPC channel name map

## Happy path
`pnpm test` → **13/13 pass** (.omo/qa/t03-test-output.txt): round-trips for every schema family + rejection cases (bad runtime id, zero timeout, unknown event type, bad status, sha256/platform/url violations, empty analysisTypes).

## Failure path exercised
Rejection tests assert malformed payloads throw (see test names above); e.g. ManifestEntry with sha256 'zz' rejected by regex ^[a-f0-9]{64}$.

## Notes
AnalysisResult.normalized intentionally opaque at protocol boundary (engine-parser-specific shapes live in packages/engine-parsers from todo 18).
