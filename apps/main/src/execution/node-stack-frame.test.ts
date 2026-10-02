import { describe, expect, it } from 'vitest';
import { formatNodeStackFrame, parseNodeStackFrame } from './node-stack-frame.js';

describe('Node stack frames', () => {
  it('parses paths with spaces and preserves parenthesis shape', () => {
    const frame = parseNodeStackFrame('    at boom (/Users/dev/My Project/entry.cjs:12:7)');
    expect(frame).toMatchObject({ file: '/Users/dev/My Project/entry.cjs', line: 12, column: 7 });
    expect(frame && formatNodeStackFrame(frame, 'entry.ts', 4, 3)).toBe('    at boom (entry.ts:4:3)');
  });

  it('does not append a closing parenthesis to bare async frames', () => {
    const frame = parseNodeStackFrame('    at async /Users/dev/My Project/entry.cjs:12:7');
    expect(frame && formatNodeStackFrame(frame, 'entry.ts', 4, 3)).toBe('    at async entry.ts:4:3');
  });
});
