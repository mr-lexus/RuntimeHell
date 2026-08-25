const names = Object.getOwnPropertyNames(globalThis).sort();
print('GLOBALS:' + names.join(','));
if (typeof help === 'function') {
  // help() prints to stdout in some builds
  try { help(); } catch (e) {}
}
