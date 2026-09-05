# Platform compatibility (alpha)

RuntimeHell is developed on Windows, so the alpha release includes an explicit cross-platform audit before packaging.

| Area | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Electron package | NSIS installer (x64) | DMG + ZIP (Intel and Apple Silicon) | AppImage + DEB (x64) |
| User config | `%APPDATA%/RuntimeHell` | `~/Library/Application Support/RuntimeHell` | `$XDG_CONFIG_HOME/RuntimeHell` or `~/.config/RuntimeHell` |
| Binary cache | `%LOCALAPPDATA%/RuntimeHell/cache` | `~/Library/Caches/RuntimeHell/cache` | `$XDG_CACHE_HOME/RuntimeHell/cache` or `~/.cache/RuntimeHell/cache` |
| Command lookup | `where.exe` | `which` | `which` |
| Executable suffix | `.exe` | none | none |
| Node archive | `.zip` | `.tar.gz` | `.tar.xz` |
| Child cancellation | `taskkill /T` | detached process group (`SIGTERM`/`SIGKILL`) | detached process group (`SIGTERM`/`SIGKILL`) |

The native compatibility layer keeps secrets out of child environments while preserving the minimum `PATH`, home, temporary-directory, and locale values needed by runtimes. Managed executable names and archive extraction are selected from the host platform instead of being hardcoded to Windows.

Packaged child-process helpers (`bootstrap.cjs`, the fd3 probe, and the
performance harness) are unpacked beside `app.asar`, because external Node
processes cannot load Electron's virtual asar paths. POSIX local imports are
also restored to executable mode before they are recorded in the cache. GUI
runtime detection checks conventional system and user binary directories in
addition to the inherited `PATH`, which is often shorter than an interactive
shell's PATH.

## Engine availability

Engine downloads are intentionally conservative. V8 canary artifacts are enabled for Windows x64, Linux x64, and Intel macOS when the upstream bucket exposes the matching archive. SpiderMonkey, JavaScriptCore, and several standalone engines currently have Windows x64-specific upstream packages; on other hosts the UI returns a clear local-import/custom-build message rather than attempting a broken download.

## CI/release gates

Every pull request and push to `main` runs lint, full typecheck, tests, a production build, and the native Electron smoke test on Windows, macOS, and Linux. Pushing an alpha tag matching `package.json` (for example `v0.1.0-alpha.0`) runs the same validation, packages all release targets, and creates a draft GitHub prerelease. Release artifacts are unsigned in this alpha; macOS packages are not notarized.
