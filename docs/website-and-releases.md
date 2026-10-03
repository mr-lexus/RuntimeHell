# Product website and beta releases

The static website lives in `website/`. `content.mjs` contains English and Russian copy; `build.mjs` emits `/` and `/ru/`, canonical/hreflang metadata, social previews, sitemap and version-specific release links. No frontend dependencies, analytics, cookies or CDN fonts are needed.

## Website

- `pnpm site:build` builds `website/dist` from the current package version. Generated output is ignored by Git.
- `pnpm site:test` uses the bundled Electron Chromium in a separate temporary profile to check both languages at desktop and mobile widths, screenshots, FAQ, language links, keyboard dismissal, overflow, assets and no-JavaScript rendering. Linux CI uses `xvfb-run -a`.
- `node scripts/capture-product.mjs` captures real application screens after `pnpm build`. It creates an isolated temporary workspace, runs authored TypeScript and real Node benchmarks, and writes public product assets under `website/assets/screens`. Review them before committing; never substitute mocked benchmark results or include user workspace data.
- `.github/workflows/pages.yml` builds, tests and deploys only `website/dist` to GitHub Pages from `master`. Repository Pages must use GitHub Actions as its build source.

## Release

1. Update the package version, changelog and the matching `.github/alpha-release-notes.md` or `.github/beta-release-notes.md`. Use numbered prereleases (`0.1.0-beta.1`). Rebuild the site so links target the same version.
2. Run lint, `typecheck:all`, tests, build, the relevant Electron E2E scripts, site tests and `release:validate vVERSION`.
3. Commit and push the reviewed source, then push the matching `vVERSION` tag. Never move an already published tag to another commit.
4. The release workflow validates source, builds natively for Windows x64, Linux x64, macOS x64 and macOS arm64, runs native compatibility smoke tests and packages installers.
5. Publish uploads into a draft, writes `SHA256SUMS.txt`, then makes the prerelease public only after uploads complete. Verify the final asset names, sizes and website download links.

Publication requires all seven installer/archive formats and rejects duplicate asset names. Auto-update is not wired, so per-architecture channel YAMLs are deliberately excluded: both macOS jobs produce the same metadata filename. Linux artifact macros use `x86_64` for AppImage and `amd64` for DEB, not `x64`.

Builds are unsigned and macOS is not notarized until signing credentials are deliberately configured. Beta is a maturity label, not a claim of signing, platform certification or security sandboxing.

The documented `http-cache-semantics` audit exception in `pnpm-workspace.yaml` remains scoped to electron-builder's build-time downloader. Re-check upstream before each release; do not describe the audit as having zero advisories while that exception exists.
