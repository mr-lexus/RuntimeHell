const src = 'function sum(a, b) { return a + b; }\nsum(1, 2);';
function tryit(name, fn) {
  try {
    const r = fn();
    print('[' + name + '] OK');
    const s = String(r);
    print('[' + name + ' len] ' + s.length);
    print('[' + name + ' head] ' + s.slice(0, 500));
    return r;
  } catch (e) {
    print('[' + name + ' ERR] ' + (e && e.message ? e.message : String(e)));
    return undefined;
  }
}

tryit('dumpStencil(src)', () => dumpStencil(src));
tryit('getslx(sum-fn)', () => {
  eval(src.replace('sum(1, 2);', ''));
  return getslx(sum);
});
