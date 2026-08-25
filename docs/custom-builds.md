# Custom Builds (C-lane)

Engines/platforms with no official prebuilt binary require a custom build.
These are NEVER offered as normal downloads — the UI shows a distinct
"Requires custom build" state.

## V8 (d8 / d8-debug)

```bash
fetch v8
cd v8
gn gen out/x64.release --args='v8_enable_disassembler=true v8_enable_object_print=true is_debug=false'
ninja -C out/x64.release d8
```

## SpiderMonkey (js shell, debug)

```bash
./mach create-mach-environment
./mach build --enable-jitspew
# Binary: obj-dir/dist/bin/js.exe
```

## JavaScriptCore (jsc, debug)

```bash
Tools/Scripts/build-webkit --jsc-only --debug
# Binary: WebKitBuild/Debug/bin/jsc
```
