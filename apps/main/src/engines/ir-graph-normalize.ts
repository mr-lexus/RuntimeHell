import { promises as fs } from 'node:fs';
import type {
  NormalizedIrGraph,
  NormalizedIrGraphEdge,
  NormalizedIrGraphFunction,
  NormalizedIrGraphNode,
  NormalizedIrGraphPhase
} from '@rh/protocol';

const MAX_PHASES = 80;
const MAX_NODES_PER_PHASE = 240;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clip(value: string, max = 240): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function graphData(phase: JsonRecord): JsonRecord | null {
  const data = phase['data'];
  if (isRecord(data)) return data;
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeNode(value: unknown): NormalizedIrGraphNode | null {
  if (!isRecord(value)) return null;
  const id = numberValue(value['id']);
  if (id === undefined) return null;
  const sourcePosition = isRecord(value['sourcePosition'])
    ? numberValue(value['sourcePosition']['scriptOffset'])
    : undefined;
  return {
    id,
    label: clip(stringValue(value['label'], stringValue(value['title'], `Node ${id}`))),
    opcode: clip(stringValue(value['opcode'], stringValue(value['title'], ''))),
    properties: clip(stringValue(value['properties'])),
    live: value['live'] !== false,
    control: value['control'] === true,
    ...(sourcePosition === undefined ? {} : { sourcePosition })
  };
}

function normalizeEdge(value: unknown): NormalizedIrGraphEdge | null {
  if (!isRecord(value)) return null;
  const source = numberValue(value['source']);
  const target = numberValue(value['target']);
  if (source === undefined || target === undefined) return null;
  const index = numberValue(value['index']);
  const type = stringValue(value['type']);
  return {
    source,
    target,
    ...(index === undefined ? {} : { index }),
    ...(type === '' ? {} : { type })
  };
}

function normalizePhase(value: unknown): NormalizedIrGraphPhase | null {
  if (!isRecord(value)) return null;
  const data = graphData(value);
  if (data === null || !Array.isArray(data['nodes'])) return null;
  const allNodes = data['nodes']
    .map(normalizeNode)
    .filter((node): node is NormalizedIrGraphNode => node !== null);
  const nodes = allNodes.slice(0, MAX_NODES_PER_PHASE);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(data['edges'])
    ? data['edges']
      .map(normalizeEdge)
      .filter((edge): edge is NormalizedIrGraphEdge => edge !== null && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : [];
  return {
    name: stringValue(value['name'], 'unnamed phase'),
    type: stringValue(value['type'], 'graph'),
    nodes,
    edges,
    truncated: allNodes.length > nodes.length
  };
}

function normalizeDocument(value: unknown, artifactName: string): NormalizedIrGraphFunction | null {
  if (!isRecord(value) || !Array.isArray(value['phases'])) return null;
  const functionInfo = isRecord(value['function']) ? value['function'] : null;
  const name = functionInfo === null
    ? artifactName
    : stringValue(functionInfo['functionName'], artifactName) || artifactName;
  const phases = value['phases']
    .slice(0, MAX_PHASES)
    .map(normalizePhase)
    .filter((phase): phase is NormalizedIrGraphPhase => phase !== null);
  if (phases.length === 0) return null;
  return {
    name,
    sourceName: functionInfo === null ? '' : stringValue(functionInfo['sourceName']),
    sourceText: functionInfo === null ? '' : stringValue(functionInfo['sourceText']),
    phases
  };
}

/** Read and compact the per-function JSON files emitted by --trace-turbo. */
export async function loadNormalizedIrGraph(artifacts: { name: string; path: string }[]): Promise<NormalizedIrGraph | undefined> {
  const functions: NormalizedIrGraphFunction[] = [];
  for (const artifact of artifacts.filter((item) => item.name.toLowerCase().endsWith('.json'))) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(artifact.path, 'utf8'));
      const normalized = normalizeDocument(parsed, artifact.name);
      if (normalized !== null) functions.push(normalized);
    } catch {
      // A partially written or incompatible artifact must not hide raw output.
    }
  }
  return functions.length === 0 ? undefined : { kind: 'ir-graph', functions };
}
