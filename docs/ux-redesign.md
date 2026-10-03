# Workspace UX redesign

## Intent and scope

Make source code the primary workspace. Keep execution, inspection, engine analysis,
benchmarking, packages, runtime management and modal editing available without
showing every control at once. This is a code-and-screen expert audit, not a claim
of usability research with representative users.

The audit covered the initial workspace, source tabs, run controls, inline results,
all six tool panels, settings, command discovery, keyboard navigation, persistent
layout and small-window behavior. Engine visualizers and their raw/artifact views
remain specialized data tools; the redesign changes their surrounding workspace,
not their analysis semantics.

## Findings and implemented decisions

| Friction | Decision |
| --- | --- |
| New workspaces showed an empty console and a wide empty line-output column alongside a long engine demo. | Start with a short runnable sample and collapsed tools; retain one-click access and the full analysis demo. Existing preferences are respected. |
| Repeated frame titles, indices, rules and tiny uppercase labels competed with code. | One labeled tool strip, less framing, neutral surfaces, system UI typography; monospace remains for code/data. |
| Run, runtime selection and hidden commands were hard to discover. | Visible Run/Stop and runtime controls, a persistent command-search trigger, files and tool commands in the same search. |
| Settings replaced and unmounted Monaco. | A modal settings surface leaves the editor mounted, including its undo stack. Native dialog focus containment, Escape and return focus. |
| Settings offered a long, unsearchable set of controls. | Workspace, Appearance, Editor, Execution and Keyboard categories, with search across actual setting rows. |
| One fixed bottom-dock layout did not fit writing, running and inspecting equally well. | Code / Run / Analyze presets; bottom/right docking, independent sizes, maximize/restore, focus mode, optional line results and status. |
| Pointer-only resizing and crowded narrow layouts limited access. | Arrow-key resizer, roving tool-tab focus, responsive right-to-bottom fallback that does not overwrite the preference. |
| Performance showed advanced sampling fields continuously. | Keep run matrix and Run comparison visible; put every measurement option in a labeled dialog. Cases/results retain their existing compact view. |
| Analysis without an installed engine offered disabled controls with no clear next step. | An explanation and Manage engines action, while keeping the demo and all analysis modes. |
| Runtime catalog required scanning every card. | Search by name, engine, description and category; retain all install/import/version controls. |
| Switching tools discarded local selections and expansion state. | Lazy-mount tools and keep visited panels mounted while hidden. Refresh engine capabilities and benchmark targets when reopened. |
| The value inspector assumed a fixed 400px viewport. | Fill the actual panel and provide keyboard-operable value expanders. |
| Performance was omitted from the persisted drawer-tab schema. | Include it in the canonical protocol and regression-test round-trip persistence. |
| App shortcuts could also trigger Monaco commands or close a file behind a dialog. | Consume app-owned shortcuts, isolate modal interactions and preserve Vim ownership of Ctrl+J/Ctrl+N/Ctrl+W. |
| Console values had low contrast on light surfaces. | Theme-aware value colors and a neutral light surface. |
| Failed preference writes were silent. | A real saving/saved/error status, preserved local edits, and Retry save; covered by rejection/retry tests. |
| A valid TypeScript starter showed false syntax errors. | The TS language worker no longer classifies anonymous models as JavaScript via `allowJs`; the separate JS worker is unchanged. Tests now require a real type-mismatch diagnostic and no false diagnostics after switching back to TS. |

## Interaction contract

- The code remains mounted when opening settings, changing docking, maximizing a
  tool or entering focus mode. These are presentation changes, not editor resets.
- Clicking a tool opens it; clicking the active tool collapses it. All six tools
  stay discoverable in the collapsed strip. F1 or Ctrl/Cmd+Shift+P finds them too.
- A manual run reveals Console when tools were closed, unless focus mode was
  explicitly selected. Auto-run does not keep reopening the workspace.
- Shift+F11 temporarily hides tools, line results and status; leaving focus
  restores the underlying layout. It does not reset sizes or tool selection.
- Drag or arrow-key the separator; double-click restores the default size.
- Line results cannot consume more than 45% of the source region, including when
  a large tool panel is docked beside it; the requested output width is retained.
- Right docking falls back below the editor at widths under 1000px. Enlarging the
  window restores the preferred side without a settings write.
- Presets only change layout and line-result visibility, not code, runtime,
  execution policy, theme or Vim preferences.
