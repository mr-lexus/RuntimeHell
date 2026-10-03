# Import installed packages into the active source

Packages → **Import** inserts a dependency into the active JS/TS source. The optional **Include commented README example** checkbox adds an inert example at the end of the file. One editor Undo removes the entire insertion. The action does not save or execute code, and cancels an already queued auto-run without changing the auto-run preference.

## Source and limitations

The main process reads the installed version's `package.json` and README from the current workspace, without evaluating the library or fetching import suggestions from a service. A short, syntactically complete README code fence with a root import supplies the binding names and example. Without one, the fallback is a namespace import; CommonJS source receives `require`. Examples remain verbatim comments, including their original names, so adapt them when the inserted binding has been renamed to avoid a conflict.

README examples are documentation, not a guarantee that the package exports every documented symbol. Conditional exports are inspected conservatively for Node-compatible root entries. Type-only packages, subpath-only packages, native/data-only entries and external symlinks are not automatically imported. Runtime-specific APIs may still need manual adjustment for Deno, Bun or the browser lane. Missing examples are reported rather than invented.

## Insertion safeguards

- Validate the IPC request, response, package name and structured bindings.
- Read only bounded metadata files resolved inside the workspace; never execute package code to discover exports.
- Parse the current editor contents; refuse incomplete syntax, unsupported files and edits that fail a second parse.
- Preserve shebangs, directive prologues, leading headers, JSDoc and existing source text. Place imports alongside other imports, never at an arbitrary selection.
- Detect existing root imports and avoid identifier collisions, including names used in nested scopes.
- Prefix every physical example line (including Unicode line separators and metadata) with a line comment.
- Reject stale requests after changing the active source or installed dependency; time out metadata requests after 15 seconds.

## Verification

Unit tests are colocated in the protocol, main package reader, renderer import planner and auto-run store. After `pnpm build`, run `node scripts/e2e-package-import.mjs` for the real Electron/preload/Monaco flow, undo/redo, duplicate and syntax guards, real Node execution, CommonJS, and a delayed-request tab-switch race. It uses an isolated temporary workspace and a locally authored fixture, with no package download.
