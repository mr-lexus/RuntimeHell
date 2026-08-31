# Engine & Runtime Licensing

| Artifact | License | Source | Notes |
|----------|---------|--------|-------|
| Node.js | MIT | nodejs.org/dist | Includes bundled npm (Artistic-2.0) |
| V8 (d8, d8-debug) | BSD-style | chromium-v8 official canary | No upstream checksums; record-mode sha256 |
| SpiderMonkey (jsshell) | MPL-2.0 | Mozilla taskcluster/archive | Unmodified binaries |
| JavaScriptCore (jsc) | LGPL-2.1 + BSD mix | WebKitForWindows / wincairo CI | Requires WebKitRequirements DLLs |
| WebKitRequirements | BSD-style | WebKitForWindows GitHub releases | Support DLLs only |
| QuickJS-ng | MIT | quickjs-ng GitHub releases | Windows x64 executable; upstream sha256 digest |
| txiki.js | MIT | saghul/txiki.js GitHub releases | Windows x64 archive; installed as a managed runtime |
| GraalJS | GFTC / UPL | Oracle GraalJS GitHub releases | Native Windows x64 standalone; `bin/js.exe` is materialized at the install root |
| Hermes CLI | MIT | facebook/hermes GitHub releases | Windows x64 `.tgz`; requires the host `tar` extractor |
| ChakraCore | MIT | ChakraCore GitHub release → official Azure binary | Windows x64/all binary; release-note sha256 |

## Bun licensing note

Bun bundles its own JavaScriptCore build. Legal review recommended before
commercial redistribution of Bun-based analysis results.

## Provenance policy

All binaries are downloaded from OFFICIAL upstream sources only. No mirrors,
no third-party CDNs. Every artifact's sha256 is pinned in the manifest at
install time (record-mode for hosts that publish no checksums).
