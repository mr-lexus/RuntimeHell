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
    id: 'browser',
    name: 'Chromium (Browser)',
    category: 'runtime',
    engine: 'V8 + Web APIs',
    description: 'Embedded Chromium page: V8 with DOM, timers, fetch, URL, streams, and browser globals — no Node.js APIs.',
    website: 'https://developer.mozilla.org/en-US/docs/Web/API',
    version: 'embedded',
    color: '#8ab4f8',
    installable: false
  },
  {
    id: 'chrome',
    name: 'Chrome (Browser)',
    category: 'runtime',
    engine: 'Chromium + V8 + Web APIs',
    description: 'System Google Chrome browser. RuntimeHell detects the desktop installation and can use it for isolated Performance Lab runs.',
    website: 'https://www.google.com/chrome/',
    version: 'system',
    color: '#4285f4',
    installable: false,
    detectCommand: 'chrome --version'
  },
  {
    id: 'firefox',
    name: 'Firefox (Browser)',
    category: 'runtime',
    engine: 'Gecko + SpiderMonkey + Web APIs',
    description: 'System Firefox browser. RuntimeHell detects the desktop installation and can use it for isolated Performance Lab runs.',
    website: 'https://www.mozilla.org/firefox/',
    version: 'system',
    color: '#ff7139',
    installable: false,
    detectCommand: 'firefox --version'
  },
  {
    id: 'txiki',
    name: 'txiki.js',
    category: 'runtime',
    engine: 'QuickJS',
    description: 'Small, embeddable runtime built on QuickJS with a Node-like API.',
    website: 'https://github.com/saghul/txiki.js',
    version: '26.x',
    color: '#4ec9b0',
    installable: true,
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
    installable: true,
    detectCommand: 'hermes --version'
  },
  {
    id: 'quickjs',
    name: 'QuickJS-ng',
    category: 'engine',
    engine: 'QuickJS',
    description: "Small, embeddable QuickJS successor with a maintained official Windows CLI release.",
    website: 'https://github.com/quickjs-ng/quickjs',
    version: '0.x',
    color: '#e74c3c',
    installable: true,
    detectCommand: 'qjs -h'
  },
  {
    id: 'graaljs',
    name: 'GraalJS',
    category: 'engine',
    engine: 'GraalJS',
    description: "Oracle's JVM-based engine (GraalVM) with full ECMAScript compliance and polyglot interop.",
    website: 'https://www.graalvm.org/javascript/',
    version: '25.x',
    color: '#f80000',
    installable: true,
    detectCommand: 'js --version'
  },
  {
    id: 'chakra',
    name: 'Chakra',
    category: 'engine',
    engine: 'Chakra',
    description: "Microsoft's legacy Edge engine (ChakraCore). Archived, kept for historical comparison.",
    website: 'https://github.com/chakra-core/ChakraCore',
    version: '1.11.x',
    color: '#7b4fbe',
    installable: true
  },
  {
    id: 'moddable-xs',
    name: 'Moddable XS',
    category: 'engine',
    engine: 'XS',
    description: 'Moddable’s embeddable XS engine and desktop command-line shell.',
    website: 'https://github.com/Moddable-OpenSource/moddable',
    version: '9.x',
    color: '#00bcd4',
    installable: true,
    detectCommand: 'xst --version'
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
