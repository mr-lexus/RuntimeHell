/**
 * Runtime-agnostic result-capture prelude for Deno/Bun (runtime switching).
 *
 * Node keeps the `node --require bootstrap.cjs` flow untouched; Deno and Bun
 * have no portable --require/--preload hook that we can rely on under a
 * sanitized Windows env, so this prelude is PREPENDED to the entry file
 * instead — via esbuild `banner` for transpiled sources (banner lines are
 * NOT covered by the source map, so stack remapping of the real program stays
 * offset-correct) and via plain prefix for passthrough files. PREPEND (not
 * --preload) is the safe default: verified to work for both runtimes without
 * runtime-specific flags. Documented choice — see execution-manager.ts.
 *
 * Self-contained: no require(), no Node builtins, no top-level Node globals.
 *
 * Transport: stderr sentinel lines ONLY:
 *   __RH__{...}         report frames (i/phase/v/line/n — same shape as the
 *                       Node bootstrap so ProcessRunner parses them identically)
 *   __RH_CONSOLE__{...} console frames (line/column/level/text/args/n)
 * fd3 is a Node-only carrier and is never opened here; ProcessRunner routes
 * sentinel lines from stderr universally and deduplicates by nonce.
 *
 * stderr writes feature-detect the host: Deno exposes Deno.stderr.writeSync,
 * Bun implements process.stderr.write. Writes never throw — a dead stderr
 * degrades capture silently, never the run itself.
 */
