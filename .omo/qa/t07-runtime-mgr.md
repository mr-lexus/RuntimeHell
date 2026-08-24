# Todo 7 QA Evidence — RuntimeManager v0

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
- binaries/binary-manager.ts: manifest-driven install pipeline (download→sha256 verify→atomic extract→hoist single root→rename into cache→manifest upsert); removeEntry; readManifest/writeManifest with tmp+rename atomicity.
- binaries/paths.ts: %LOCALAPPDATA%\RuntimeHell\cache layout; RH_CACHE_ROOT env override for tests.
- runtimes/node/node-runtime.ts: index.json defensive parse; SHASUMS256.txt resolution; buildNodeInstall(); detectSystemNode() via where.exe + --version.
- shasums.ts parser (+unit tests incl. binary-mode asterisk).

## Happy path (REAL network + REAL binary)
binary-manager.integration.test.ts (RH_NET_TESTS=1):
1. buildNodeInstall('22.17.0') resolved sha256 from official SHASUMS256.txt
2. downloaded ~30MB zip with progress events (>10MB asserted)
3. sha256 matched; single-root hoisted; installed to cache\runtimes\node\22.17.0
4. spawned installed node.exe --version → "v22.17.0" (REAL binary execution)
5. manifest row present; removeEntry deleted dir + row
Full output: .omo/qa/t07-test.txt (TEST-PASS 27/27)

## Failure path exercised
Corrupted-download test: tampered expected sha256 → 'sha256 mismatch' thrown BEFORE extraction/manifest mutation; manifest still empty afterwards (asserted in test).

## Notes
- extract-zip chosen for streaming extraction (reused later for engine zips).
- detectSystemNode covered indirectly by where.exe presence on this machine; full unit coverage deferred to ProcessRunner integration (todo 8 spawns system node too).
