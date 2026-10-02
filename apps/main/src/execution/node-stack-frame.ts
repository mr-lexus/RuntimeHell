export interface NodeStackFrame {
  prefix: string;
  file: string;
  line: number;
  column: number;
  suffix: string;
}

const PARENTHESIZED_FRAME = /^(\s*at\s+.*?\s+\()(.+):(\d+):(\d+)(\)\s*)$/;
const BARE_FRAME = /^(\s*at\s+(?:async\s+)?)(.+):(\d+):(\d+)(\s*)$/;

/** Parse the two stack-frame shapes emitted by Node without rejecting paths containing spaces. */
export function parseNodeStackFrame(value: string): NodeStackFrame | null {
  const match = PARENTHESIZED_FRAME.exec(value) ?? BARE_FRAME.exec(value);
  if (!match) return null;
  const [, prefix, file, line, column, suffix] = match;
  if (prefix === undefined || file === undefined || line === undefined || column === undefined || suffix === undefined) return null;
  return { prefix, file, line: Number(line), column: Number(column), suffix };
}

export function formatNodeStackFrame(frame: NodeStackFrame, file: string, line: number, column: number | null): string {
  return `${frame.prefix}${file}:${line}:${column ?? frame.column}${frame.suffix}`;
}
