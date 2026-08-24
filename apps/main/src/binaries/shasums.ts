/**
 * SHASUMS256.txt parser (nodejs.org/dist layout):
 *   <hex256>  <two spaces>  <filename>
 */
export interface ShasumEntry {
  filename: string;
  sha256: string;
}

export function parseShasums(text: string): ShasumEntry[] {
  const entries: ShasumEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line);
    if (!match) continue;
    entries.push({ sha256: match[1]?.toLowerCase() ?? '', filename: match[2]?.trim() ?? '' });
  }
  return entries;
}

export function findShasum(entries: ShasumEntry[], filename: string): string | null {
  return entries.find((e) => e.filename === filename)?.sha256 ?? null;
}
