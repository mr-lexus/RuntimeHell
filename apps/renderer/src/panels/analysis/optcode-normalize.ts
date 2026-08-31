export interface NormalizedOptcodeRow {
  pc: string;
  op: string;
  operands: string;
}

function isMachineBytesColumn(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  return tokens.length >= 2
    ? tokens.every((token) => /^[0-9a-f]{2}$/i.test(token))
    : /^[0-9a-f]{6,}$/i.test(value) && value.length % 2 === 0;
}

function stripDisassemblyPrefix(value: string): string {
  return value.replace(/^(?:(?:rex(?:\.[wrxb]+)?|data(?:16|32)|addr(?:16|32)|lock|rep(?:z|nz)?)\s+)+/i, '');
}

function parseInstructionText(value: string): { op: string; operands: string } | null {
  const columns = value.trim().split(/\s{2,}/).filter(Boolean);
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const candidate = columns[index]?.trim() ?? '';
    if (candidate === '' || isMachineBytesColumn(candidate)) continue;
    const match = /^([a-z][a-z0-9_.-]*)(?:\s+(.*))?$/i.exec(stripDisassemblyPrefix(candidate));
    if (match) return { op: match[1] ?? '', operands: match[2] ?? '' };
  }

  // Some builds separate the byte column with single spaces. Strip that
  // prefix as a fallback, then parse the remaining mnemonic and operands.
  const withoutBytes = value.trim()
    .replace(/^(?:(?:[0-9a-f]{2}\s+){2,}|[0-9a-f]{6,}\s+)/i, '')
    .trim();
  const match = /^([a-z][a-z0-9_.-]*)(?:\s+(.*))?$/i.exec(stripDisassemblyPrefix(withoutBytes));
  return match ? { op: match[1] ?? '', operands: match[2] ?? '' } : null;
}

/** Parse V8 --print-opt-code disassembly into compact instruction rows. */
export function parseV8Optcode(raw: string): NormalizedOptcodeRow[] {
  const rows: NormalizedOptcodeRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // V8 emits instruction PCs as either `0x...` or bare hexadecimal values.
    const pcMatch = /^\s*((?:0x)?[0-9a-f]+)(?::)?\s+(.*)$/i.exec(line);
    if (!pcMatch) continue;
    const instruction = parseInstructionText(pcMatch[2] ?? '');
    if (instruction === null) continue;
    rows.push({ pc: pcMatch[1] ?? '', ...instruction });
  }
  return rows;
}
