import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { parse } from '@babel/parser';
import { NpmPackageNameSchema, PkgImportInfoSchema, type PkgImportBinding, type PkgImportResponse } from '@rh/protocol';

const MAX_BYTES = 1024 * 1024;
const identifier = /^[A-Za-z_$][\w$]*$/;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};

/** Only installed files inside this workspace; never import/require package code. */
async function localPath(root: string, path: string): Promise<string> {
  const resolved = await fs.realpath(path);
  const rel = relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Package metadata points outside this workspace. Linked external packages are not inspected.');
  return resolved;
}

async function readLocal(root: string, path: string): Promise<string> {
  const resolved = await localPath(root, path);
  const handle = await fs.open(resolved, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Package metadata is not a regular file or exceeds 1 MB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error('Package metadata exceeds 1 MB.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

function exportEntry(value: unknown, condition: 'import' | 'require', depth = 0): string | null | undefined {
  if (depth > 16) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => exportEntry(entry, condition, depth + 1)).find((entry) => typeof entry === 'string');
  for (const [key, entry] of Object.entries(object(value))) {
    if (key === condition || key === 'node' || key === 'default') {
      const resolved = exportEntry(entry, condition, depth + 1);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

/** Documentation is data: extract only a structured root import plus inert text. */
export function readmeImport(readme: string, name: string): { bindings: PkgImportBinding[]; example: string; source: 'readme' | 'namespace' } | null {
  const blocks = readme.matchAll(/^```(?:js|javascript|ts|typescript|jsx|tsx)?[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gm);
  for (const block of blocks) {
    const code = block[1]?.trim() ?? '';
    if (!code || code.length > 4000 || code.split(/\r\n|[\n\r\u2028\u2029]/).length > 50) continue;
    try {
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      for (const node of ast.program.body) {
        if (node.type !== 'ImportDeclaration' || node.source.value !== name || node.importKind === 'type') continue;
        const bindings: PkgImportBinding[] = [];
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') bindings.push({ kind: 'default', local: specifier.local.name });
          else if (specifier.type === 'ImportNamespaceSpecifier') bindings.push({ kind: 'namespace', local: specifier.local.name });
          else if (specifier.importKind !== 'type' && specifier.imported.type === 'Identifier') bindings.push({ kind: 'named', local: specifier.local.name, imported: specifier.imported.name });
        }
        if (bindings.length > 0 && bindings.length <= 16 && bindings.every((binding) => identifier.test(binding.local) && (binding.kind !== 'named' || identifier.test(binding.imported)))) return { bindings, example: code, source: 'readme' };
      }
      // CommonJS examples are still useful documentation; keep a namespace
      // fallback instead of guessing how module.exports maps to ESM bindings.
      const requiresPackage = ast.program.body.some((node) => node.type === 'VariableDeclaration' && node.declarations.some(({ init }) => init?.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'require' && init.arguments[0]?.type === 'StringLiteral' && init.arguments[0].value === name));
      if (requiresPackage) return { bindings: [{ kind: 'namespace', local: 'packageApi' }], example: code, source: 'namespace' };
    } catch { /* Incomplete snippets are not suitable insertion examples. */ }
  }
  return null;
}

export async function inspectPackageImport(workspace: string, name: string): Promise<PkgImportResponse> {
  try {
    NpmPackageNameSchema.parse(name);
    if ((await fs.lstat(workspace)).isSymbolicLink()) throw new Error('Workspace root must not be a symbolic link.');
    const root = await fs.realpath(workspace);
    const workspacePackage = object(JSON.parse(await readLocal(root, join(root, 'package.json'))) as unknown);
    if (!Object.hasOwn(object(workspacePackage.dependencies), name)) throw new Error('Install this package in the workspace first.');
    if (name.startsWith('@types/')) throw new Error('This is a type-definition package, not an executable library. Import the corresponding runtime package instead.');
    const directory = join(root, 'node_modules', name);
    const manifest = object(JSON.parse(await readLocal(root, join(directory, 'package.json'))) as unknown);
    const exportsValue = manifest.exports;
    const exportMap = object(exportsValue);
    const rootExport = Object.keys(exportMap).some((key) => key.startsWith('.')) ? exportMap['.'] : exportsValue;
    const resolveEntry = async (condition: 'import' | 'require'): Promise<string | null> => {
      const entry = exportsValue === undefined ? typeof manifest.main === 'string' ? manifest.main : 'index.js' : exportEntry(rootExport, condition);
      if (!entry) return null;
      if (isAbsolute(entry) || entry.split(/[\\/]/).some((part) => part === '..' || part === 'node_modules') || (exportsValue !== undefined && !entry.startsWith('./'))) return null;
      // Data files and native addons require special syntax; do not invent it.
      const candidates = exportsValue === undefined && !extname(entry) ? [entry, `${entry}.js`, join(entry, 'index.js')] : [entry];
      for (const candidate of candidates) {
        if (!/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(candidate) || /\.d\.[cm]?ts$/.test(candidate)) continue;
        try { if ((await fs.stat(await localPath(root, join(directory, candidate)))).isFile()) return candidate; } catch { /* Try legacy extension resolution. */ }
      }
      return null;
    };
    const [importEntry, requireEntry] = await Promise.all([resolveEntry('import'), resolveEntry('require')]);
    const supportsRequire = requireEntry !== null && (/\.c(?:js|ts)$/.test(requireEntry) || (manifest.type !== 'module' && !/\.m(?:js|ts)$/.test(requireEntry)));
    if (!importEntry && !supportsRequire) throw new Error('No supported root JavaScript entry was found. This package may expose only subpaths, types or a CLI; use its documentation to choose an import.');
    let recipe: ReturnType<typeof readmeImport> = null;
    for (const filename of ['README.md', 'readme.md', 'README', 'Readme.md']) {
      try { recipe = readmeImport(await readLocal(root, join(directory, filename)), name); } catch { /* README is optional. */ }
      if (recipe) break;
    }
    return { ok: true, info: PkgImportInfoSchema.parse({
      name, version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
      workspaceModuleType: workspacePackage.type === 'module' ? 'module' : 'commonjs',
      bindings: recipe?.bindings ?? [{ kind: 'namespace', local: 'packageApi' }],
      source: recipe?.source ?? 'namespace',
      example: recipe?.example ?? null, supportsImport: importEntry !== null, supportsRequire
    }) };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}
