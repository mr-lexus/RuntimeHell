# RuntimeHell v0.1.0-alpha.4

This alpha improves cross-platform runtime execution, macOS/Linux packaging, JS/TS language switching, visual customization, and Linux CI validation.

## What to expect

- Builds are provided for Windows x64, macOS Intel/Apple Silicon, and Linux x64.
- Managed Node.js execution uses the native archive layout on macOS/Linux, and packaged child-process assets are unpacked correctly.
- Embedded Chromium runs retain fast result/console events instead of losing them before the start response arrives.
- macOS uses native traffic-light window controls without overlapping the RuntimeHell title.
- The JavaScript/TypeScript picker now changes Monaco diagnostics, syntax mode, analysis mode, and the execution transform together.
- TypeScript mode transpiles correctly even when the source tab has a `.js` filename; JavaScript and TypeScript are shown with full names in the titlebar picker.
- Settings now include multiple dark, light, and system-following themes, with independent accent color controls.
- POSIX runtime and engine install tests now use the native `bin/node` layout and tolerate empty record-mode fixtures correctly.
- The release is unsigned and macOS is not notarized yet; the operating system may show a first-run security prompt.
- This is an alpha: some runtimes and engine downloads are still platform-specific, and unfinished features may be unstable or incomplete.
- Please report reproducible issues with the OS, architecture, RuntimeHell version, and a short log.
