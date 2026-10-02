# RuntimeHell v0.1.0-alpha.7

This alpha focuses on native macOS behavior and cross-platform regression hardening.

## What to expect

- Builds are provided for Windows x64, macOS Intel/Apple Silicon, and Linux x64.
- Closing the last window now follows native macOS lifecycle conventions: the app stays available in the Dock and reopens on activation.
- Filesystem path comparisons preserve case on macOS/Linux, including case-sensitive APFS volumes and nvm installations.
- Stack trace remapping now handles spaces, file URLs, and both bare and parenthesized Node frames without corrupting their shape.
- Runtime archive coverage now performs a real TAR extraction/install check on POSIX hosts and verifies executable permissions.
- Shortcut labels and local-import guidance adapt to macOS, Windows, and Linux instead of displaying Windows-only text.
- A large unreachable legacy renderer implementation was removed, reducing `App.tsx` and its maintenance surface substantially.
- Tagged release builds now run the native Electron compatibility smoke on every packaging runner, including both Intel and Apple Silicon macOS.
- The release is unsigned and macOS is not notarized yet; the operating system may show a first-run security prompt.
- This is an alpha: some runtimes and engine downloads remain platform-specific. Please report reproducible issues with the OS, architecture, RuntimeHell version, and a short log.
