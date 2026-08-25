# Threat Model

## Posture

RuntimeHell is a **local developer tool**. It executes arbitrary JavaScript/TypeScript on the user's machine with the user's full privileges. This is NOT a security sandbox.

## What isolation IS

- User code runs in a separate OS process (never in the Electron main or renderer process)
- Timeout + tree-kill prevents runaway programs
- npm installs default to `--ignore-scripts` to block postinstall attacks
- Engine/runtime binaries are downloaded from official sources only, checksum-verified where upstream publishes checksums
- The renderer is sandboxed (`contextIsolation:true`, `nodeIntegration:false`)
- IPC payloads are Zod-validated at every boundary

## What isolation IS NOT

- No privilege separation between the user and executed code
- No network egress filtering
- No filesystem access restrictions beyond workspace cwd
- No protection against malicious npm packages whose install scripts are explicitly enabled by the user

## Supply-chain mitigations

- `--ignore-scripts` ON by default
- Official download sources only (nodejs.org, chromium-v8 canary, Mozilla taskcluster/archive, WebKitForWindows releases)
- SHA-256 verification where upstream publishes checksums; record-mode pinning otherwise
- Lockfile committed per workspace