- Existing schema-v2 settings migrate by defaulting only new fields. Partial
  layout patches do not inject defaults or reset unrelated preferences.

## Architecture

`ui/workspace-layout.ts` contains pure preset/adaptation/resize rules.
`WorkspaceLayoutControls` is shared by Settings and the layout picker. `Dialog`
owns native modal lifecycle. `workbench.css` owns workspace presentation and
responsive overrides; existing data-view styles stay in `styles.css`. No new
runtime dependencies or privileged IPC operations were introduced.

The settings schema remains canonical in `@rh/protocol`; the existing validated
main/preload pipeline persists the added fields. Main and renderer defaults agree.
Security isolation, subprocess execution, binary downloads, benchmark semantics
and package installation policies are unchanged.

## Verification and handoff

Run after changing workspace presentation:

```powershell
pnpm lint
pnpm typecheck:all
pnpm test
pnpm build
node scripts/review-ux.mjs
```

The UX script uses an isolated temporary profile and real Electron. It captures
all tools, settings, command search, right docking, focus, narrow and light layouts
under `.rhbuild/ux-after` (ignored). It checks editor identity and undo, dialog focus,
background shortcut isolation, keyboard resize, responsive fallback, persisted
Performance selection, command search and real Node console output. It also checks
that the default editor occupies over 80% of a 1440×900 viewport. The existing
Monaco E2E tests also use isolated profiles.

Unit regressions cover presets, resize bounds, responsive rules, legacy-layout
migration, default-free partial patches and independent persistent updates.

Verified on Windows on 2026-10-03: lint, full typecheck and production build pass;
389 tests pass, 15 conditional tests are skipped. The three Monaco Electron tests
pass, including Vim shortcuts. The standalone UX interaction suite passes with
an 84.8% initial editor-area share, also exercising the minimum 760×520 window at
110% UI scale, source-file search and line-output width containment. Screenshots
were inspected for every tool plus settings, light theme, focus and side docking.

Manual follow-up: try a real multi-file session, large engine artifacts and a long
benchmark, at the preferred DPI/scale on each supported OS. Automated interaction
and screenshots on Windows do not establish native macOS/Linux visual quality,
screen-reader usability, or the absence of all possible regressions.

## Performance follow-up: progress and wheel scrolling

The wheel issue was reproduced with a populated case list: both the dock and the
case section owned vertical scrolling. Wheel events scrolled the inner section
while the visible outer scrollbar stood still. Performance now has one vertical
scroll region, with a compact toolbar and status outside it. The matrix retains
horizontal scrolling; code samples and results no longer add nested vertical
scrollbars. The same structure works in bottom and right docking.

Runtime discovery is explicitly indeterminate, not a partially filled percentage.
Concurrent discovery calls are deduplicated and successful catalogs are cached
for 30 seconds; Refresh runtimes bypasses the cache. Benchmark progress uses real
streamed work counts, a transform-based fill transition and an independent CSS
activity sweep. Completion remains visible, cancellation keeps its actual
fraction, and failures are not forced to 100%. Full/system/reduced motion follow
one consistent policy. No synthetic progress, artificial completion delay, or
per-frame JavaScript timer was added.

Controls, status and scrolling styles are owned by the Performance feature. The
table and case cards subscribe only to their required state slices, so progress
events do not rerender the entire panel. Correlation guards also cover late start
responses; duplicate results cannot inflate successful-run counts. Stop has a
pending state and handles IPC rejection without an unhandled promise. Runtime
selection uses the shared native modal for keyboard focus containment.

Additional verification (Windows, 2026-10-03):

```powershell
pnpm exec vitest run apps/renderer/src/state/performance.test.ts
node scripts/e2e-performance.mjs
node scripts/e2e-performance.mjs --real
```

The deterministic Electron suite checks motion under app/OS preferences, smooth
interpolation, wheel/PageDown scrolling across layouts, horizontal matrix scroll,
completion/cancellation/failure states and modal focus. Its events pass through
the real preload schema checks. The real mode runs a Node benchmark end to end.
Screenshots are under `.rhbuild/performance-after` (ignored). All 16 Performance
state tests pass; the full suite has 403 passing tests and 15 conditional skips.
Lint, full typecheck and production build pass. Native macOS/Linux input devices,
OS-level accessibility and frame pacing under heavy real workloads still need
manual validation on those systems.