(function () {
  'use strict';

  var SENTINEL = '__RH__';
  var CONSOLE_SENTINEL = '__RH_CONSOLE__';
  var nonce = 0;
  var consoleNonce = 0;

  var textEncoder = null;
  try {
    textEncoder = new TextEncoder();
  } catch (e) {
    textEncoder = null;
  }

  function writeStderr(line) {
    try {
      if (typeof Deno !== 'undefined' && Deno && Deno.stderr && typeof Deno.stderr.writeSync === 'function') {
        Deno.stderr.writeSync(textEncoder ? textEncoder.encode(line) : line);
        return;
      }
    } catch (e) {
      /* fall through to the Bun/Node path */
    }
    try {
      if (typeof process !== 'undefined' && process && process.stderr && typeof process.stderr.write === 'function') {
        process.stderr.write(line);
      }
    } catch (e) {
      /* capture is best-effort; a dead stderr must never fail the run */
    }
  }

  // --- structural serializer (port of templates/serialize-value.cjs) --------
  // Same caps and node shapes as the Node path so the renderer inspector can
  // treat both identically: depth 20 · nodes 5000 · strings 10k chars.

  var DEFAULT_CAPS = { maxDepth: 20, maxNodes: 5000, maxString: 10000 };

  function isArrayIndexKey(key) {
    var index = Number(key);
    return key !== '' && Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key;
  }

  function makeSerializer(userCaps) {
    var caps = userCaps || {};
    var maxDepth = caps.maxDepth !== undefined ? caps.maxDepth : DEFAULT_CAPS.maxDepth;
    var maxNodes = caps.maxNodes !== undefined ? caps.maxNodes : DEFAULT_CAPS.maxNodes;
    var maxString = caps.maxString !== undefined ? caps.maxString : DEFAULT_CAPS.maxString;

    function serializeValue(value, depth, ancestors, state, includePrototype) {
      if (state.nodeCount >= maxNodes) {
        return { t: 'object', prim: '<node cap reached>', truncated: true };
      }
      state.nodeCount++;

      var t = typeof value;
      if (value === null) return { t: 'null' };
      if (t === 'undefined') return { t: 'undefined' };
      if (t === 'boolean') return { t: 'boolean', prim: String(value) };
      if (t === 'number') return { t: 'number', prim: String(value) };
      if (t === 'bigint') return { t: 'bigint', prim: String(value) + 'n' };
      if (t === 'symbol') return { t: 'symbol', prim: String(value) };
      if (t === 'string') {
        if (value.length > maxString) {
          return { t: 'string', prim: value.slice(0, maxString), size: value.length, truncated: true };
        }
        return { t: 'string', prim: value };
      }
      if (t === 'function') {
        var isClass = /^class[\s{]/.test(Function.prototype.toString.call(value));
        var fnNode = { t: isClass ? 'class' : 'function', label: value.name || '(anonymous)', size: value.length, children: [] };
        if (depth >= maxDepth) {
          fnNode.truncated = true;
          return fnNode;
        }
        var fnAncIndex = ancestors.indexOf(value);
        if (fnAncIndex !== -1) return { t: 'object', prim: '[Circular]', refId: fnAncIndex };
        if (includePrototype !== false) {
          ancestors.push(value);
          appendPrototypeChain(fnNode, value, depth, ancestors, state);
          ancestors.pop();
        }
        return fnNode;
      }

      if (depth >= maxDepth) {
        return { t: 'object', prim: '<depth cap reached>', truncated: true };
      }

      // Circular back-edge: refId indexes the ancestor chain (0 = root).
      var ancIndex = ancestors.indexOf(value);
      if (ancIndex !== -1) {
        return { t: 'object', prim: '[Circular]', refId: ancIndex };
      }

      // Errors.
      if (value instanceof Error) {
        var errNode = { t: 'error', label: value.name || 'Error', children: [] };
        ancestors.push(value);
        if (state.nodeCount < maxNodes) {
          state.nodeCount++;
          errNode.children.push({ k: 'message', node: { t: 'string', prim: String(value.message) } });
          var stack = String(value.stack !== undefined && value.stack !== null ? value.stack : '');
          errNode.children.push({
            k: 'stack',
            node:
              stack.length > maxString
                ? { t: 'string', prim: stack.slice(0, maxString), truncated: true }
                : { t: 'string', prim: stack }
          });
        }
        if (includePrototype !== false) appendPrototypeChain(errNode, value, depth, ancestors, state);
        ancestors.pop();
        return errNode;
      }

      // Dates.
      if (value instanceof Date) {
        var dateNode = { t: 'date', prim: value.toISOString(), children: [] };
        if (includePrototype !== false) {
          ancestors.push(value);
          appendPrototypeChain(dateNode, value, depth, ancestors, state);
          ancestors.pop();
        }
        return dateNode;
      }

      // RegExp.
      if (value instanceof RegExp) {
        var regexpNode = { t: 'regexp', prim: value.source, label: value.flags, children: [] };
        if (includePrototype !== false) {
          ancestors.push(value);
          appendPrototypeChain(regexpNode, value, depth, ancestors, state);
          ancestors.pop();
        }
        return regexpNode;
      }

      // Promises: settlement is reported by __rh.report; serialize the
      // immediate placeholder here.
      if (value instanceof Promise) {
        var promiseNode = { t: 'promise', label: 'promise (settlement reported separately)', children: [] };
        if (includePrototype !== false) {
          ancestors.push(value);
          appendPrototypeChain(promiseNode, value, depth, ancestors, state);
          ancestors.pop();
        }
        return promiseNode;
      }

      // Typed arrays / DataView.
      if (ArrayBuffer.isView(value)) {
        var ctor = value.constructor ? value.constructor.name : 'TypedArray';
        var len =
          typeof value.length === 'number'
            ? value.length
            : typeof value.byteLength === 'number'
              ? value.byteLength
              : 0;
        var node = { t: 'typedarray', label: ctor, size: len, children: [] };
        ancestors.push(value);
        var show = Math.min(len, 50);
        for (var i = 0; i < show; i++) {
          if (state.nodeCount >= maxNodes) {
            node.truncated = true;
            break;
          }
          state.nodeCount++;
          node.children.push({ k: String(i), node: { t: 'number', prim: String(value[i]) } });
        }
        if (show < len) node.truncated = true;
        if (includePrototype !== false) appendPrototypeChain(node, value, depth, ancestors, state);
        ancestors.pop();
        return node;
      }

      // Arrays.
      if (Array.isArray(value)) {
        var arrNode = { t: 'array', size: value.length, children: [] };
        ancestors.push(value);
        for (var ai = 0; ai < value.length; ai++) {
          if (state.nodeCount >= maxNodes) {
            arrNode.truncated = true;
            break;
          }
          arrNode.children.push({ k: String(ai), node: serializeValue(value[ai], depth + 1, ancestors, state) });
        }
        var arrayKeys;
        try {
          arrayKeys = Object.keys(value);
        } catch (e) {
          arrayKeys = [];
        }
        for (var aki = 0; aki < arrayKeys.length; aki++) {
          var arrayKey = arrayKeys[aki];
          if (isArrayIndexKey(arrayKey)) continue;
          if (state.nodeCount >= maxNodes) {
            arrNode.truncated = true;
            break;
          }
          var arrayChild;
          try {
            arrayChild = value[arrayKey];
          } catch (e) {
            arrayChild = '<threw>';
          }
          arrNode.children.push({ k: arrayKey, node: serializeValue(arrayChild, depth + 1, ancestors, state) });
        }
        if (includePrototype !== false) appendPrototypeChain(arrNode, value, depth, ancestors, state);
        ancestors.pop();
        return arrNode;
      }

      // Map.
      if (value instanceof Map) {
        var mapNode = { t: 'map', size: value.size, children: [] };
        ancestors.push(value);
        var mi = 0;
        value.forEach(function (mv, mk) {
          if (state.nodeCount >= maxNodes) {
            mapNode.truncated = true;
            return;
          }
          mapNode.children.push({ k: '[' + mi + '] key', node: serializeValue(mk, depth + 1, ancestors, state) });
          mapNode.children.push({ k: '[' + mi + '] value', node: serializeValue(mv, depth + 1, ancestors, state) });
          mi++;
        });
        if (includePrototype !== false) appendPrototypeChain(mapNode, value, depth, ancestors, state);
        ancestors.pop();
        return mapNode;
      }

      // Set.
      if (value instanceof Set) {
        var setNode = { t: 'set', size: value.size, children: [] };
        ancestors.push(value);
        var si = 0;
        value.forEach(function (sv) {
          if (state.nodeCount >= maxNodes) {
            setNode.truncated = true;
            return;
          }
          setNode.children.push({ k: String(si), node: serializeValue(sv, depth + 1, ancestors, state) });
          si++;
        });
        if (includePrototype !== false) appendPrototypeChain(setNode, value, depth, ancestors, state);
        ancestors.pop();
        return setNode;
      }

      // Plain objects / class instances.
      var ctorName = value.constructor && value.constructor.name !== 'Object' ? value.constructor.name : undefined;
      var objNode = { t: 'object', label: ctorName, children: [] };
      ancestors.push(value);
      var keys;
      try {
        keys = Object.keys(value);
      } catch (e) {
        keys = [];
      }
      for (var ki = 0; ki < keys.length; ki++) {
        if (state.nodeCount >= maxNodes) {
          objNode.truncated = true;
          break;
        }
        var key = keys[ki];
        var childVal;
        try {
          childVal = value[key];
        } catch (e) {
          childVal = '<threw>';
        }
        state.nodeCount++;
        objNode.children.push({ k: key, node: serializeValue(childVal, depth + 1, ancestors, state) });
      }
      if (includePrototype !== false) appendPrototypeChain(objNode, value, depth, ancestors, state);
      ancestors.pop();
      return objNode;
    }

    // Preserve every link, including Object.prototype and the terminating
    // null link, so the inspector can show the complete inheritance path.
    function appendPrototypeChain(target, value, depth, ancestors, state) {
      var current = value;
      var currentTarget = target;
      var chainDepth = depth;
      var seen = [];
      var SKIP = Object.create(null);
      SKIP.length = 1;
      SKIP.name = 1;
      SKIP.caller = 1;
      SKIP.arguments = 1;
      SKIP.prototype = 1;
      SKIP.__proto__ = 1;
      SKIP.constructor = 1;

      while (chainDepth < maxDepth) {
        var proto;
        try {
          proto = Object.getPrototypeOf(current);
        } catch (_) {
          return;
        }
        if (proto === null) {
          if (state.nodeCount >= maxNodes) {
            currentTarget.truncated = true;
            return;
          }
          state.nodeCount++;
          currentTarget.children.push({ k: '[[Prototype]]', node: { t: 'null' } });
          return;
        }
        if (seen.indexOf(proto) !== -1) {
          currentTarget.truncated = true;
          return;
        }
        seen.push(proto);
        if (state.nodeCount >= maxNodes) {
          currentTarget.truncated = true;
          return;
        }
        var protoLabel;
        try {
          var ctor = proto.constructor;
          protoLabel = ctor && typeof ctor.name === 'string' && ctor.name ? ctor.name : undefined;
        } catch (_) {
          protoLabel = undefined;
        }
        var protoNode = { t: 'object', label: protoLabel, children: [] };
        state.nodeCount++;
        currentTarget.children.push({ k: '[[Prototype]]', node: protoNode });

        var protoKeys;
        try {
          protoKeys = Object.getOwnPropertyNames(proto);
        } catch (_) {
          protoKeys = [];
        }
        ancestors.push(proto);
        for (var pi = 0; pi < protoKeys.length && pi < 200; pi++) {
          var pk = protoKeys[pi];
          if (SKIP[pk]) continue;
          if (state.nodeCount >= maxNodes) {
            protoNode.truncated = true;
            break;
          }
          var pVal;
          try {
            pVal = proto[pk];
          } catch (e) {
            pVal = '<threw>';
          }
          state.nodeCount++;
          protoNode.children.push({ k: pk, node: serializeValue(pVal, chainDepth + 2, ancestors, state, false) });
        }
        ancestors.pop();
        current = proto;
        currentTarget = protoNode;
        chainDepth++;
      }
      currentTarget.truncated = true;
    }

    return function serialize(root) {
      var state = { nodeCount: 0 };
      return serializeValue(root, 0, [], state);
    };
  }

  var serialize = makeSerializer();

  function send(obj) {
    obj.n = ++nonce;
    writeStderr(SENTINEL + JSON.stringify(obj) + '\n');
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
        // stderr sentinel ONLY. Unlike the Node bootstrap, no `L<line>:`
        // stdout echo — Deno/Bun console output reaches the UI through the
        // console frame; a stdout echo would double-render and costs Deno a
        // stdout write per call.
        var obj = { line: line, column: 0, level: level, text: text, args: serialized, n: ++consoleNonce };
        writeStderr(CONSOLE_SENTINEL + JSON.stringify(obj) + '\n');
      } catch (_) {
        /* console capture is best-effort */
      }
    }
  };
})();
