# Values without console.log

Enable the eye icon (**Show line output panel**) and run the source, or enable auto-run. Top-level expressions and variable bindings produce line-aligned values without `console.log`. For example, `const user = { name: 'Alex' };` shows an expandable object on its declaration line; `user;` captures another snapshot wherever it appears.

Destructured bindings and exported variable declarations are captured too. Multiple captures on one line appear under **Values (N)** instead of replacing each other. Promise settlement updates that capture's slot. `undefined` is visible for an uninitialized variable; a console statement does not create an extra undefined result.

Objects expose their own string, symbol and non-enumerable properties and an expandable `[[Prototype]]` chain through `null`, including inherited methods. Ordinary object/array accessors are represented as `[Getter]`, `[Setter]` or `[Getter/Setter]` without invocation. Prototype inspection and labels also avoid executing accessors. Proxy inspection traps and custom behavior on built-in objects are not a security boundary: code still runs under the existing runtime isolation and timeout policy.

## Snapshot semantics and limits

- These are execution snapshots, not static predictions or live object references. Re-run after editing. A later mutation does not rewrite an earlier snapshot; evaluate the object again to inspect its new state.
- Captures are top-level; this is not a debugger that traces every local variable or every loop iteration. Destructuring initializers, defaults and computed keys are not re-evaluated to produce output.
- A bare `{ key: 1 }` is a JavaScript block, not an object expression. Use a declaration or `({ key: 1 });` to inspect an object literal.
- Depth, node, string and prototype-property budgets remain in force. Very large trees can be truncated; private class fields and engine-internal slots are not ordinary reflected properties.
- Native promises settle asynchronously; arbitrary thenable getters are not invoked for inspection.
- Expanded rows stay open when unrelated async values arrive. Tree expansion also supports keyboard Enter/Space.

`node scripts/e2e-values.mjs` checks the built app with isolated Node and Chromium runs. Unit tests also cover the self-contained Deno/Bun capture prelude under Node; this is not a claim that optional Deno/Bun binaries were exercised locally.
