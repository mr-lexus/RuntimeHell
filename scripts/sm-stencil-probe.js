// Probe modern SM Stencil introspection surface.
const src = 'function sum(a, b) { return a + b; }\nsum(1, 2);';
try {
  if (typeof hasDisassembler === 'function') {
    print('[hasDisassembler] ' + hasDisassembler());
  }
  if (typeof getslx === 'function' && typeof compileToStencil === 'function') {
    const slx = compileToStencil(src);
    print('[getslx] type=' + typeof slx);
    const text = getslx(slx);
    print('[getslx len] ' + String(text).length);
    print('[getslx head] ' + String(text).slice(0, 400));
  }
  if (typeof dumpStencil === 'function') {
    const stencil = compileToStencil(src);
    print('[dumpStencil head] ' + String(dumpStencil(stencil)).slice(0, 400));
  }
} catch (e) {
  print('[ERR] ' + (e && e.stack ? e.stack : e));
}
