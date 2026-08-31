import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadNormalizedIrGraph } from './ir-graph-normalize.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir !== '') await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('loadNormalizedIrGraph', () => {
  it('loads function phases and keeps only edges between retained nodes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rh-ir-normalize-'));
    const artifactPath = join(tempDir, 'turbo-sum.json');
    await writeFile(artifactPath, JSON.stringify({
      function: { functionName: 'sum', sourceName: '[eval]', sourceText: 'sum()' },
      phases: [
        {
          name: 'V8.TFBytecodeGraphBuilder',
          type: 'graph',
          data: {
            nodes: [
              { id: 1, label: 'Start', opcode: 'Start', live: true, control: true, properties: '' },
              { id: 2, label: 'Add[1]', opcode: 'Add', live: true, control: false, properties: 'NoThrow', sourcePosition: { scriptOffset: 4 } }
            ],
            edges: [
              { source: 1, target: 2, index: 0, type: 'control' },
              { source: 2, target: 999, index: 1, type: 'value' }
            ]
          }
        }
      ]
    }), 'utf8');

    const normalized = await loadNormalizedIrGraph([{ name: 'turbo-sum.json', path: artifactPath }]);
    expect(normalized?.kind).toBe('ir-graph');
    expect(normalized?.functions[0]?.name).toBe('sum');
    expect(normalized?.functions[0]?.phases[0]?.nodes).toHaveLength(2);
    expect(normalized?.functions[0]?.phases[0]?.edges).toEqual([{ source: 1, target: 2, index: 0, type: 'control' }]);
    expect(normalized?.functions[0]?.phases[0]?.nodes[1]?.sourcePosition).toBe(4);
  });

  it('returns undefined for invalid or non-graph artifacts', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rh-ir-normalize-'));
    const invalidPath = join(tempDir, 'turbo-invalid.json');
    await writeFile(invalidPath, '{not json', 'utf8');
    await expect(loadNormalizedIrGraph([{ name: 'turbo-invalid.json', path: invalidPath }])).resolves.toBeUndefined();
  });
});
