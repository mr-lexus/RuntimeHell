#!/usr/bin/env node
/**
 * Architecture lint gates (plan todo 23 / F2).
 *
 * Gate 1 — renderer purity: no engine-internal strings may appear under
 * apps/renderer/src. Engine NAMES arrive exclusively as @rh/protocol enum
 * values ('v8' | 'd8-debug' | …) which ARE allowed; what is forbidden is any
 * engine-internal flag or format token that would couple the UI to a binary.
 *
 * Exit 1 with a listing on violation; silent success otherwise.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'apps', 'renderer', 'src');

const FORBIDDEN = [
  /--print-bytecode/i,
  /--print-ast/i,
  /--print-opt-code/i,
  /--trace-turbo/i,
  /--trace-deopt/i,
  /--trace-gc/i,
  /--no-lazy/i,
  /SharedFunctionInfo/,
  /getElectronPath/
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(SCAN_DIR)) {
  const text = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      violations.push(`${relative(ROOT, file)} matches ${re}`);
    }
  }
}

if (violations.length > 0) {
  console.error('renderer purity gate FAILED:');
  for (const v of violations) console.error('  -', v);
  process.exit(1);
}
console.log('renderer purity gate OK');
