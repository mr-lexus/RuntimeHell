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
  report: function (index, value) {
    try {
      send({ i: index, phase: 'immediate', v: serialize(value) });
      if (value instanceof Promise) {
        Promise.resolve(value).then(
          function (v) {
            send({ i: index, phase: 'fulfilled', v: serialize(v) });
          },
          function (e) {
            send({ i: index, phase: 'rejected', v: serialize(e) });
          }
        );
      }
    } catch (e) {
      send({ i: index, phase: 'error', err: String(e && e.message ? e.message : e) });
    }
    return value;
  }
};
