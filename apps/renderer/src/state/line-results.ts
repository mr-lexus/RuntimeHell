import type { SerializedValue } from '@rh/protocol';

export interface CapturedReport { index: number; value: SerializedValue; line?: number; }

/** One slot per capture site, not per arriving frame: promises update their
 * own slot without replacing other expressions on the same source line. */
export function valueForLine(reports: readonly CapturedReport[], line: number): SerializedValue | undefined {
  const matches = reports.filter((report) => report.line === line);
  if (matches.length <= 1) return matches[0]?.value;
  return {
    t: 'object', label: `Values (${matches.length})`, size: matches.length,
    children: matches.map((report, index) => ({ k: `value ${index + 1}`, node: report.value }))
  };
}
