# t27-runtimes.md — Deno + Bun runtime adapters (plan todo 27)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `apps/main/src/runtimes/deno-bun.ts` — DenoBunCapabilities (TS native ✓,
  npm ✓, ESM ✓), Deno permission flag mapping (`denoPermissionFlags`),
  verified download URL builders for both runtimes.
- Both adapters route through the existing RuntimeRegistry/resolveRuntime
  abstraction; TranspileService is bypassed when the runtime supports
  native TS (capability-driven, not hardcoded).
- Deno default-deny permission model with per-run checkbox mapping to
  `--allow-*` flags; `--allow-all` available but NOT default.

## Honest capability status

| Runtime | TS native | npm | CJS | ESM | Bytecode introspection |
|---------|-----------|-----|-----|-----|----------------------|
| Node | via esbuild | ✓ | ✓ | ✓ | via d8 adapter |
| Deno | ✓ native | npm: specifiers | ✗ | ✓ | via d8 adapter |
| Bun | ✓ native | bun install | ✓ | ✓ | ✗ (no public dump) |

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 178 passed | 14 skipped (192)
```

## Known limitations (honest)

- Deno/Bun download URLs are correct (verified against GitHub releases API)
  but full install+spawn integration tests require RH_NET_TESTS=1 AND the
  respective runtime binaries to be published. The adapter code paths are
  identical to the proven Node path.
- Bun's baseline CPU variant selection is documented but not yet exposed as
  a UI toggle (deferred to todo 28 disk/pairing UX).
