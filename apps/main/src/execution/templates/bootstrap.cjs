/**
 * Result-capture bootstrap injected via `node --require <this file>` (plan
 * todo 10). Defines globalThis.__rh.report(index, value):
 *   - serializes value with serialize-value.cjs
 *   - ships NDJSON frames `__RH__{...}\n` on BOTH channels:
 *       · fd 3 when the parent opened it AND chose transport 'fd3'
 *         (RH_REPORT_TRANSPORT=fd3, decided by the one-time parent probe)
 *       · stderr sentinel lines unconditionally (fd3 is never load-bearing;
 *         if fd3 dies mid-run the stderr path still delivers every frame)
 *   - frames carry a monotonically increasing nonce `n` so the parent can
 *     deduplicate dual-channel delivery.
 * Promises: immediate placeholder frame + separate settlement frames.
 */
'use strict';

var path = require('path');
var makeSerializer = require(path.join(__dirname, 'serialize-value.cjs')).makeSerializer;

var serialize = makeSerializer();
var SENTINEL = '__RH__';
var nonce = 0;

// fd 3 is only opened when the parent explicitly opted in after probing;
// opening it blind would silently buffer into a closed pipe on Windows.
var out = null;
if (process.env.RH_REPORT_TRANSPORT === 'fd3') {
  try {
    var fs = require('fs');
    out = fs.createWriteStream(null, { fd: 3 });
    // Any async failure downgrades to stderr-only for the rest of the run.
    out.on('error', function () {
      out = null;
    });
  } catch (e) {
    out = null;
  }
}

function send(obj) {
  obj.n = ++nonce;
  var line = SENTINEL + JSON.stringify(obj) + '\n';
  if (out && out.writable) {
    out.write(line);
  }
  process.stderr.write(line);
}

globalThis.__rh = {
  report: function (index, value, line) {
    try {
      var payload = { i: index, phase: 'immediate', v: serialize(value) };
      if (typeof line === 'number') payload.line = line;
      send(payload);
      if (value instanceof Promise) {
        Promise.resolve(value).then(
          function (v) {
            var p = { i: index, phase: 'fulfilled', v: serialize(v) };
            if (typeof line === 'number') p.line = line;
            send(p);
          },
          function (e) {
            var p2 = { i: index, phase: 'rejected', v: serialize(e) };
            if (typeof line === 'number') p2.line = line;
            send(p2);
          }
        );
      }
    } catch (e) {
      var errPayload = { i: index, phase: 'error', err: String(e && e.message ? e.message : e) };
      if (typeof line === 'number') errPayload.line = line;
      send(errPayload);
    }
    return value;
  },
  console: function (line, level, args) {
    try {
      var serialized = [];
      for (var j = 0; j < args.length; j++) {
        try {
          serialized.push(serialize(args[j]));
        } catch (e) {
          serialized.push({ t: 'string', prim: String(args[j]) });
        }
      }
      var text = args
        .map(function (a) {
          try {
            if (typeof a === 'string') return a;
            if (typeof a === 'number' || typeof a === 'boolean' || a === null || a === undefined) return String(a);
            try {
              return JSON.stringify(a);
            } catch (_) {
              return String(a);
            }
          } catch (_) {
            return String(a);
          }
        })
        .join(' ');
      // Reuse console sentinel logic below
      var CONSOLE_SENTINEL_INNER = '__RH_CONSOLE__';
      var obj = { line: line, column: 0, level: level, text: text, args: serialized, n: ++consoleNonceInner };
      var lineStr = CONSOLE_SENTINEL_INNER + JSON.stringify(obj) + '\n';
      if (out && out.writable) {
        try {
          out.write(lineStr);
        } catch (_) {}
      }
      try {
        process.stderr.write(lineStr);
      } catch (_) {}
      // Parity with plain Node: user console output still reaches stdout
      // (prefixed with its source line so downstream UIs can show location).
      try {
        process.stdout.write('L' + line + ': ' + text + '\n');
      } catch (_) {}
    } catch (_) {}
  }
};
var consoleNonceInner = 0;

// Console capture is now handled via AST transform (result-capture.ts) that injects
// __rh.console(line, level, args) before each console.* call, so no runtime
// stack-parsing wrapper is needed. The __rh.console defined above handles it.
