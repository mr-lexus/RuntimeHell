import { describe, expect, it } from 'vitest';
import { parseV8Optcode } from './optcode-normalize';

describe('parseV8Optcode', () => {
  it('parses V8 PCs with 0x prefixes and machine-byte columns', () => {
    expect(parseV8Optcode([
      '--- Optimized code ---',
      'Instructions (size = 12)',
      '0x1234    488b05ff    movq rax,[rbx+0x10]',
      '0x123a    55 48 89 e5    push rbp',
      '0x123e    ret'
    ].join('\n'))).toEqual([
      { pc: '0x1234', op: 'movq', operands: 'rax,[rbx+0x10]' },
      { pc: '0x123a', op: 'push', operands: 'rbp' },
      { pc: '0x123e', op: 'ret', operands: '' }
    ]);
  });

  it('parses bare hexadecimal PCs and ignores non-instruction headers', () => {
    expect(parseV8Optcode('name = sum\n00000010  add rax, rbx\nsource_position = 3')).toEqual([
      { pc: '00000010', op: 'add', operands: 'rax, rbx' }
    ]);
  });

  it('parses the address, offset, bytes and disassembly columns emitted by V8', () => {
    expect(parseV8Optcode([
      '000001D6C21C5A00     0  55                   push rbp',
      '000001D6C21C5A01     1  4889e5               REX.W movq rbp,rsp',
      '000001D6C21C5A04     4  56                   push rsi',
      '000001D6C21C5A0B     b  488975e0             REX.W movq [rbp-0x20],rsi'
    ].join('\n'))).toEqual([
      { pc: '000001D6C21C5A00', op: 'push', operands: 'rbp' },
      { pc: '000001D6C21C5A01', op: 'movq', operands: 'rbp,rsp' },
      { pc: '000001D6C21C5A04', op: 'push', operands: 'rsi' },
      { pc: '000001D6C21C5A0B', op: 'movq', operands: '[rbp-0x20],rsi' }
    ]);
  });
});
