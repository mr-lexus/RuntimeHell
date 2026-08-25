# Engine & Runtime Licensing

| Artifact | License | Source | Notes |
|----------|---------|--------|-------|
| Node.js | MIT | nodejs.org/dist | Includes bundled npm (Artistic-2.0) |
| V8 (d8, d8-debug) | BSD-style | chromium-v8 official canary | No upstream checksums; record-mode sha256 |
| SpiderMonkey (jsshell) | MPL-2.0 | Mozilla taskcluster/archive | Unmodified binaries |
| JavaScriptCore (jsc) | LGPL-2.1 + BSD mix | WebKitForWindows / wincairo CI | Requires WebKitRequirements DLLs |
| WebKitRequirements | BSD-style | WebKitForWindows GitHub releases | Support DLLs only |
| QuickJS-ng | MIT | future-phase target | |

## Bun licensing note

Bun bundles its own JavaScriptCore build. Legal review recommended before
commercial redistribution of Bun-based analysis results.

## Provenance policy

All binaries are downloaded from OFFICIAL upstream sources only. No mirrors,
no third-party CDNs. Every artifact's sha256 is pinned in the manifest at
install time (record-mode for hosts that publish no checksums).
