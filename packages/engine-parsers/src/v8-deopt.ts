/**
 * Tolerant V8 deopt parser (plan todo 18).
 * Real line shape (V8 15.x canary, stdout of --trace-deopt):
 *
 * [bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing
 *   0x02bd... <JSFunction f (sfi = ...)>, 0x0104... <Code TURBOFAN_JS>,
 *   opt id 0, node id 33, bytecode offset 2, deopt exit 0, FP to SP delta 32,
 *   caller SP 0x..., pc 0x...]
 */
export interface ParsedDeopt {
  readonly kind: string | null;
  readonly reason: string | null;
  readonly functionName: string | null;
  readonly bytecodeOffset: number | null;
}

const BAILOUT_RE = /^\[bailout\s*\(kind:\s*([^,)]+),\s*reason:\s*(.+?)\)\s*:/;
const JSFUNCTION_RE = /<JSFunction\s+([^\s(>]+)\s*\(/;
const OFFSET_RE = /bytecode offset\s+(\d+)/;

export function parseV8Deopts(input: string): ParsedDeopt[] {
  const out: ParsedDeopt[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    const bailout = BAILOUT_RE.exec(line);
    if (bailout === null) continue;
    const kind = (bailout[1] ?? '').trim() || null;
    const reason = (bailout[2] ?? '').trim() || null;
    const fn = JSFUNCTION_RE.exec(line);
    const offset = OFFSET_RE.exec(line);
    out.push({
      kind,
      reason,
      functionName: fn?.[1] ?? null,
      bytecodeOffset: offset ? Number(offset[1]) : null
    });
  }
  return out;
}
