/**
 * Full TypeScript workbench for the Analysis drawer.
 *
 * It is intentionally executable: every showcased function is called from
 * runAnalysisShowcase(), so AST, bytecode, TurboFan, deopts and GC all have
 * useful work to inspect after an automatic or manual "run all".
 */
export const ANALYSIS_DEMO_CODE = `// RuntimeHell / N3TS analysis workbench
// Switch to the Analysis drawer: all six analyses are recalculated per tab.
// Select a function to focus bytecode, optimized code and deopt output.

type Point = { x: number; y: number };
type NumericBox = { value: number };
type User = { id: number; name: string; active: boolean };

// --- AST / bytecode: nested control flow, objects, arrays and a class ---
function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function classifyScore(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 60) return 'ok';
  return 'retry';
}

function summarizeUsers(users: User[]): string[] {
  return users
    .filter((user) => user.active)
    .map((user) => user.name.toUpperCase());
}

class RunningTotal {
  private value = 0;

  add(amount: number): number {
    this.value += amount;
    return this.value;
  }

  snapshot(): number {
    return this.value;
  }
}

// --- TurboFan: stable numeric feedback, then an explicit optimization hint ---
function forceOptimization(fn: Function): void {
  try {
    // Keep V8 intrinsics in a string so the normal Node runner can execute the
    // same source. d8-debug receives --allow-natives-syntax from the adapter.
    new Function('fn',
      '%PrepareFunctionForOptimization(fn); %OptimizeFunctionOnNextCall(fn);'
    )(fn);
  } catch (_) {
    // Release Node/V8 builds do not expose these intrinsics.
  }
}

function hotAdd(a: number, b: number): number {
  return a + b;
}

function dotProduct(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function warmupTurboFan(): number {
  let checksum = 0;
  for (let i = 0; i < 20000; i += 1) checksum += hotAdd(i, i + 1);
  forceOptimization(hotAdd);
  checksum += hotAdd(20, 22);

  const left = [1, 2, 3, 4, 5];
  const right = [5, 4, 3, 2, 1];
  for (let i = 0; i < 12000; i += 1) checksum += dotProduct(left, right);
  forceOptimization(dotProduct);
  return checksum + dotProduct(left, right);
}

// --- Deopt: optimized numeric property access receives an unexpected string ---
function readNumber(box: NumericBox): number {
  return box.value + 1;
}

function triggerDeopt(): number {
  let result = 0;
  for (let i = 0; i < 20000; i += 1) result += readNumber({ value: i });
  forceOptimization(readNumber);
  result += readNumber({ value: 41 });
  // Deliberately violate the warm numeric shape. This is the interesting call
  // for --trace-deopt; the cast affects TypeScript only, not runtime values.
  result += readNumber({ value: 'deopt-me' } as unknown as NumericBox);
  return result;
}

// --- GC: short-lived arrays create young-generation allocation pressure ---
function allocateGarbage(rounds: number): number {
  let checksum = 0;
  for (let i = 0; i < rounds; i += 1) {
    const garbage = new Array(1024).fill(i);
    checksum += garbage[0];
  }
  return checksum;
}

function runAnalysisShowcase(): void {
  const origin: Point = { x: 0, y: 0 };
  const target: Point = { x: 3, y: 4 };
  const users: User[] = [
    { id: 1, name: 'Alex', active: true },
    { id: 2, name: 'Sam', active: false },
    { id: 3, name: 'Mira', active: true }
  ];
  const total = new RunningTotal();
  total.add(distanceSquared(origin, target));
  total.add(warmupTurboFan());

  console.log('active users:', summarizeUsers(users));
  console.log('distance:', distanceSquared(origin, target));
  console.log('score:', total.snapshot(), classifyScore(total.snapshot()));
  console.log('deopt result:', triggerDeopt());
  console.log('dot product:', dotProduct([1, 2, 3], [3, 2, 1]));
  console.log('allocation checksum:', allocateGarbage(3000));
}

runAnalysisShowcase();
`;
