const src = 'function sum(a, b) { return a + b; }\nsum(1, 2);';
const out = dumpStencil(src);
print('[after-dump marker]');
