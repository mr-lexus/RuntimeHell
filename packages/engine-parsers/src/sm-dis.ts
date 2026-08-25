/**
 * Tolerant SpiderMonkey dis() output parser (plan todo 24).
 *
 * dis(fn) prints one or more tables shaped like:
 *   flags:
 *   loc     op
 *   -----   --
 *   main:
 *   00000 :  one
 *   00001 :  return
 *   ...
 *   Source notes:
 *   ofs  line    pc  delta desc     args
 *
 * Modern SM variants differ in column spacing/extra sections; the parser is
 * line-classification based and NEVER throws — unknown lines attach to the
 * nearest block's rawLines.
 */

export interface ParsedSmInstruction {
  readonly offset: number;
  readonly op: string;
  readonly operands: string;
}

export interface ParsedSmBlock {
  /** Function label from the `name:` line, when present ('main' typical). */
  readonly label: string | null;
  readonly instructions: ParsedSmInstruction[];
  readonly sourceNotes: string[];
  readonly rawLines: string[];
}

export interface NormalizedSmDis {
  readonly blocks: ParsedSmBlock[];
  readonly preambleRaw: string[];
}

const ROW_RE = /^\s*(\d+)\s*:\s*(\S+)\s*(.*)$/;
const LABEL_RE = /^\s*([A-Za-z_$][\w$]*)\s*:\s*$/;
const SECTION_RE = /^(flags:|loc\s+op|Source notes|-{3,})/i;

export function parseSmDis(input: string): NormalizedSmDis {
  const blocks: ParsedSmBlock[] = [];
  const preambleRaw: string[] = [];
  let current: {
    label: string | null;
    instructions: ParsedSmInstruction[];
    sourceNotes: string[];
    rawLines: string[];
    section: 'header' | 'instructions' | 'notes' | 'other';
  } | null = null;

  const close = (): void => {
    if (current !== null) {
      blocks.push({
        label: current.label,
        instructions: current.instructions,
        sourceNotes: current.sourceNotes,
        rawLines: current.rawLines
      });
    }
    current = null;
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;

    if (/^flags:/i.test(line)) {
      close();
      current = { label: null, instructions: [], sourceNotes: [], rawLines: [], section: 'header' };
      continue;
    }
    if (current === null) {
      preambleRaw.push(line);
      continue;
    }

    if (/^source notes/i.test(line)) {
      current.section = 'notes';
      current.sourceNotes.push(line); // keep the header for context
      continue;
    }
    if (SECTION_RE.test(line)) {
      current.section = current.section === 'notes' ? 'notes' : 'instructions';
      continue;
    }

    const label = LABEL_RE.exec(line);
    if (label && current.section === 'instructions') {
      current.label = label[1] ?? null;
      continue;
    }

    const row = ROW_RE.exec(line);
    if (row && current.section !== 'notes') {
      current.instructions.push({
        offset: Number(row[1]),
        op: row[2] ?? '',
        operands: (row[3] ?? '').trim()
      });
      continue;
    }

    if (current.section === 'notes') {
      current.sourceNotes.push(line);
      continue;
    }
    current.rawLines.push(line);
  }
  close();

  return { blocks, preambleRaw };
}
