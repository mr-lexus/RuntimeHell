/**
 * Static catalog of known JavaScript runtimes, engines, and standard-library
 * polyfills. Pure data — no IPC, no side effects. The runtimes panel renders
 * this grouped by `category`; detection/install state comes from the zustand
 * store (`state/runtimes.ts`), keyed by `id`.
 */

export type RuntimeCategory = 'runtime' | 'engine' | 'polyfill';

export interface RuntimeCatalogEntry {
  /** Unique id — used as the key in detectionResults. */
  id: string;
  /** Display name. */
  name: string;
  category: RuntimeCategory;
  /** Underlying engine (e.g. 'V8', 'SpiderMonkey', 'JavaScriptCore'). */
  engine: string;
  /** One-line description. */
  description: string;
  /** Official URL. */
  website: string;
  /** Latest stable version, if known/pinned here. */
  version?: string;
  /** Brand color used for the UI dot. */
  color: string;
  /** Can this be installed via the app's managed-download flow? */
  installable: boolean;
  /** npm package installed into the active workspace sandbox. */
  packageName?: string;
  /** Command that detects a system installation (e.g. 'node --version'). */
  detectCommand?: string;
}

export const RUNTIME_CATALOG: RuntimeCatalogEntry[] = [
  /* ── Runtimes — complete JS environments ─────────────────────────────── */
  {
    id: 'node',
    name: 'Node.js',
    category: 'runtime',
    engine: 'V8',
    description: 'The default server-side JS runtime. LTS and Current release lines.',
    website: 'https://nodejs.org',
    version: '22.17.0',
    color: '#68a063',
    installable: true,
    detectCommand: 'node --version'
  },
  {
    id: 'deno',
    name: 'Deno',
    category: 'runtime',
    engine: 'V8',
    description: 'Secure by default, TypeScript-native runtime with web-standard APIs.',
    website: 'https://deno.com',
    version: '2.x',
    color: '#70ffaf',
    installable: true,
    detectCommand: 'deno --version'
  },
  {
    id: 'bun',
    name: 'Bun',
    category: 'runtime',
    engine: 'JavaScriptCore',
    description: 'All-in-one toolkit: runtime, bundler, test runner, package manager.',
    website: 'https://bun.sh',
    version: '1.x',
    color: '#fbf0df',
    installable: true,
    detectCommand: 'bun --version'
  },
  {
    id: 'loran',
    name: 'Loran',
    category: 'runtime',
    engine: 'V8',
    description: 'Experimental V8-based runtime exploring alternative embedding models.',
    website: 'https://github.com/topics/javascript-runtime',
    color: '#c586c0',
    installable: false
  },
  {
    id: 'txiki',
    name: 'txiki.js',
    category: 'runtime',
    engine: 'QuickJS',
    description: 'Small, embeddable runtime built on QuickJS with a Node-like API.',
    website: 'https://github.com/saghul/txiki.js',
    version: '24.x',
    color: '#4ec9b0',
    installable: false,
    detectCommand: 'tjs --version'
  },

  /* ── Engines — low-level JS engines ──────────────────────────────────── */
  {
    id: 'v8',
    name: 'V8',
    category: 'engine',
    engine: 'V8',
    description: "Google's engine powering Chrome, Node.js, and Deno. JIT: Sparkplug → Maglev → TurboFan.",
    website: 'https://v8.dev',
    version: '12.x',
    color: '#4285f4',
    installable: true,
    detectCommand: 'd8 --version'
  },
  {
    id: 'd8-debug',
    name: 'V8 (debug)',
    category: 'engine',
    engine: 'V8 / d8-debug',
    description: 'Debug build of the V8 shell for bytecode, optimization, deopt, and GC analysis.',
    website: 'https://v8.dev/docs/build',
    color: '#8ab4f8',
    installable: true,
    detectCommand: 'd8 --version'
  },
  {
    id: 'spidermonkey',
    name: 'SpiderMonkey',
    category: 'engine',
    engine: 'SpiderMonkey',
    description: "Mozilla's engine in Firefox. The original JavaScript engine (1995).",
    website: 'https://spidermonkey.dev',
    color: '#ff9500',
    installable: true,
    detectCommand: 'js --version'
  },
  {
    id: 'javascriptcore',
    name: 'JavaScriptCore',
    category: 'engine',
    engine: 'JavaScriptCore',
    description: "Apple's engine in Safari/WebKit, also used by Bun. Tiered JIT: LLInt → B3 → FTL.",
    website: 'https://trac.webkit.org/wiki/JavaScriptCore',
    color: '#007aff',
    installable: true,
    detectCommand: 'jsc --version'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    category: 'engine',
    engine: 'Hermes',
    description: "Meta's engine optimized for React Native: bytecode AOT, fast startup, small footprint.",
    website: 'https://hermesengine.dev',
    color: '#00d2ff',
    installable: false,
    detectCommand: 'hermes --version'
  },
  {
    id: 'quickjs',
    name: 'QuickJS',
    category: 'engine',
    engine: 'QuickJS',
    description: "Fabrice Bellard's small, embeddable engine with near-complete ES2023 support.",
    website: 'https://bellard.org/quickjs/',
    version: '2025-04-26',
    color: '#e74c3c',
    installable: false,
    detectCommand: 'qjs -h'
  },
  {
    id: 'graaljs',
    name: 'GraalJS',
    category: 'engine',
    engine: 'GraalJS',
    description: "Oracle's JVM-based engine (GraalVM) with full ECMAScript compliance and polyglot interop.",
    website: 'https://www.graalvm.org/javascript/',
    color: '#f80000',
    installable: false,
    detectCommand: 'js --version'
  },
  {
    id: 'chakra',
    name: 'Chakra',
    category: 'engine',
    engine: 'Chakra',
    description: "Microsoft's legacy Edge engine (ChakraCore). Archived, kept for historical comparison.",
    website: 'https://github.com/chakra-core/ChakraCore',
    color: '#7b4fbe',
    installable: false
  },
  {
    id: 'jerryscript',
    name: 'JerryScript',
    category: 'engine',
    engine: 'JerryScript',
    description: 'Ultra-lightweight engine for IoT and microcontrollers (< 64 KB RAM).',
    website: 'https://jerryscript.net',
    version: '3.x',
    color: '#e91e63',
    installable: false
  },
  {
    id: 'mujs',
    name: 'MuJS',
    category: 'engine',
    engine: 'MuJS',
    description: 'Lightweight ECMAScript interpreter in C, designed for embedding (MuPDF).',
    website: 'https://mujs.com',
    color: '#795548',
    installable: false
  },
  {
    id: 'moddable-xs',
    name: 'Moddable XS',
    category: 'engine',
    engine: 'XS',
    description: 'JavaScript runtime for microcontrollers — ships in embedded products.',
    website: 'https://www.moddable.com',
    color: '#00bcd4',
    installable: false
  },

  /* ── Standards & polyfills — informational ───────────────────────────── */
  {
    id: 'core-js',
    name: 'core-js',
    category: 'polyfill',
    engine: 'any',
    description: 'Comprehensive polyfills for ECMAScript standard library features.',
    website: 'https://github.com/zloirock/core-js',
    version: '3.x',
    color: '#f7df1e',
    installable: true,
    packageName: 'core-js'
  },
  {
    id: 'tc39',
    name: 'TC39 Proposals',
    category: 'polyfill',
    engine: 'any',
    description: 'ECMAScript specification proposals tracker — stages 0 through 4.',
    website: 'https://github.com/tc39/proposals',
    color: '#f4b400',
    installable: false
  }
];
