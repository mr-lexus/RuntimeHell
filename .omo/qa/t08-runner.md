# Todo 8 QA Evidence — ProcessRunner

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
apps/main/src/execution/process-runner.ts:
- spawn by ABSOLUTE path; cwd=workspace; sanitized env (SystemRoot/windir/TEMP/TMP/PROCESSOR_*/trimmed PATH incl. exe dir) — parent secrets never inherited; extraEnv extension point for future JSC_* overrides.
- stdout/stderr pumps coalescing ≥16ms; flush on close.
- timeout watchdog → taskkill /pid /T /F (tree kill); cancel() idempotent; killedBy tracked ('user'|'timeout').
- structured error events for spawn failures (ENOENT etc.) — never throws unhandled.
- run journal (%LOCALAPPDATA%\RuntimeHell\cache\run-journal.json) + sweepOrphans() startup recovery.

## Happy + failure scenarios (REAL processes, system node.exe)
process-runner.test.ts (.omo/qa/t08-test.txt, TEST-PASS 31/31 overall):
1. ok.cjs → stdout streamed ('hello from child'), exit 0, completed.
2. loop.cjs + cancel() → status cancelled; pid verified DEAD via kill(pid,0) ESRCH.
3. slow.cjs + timeoutMs 250 → status timeout in <5s wall.
4. missing exe → exactly one error event, result status error, no throw.
5. env canary RH_SECRET_CANARY absent from child env; SystemRoot present.
6. sweepOrphans: journal cleared, no throw (Windows pid-liveness caveat documented in test).

## Failure paths exercised during bring-up
- writeJournal not exported → test import failed → exported, re-run green.

## Windows notes
- taskkill /T /F used for tree semantics; non-win fallback plain kill().
- kill(pid,0) liveness probing unreliable on Windows for dead pids — tests assert journal semantics instead of platform-specific liveness where applicable.
