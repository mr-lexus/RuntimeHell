# Execution checkpoint — runtime-playground

> Maintained per user protocol: updated after every completed todo so work
> survives session/context failure. Verified independently at commit
> boundaries in detached worktree `C:\server\rh-verify-a9656de`
> (`git checkout <commit> && pnpm i && pnpm typecheck && pnpm vitest run`).
>
> NOTE 2026-08-24: TWO sessions were pointed at this plan simultaneously.
> Working agreement that emerged: implementing session advances todos and
> commits; THIS session verifies each commit boundary, audits QA evidence,
> and maintains this ledger. Do not delete the other session's work.

## Last updated: 2026-08-24 10:37 (+03)

### Current state
- **HEAD**: `c2d8713 feat(engines): v8 adapter covering ast bytecode optcode ir-graph deopts gc`
- **Last verified todo**: 17 (typecheck exit 0 · engines+engine-parsers vitest 13 passed / 4 skipped)
- **Implementing session is working on**: todo 18 (V8 bytecode/deopt parsers + golden fixtures)

### Completed & verified
| Todo | Commit | Gates | Evidence |
|---|---|---|---|
| 1–12 | b5aa6cf…3dd6854 | pre-existing | t01–t12 present |
| 13 PackageService | `a9656de` | typecheck 0 · 28 pkg/protocol tests | t13 ✓ CVE-2024-27980 mitigation |
| 14 ATA types | `24533ef` | typecheck 0 · 110 passed / 5 skipped | t14 ✓ hermetic mocks; real path → t22 |
| 15 BinaryManager+C-lane | `afae001` | typecheck 0 · 125 passed / 6 skipped | t15 ✓ recorded-digest pinning rationale |
| 16 EngineRegistry+probes | `c716f3a` (+fix `8c8ef9c` sandbox probe cwd) | typecheck 0 · engines/binaries 26 passed / 6 skipped | t16 ✓ sha256-keyed probe cache |
| 17 V8EngineAdapter | `c2d8713` | typecheck 0 · engines/parsers 13 passed / 4 skipped | t17-v8-adapter.md present |

### Next todo
- **18** V8 bytecode/deopt parsers + golden fixtures (TDD-permitted) →
  expect `feat(parsers): tolerant v8 bytecode and deopt parsers with golden fixtures`,
  `.omo/qa/t18-parsers.md`. Verify ≥200-instruction fixture case + truncated-input
  tolerance (partial + rawLines, never throw).

### Blockers / notes
- None blocking. Dual-session protocol holding: implementer commits; this
  session verifies at boundaries + maintains this file.
- Live-network tests gated (`RH_NET_TESTS=1`); d8-dependent tests skip as
  `SKIPPED(no-binary)` on machines without the engine cache.

### Blockers / notes
- None blocking. Renderer `?showcase`-style QA not applicable here.
- Live-network tests are gated (`RH_NET_TESTS=1`) — CI stays green; dev box proves reality.
