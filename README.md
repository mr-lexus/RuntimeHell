# RuntimeHell

<img src="logo.svg" alt="RuntimeHell" width="96" />

Multi-runtime JavaScript/TypeScript playground with engine-internals analysis (V8 / SpiderMonkey / JavaScriptCore).

Status: early development — see `.omo/plans/runtime-playground.md` for the work plan.

## Development

```sh
pnpm install
pnpm brand:icons # regenerate PNG/ICO assets after changing logo.svg
pnpm dev        # launch Electron app with HMR
pnpm typecheck  # strict TS across all packages
pnpm test       # vitest unit/integration suites
```
