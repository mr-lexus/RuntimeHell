# Runtime logos

Drop local logo assets in this folder using the runtime catalog `id` as the
filename. The renderer discovers these files automatically and prefers them
over the Nerd Font/fallback mark.

Supported formats: `.svg`, `.png`, `.webp`, `.ico`.

Examples:

- `node.svg`
- `deno.svg`
- `bun.svg`
- `browser.svg`
- `v8.svg`
- `d8-debug.svg`
- `spidermonkey.svg`
- `javascriptcore.svg`
- `hermes.svg`
- `quickjs.svg`
- `graaljs.svg`
- `chakra.svg`
- `jerryscript.svg`
- `mujs.svg`
- `moddable-xs.svg`
- `core-js.svg`
- `tc39.svg`

Matching ignores case and punctuation, so `Core-js.svg` and `TC39.svg` work
as expected. Aliases are also accepted for common names, including
`Node.js.svg` and `Chromium.svg` for the `browser` entry, plus `d8.svg`,
`jsc.svg`, and `spider-monkey.svg`.

Prefer square artwork with transparent background. The UI constrains the
asset to the same 34px square used by the runtime catalog.
