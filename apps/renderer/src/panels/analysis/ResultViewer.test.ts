import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisResult } from '@rh/protocol';
import { expect, it } from 'vitest';
import { ResultViewer } from './ResultViewer';

it('shows native JavaScriptCore bytecode on the default view', () => {
  const result: AnalysisResult = {
    source: 'sum(1, 2)', engine: 'javascriptcore', engineVersion: '327570', analysisType: 'bytecode',
    rawOutput: '[   1] add                dst:loc5, lhs:arg1, rhs:arg2', artifacts: [],
    metadata: { flagsUsed: [], durationMs: 1, binaryPath: 'jsc.exe' }
  };
  const markup = renderToStaticMarkup(createElement(ResultViewer, { result, tab: 'normalized' }));
  expect(markup).toContain('dst:loc5, lhs:arg1');
});
