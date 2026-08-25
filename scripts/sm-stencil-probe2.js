const src = 'function sum(a, b) { return a + b; }\nsum(1, 2);';
function tryit(name, fn) {
  try {
    const r = fn();
    print('[' + name + '] OK type=' + typeof r + ' len=' + (r !== undefined && r !== null && r.length !== undefined ? String(r.length) : 'n/a'));
    if (r !== undefined && r !== null) print('[' + name + ' head] ' + String(r).slice(0, 300));
    return r;
  } catch (e) {
    print('[' + name + ' ERR] ' + (e && e.message ? e.message : String(e)));
    return undefined;
  }
}

const stencil = tryit('compileToStencil', () => compileToStencil(src));
const xdr = tryit('compileToStencilXDR', () => compileToStencilXDR(src));
tryit('dumpStencil(stencil)', () => dumpStencil(stencil));
if (xdr !== undefined) tryit('dumpStencil(xdr)', () => dumpStencil(xdr));
tryit('getslx(stencil)', () => getslx(stencil));
print('[hasDisassembler] ' + hasDisassembler());
