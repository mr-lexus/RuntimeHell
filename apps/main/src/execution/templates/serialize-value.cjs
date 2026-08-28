/**
 * Structural value serializer running INSIDE the child process (plan todo 10).
 * Plain CJS so the bootstrap can require it without a build step; also loaded
 * directly by vitest for golden testing.
 *
 * Caps (plan): depth 20 · nodes 5000 · strings 10k chars.
 * Circular refs become {t:'object', prim:'[Circular]', refId:<ancestorDepth>}
 * where refId indexes the current ancestor chain (0 = root).
 * Throwing getters serialize as the string "<threw>".
 */
'use strict';

var DEFAULT_CAPS = { maxDepth: 20, maxNodes: 5000, maxString: 10000 };

function isPlainOrObject(v) {
  return typeof v === 'object';
}

function makeSerializer(userCaps) {
  var caps = Object.assign({}, DEFAULT_CAPS, userCaps || {});

  function serializeValue(value, depth, ancestors, state) {
    if (state.nodeCount >= caps.maxNodes) {
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
      if (value.length > caps.maxString) {
        return { t: 'string', prim: value.slice(0, caps.maxString), size: value.length, truncated: true };
      }
      return { t: 'string', prim: value };
    }
    if (t === 'function') {
      var isClass = /^class[\s{]/.test(Function.prototype.toString.call(value));
      return { t: isClass ? 'class' : 'function', label: value.name || '(anonymous)', size: value.length };
    }

    // Depth cap for containers.
    if (depth >= caps.maxDepth) {
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
      if (state.nodeCount < caps.maxNodes) {
        state.nodeCount++;
        errNode.children.push({ k: 'message', node: { t: 'string', prim: String(value.message) } });
        var stack = String(value.stack ?? '');
        errNode.children.push({
          k: 'stack',
          node:
            stack.length > caps.maxString
              ? { t: 'string', prim: stack.slice(0, caps.maxString), truncated: true }
              : { t: 'string', prim: stack }
        });
      }
      return errNode;
    }

    // Dates.
    if (value instanceof Date) {
      return { t: 'date', prim: value.toISOString() };
    }

    // RegExp.
    if (value instanceof RegExp) {
      return { t: 'regexp', prim: value.source, label: value.flags };
    }

    // Promises are reported by the bootstrap (async settlement); here we can
    // only mark the immediate placeholder.
    if (value instanceof Promise) {
      return { t: 'promise', label: 'promise (settlement reported separately)' };
    }

    // Typed arrays / DataView.
    if (ArrayBuffer.isView(value)) {
      var ctor = value.constructor ? value.constructor.name : 'TypedArray';
      // TypedArrays expose .length; DataView only .byteLength.
      var len =
        typeof value.length === 'number'
          ? value.length
          : typeof value.byteLength === 'number'
            ? value.byteLength
            : 0;
      var node = { t: 'typedarray', label: ctor, size: len, children: [] };
      var show = Math.min(len, 50);
      for (var i = 0; i < show; i++) {
        if (state.nodeCount >= caps.maxNodes) {
          node.truncated = true;
          break;
        }
        state.nodeCount++;
        node.children.push({ k: String(i), node: { t: 'number', prim: String(value[i]) } });
      }
      if (show < len) node.truncated = true;
      return node;
    }

    // Arrays.
    if (Array.isArray(value)) {
      var arrNode = { t: 'array', size: value.length, children: [] };
      ancestors.push(value);
      for (var ai = 0; ai < value.length; ai++) {
        if (state.nodeCount >= caps.maxNodes) {
          arrNode.truncated = true;
          break;
        }
        arrNode.children.push({ k: String(ai), node: serializeValue(value[ai], depth + 1, ancestors, state) });
      }
      ancestors.pop();
      return arrNode;
    }

    // Map.
    if (value instanceof Map) {
      var mapNode = { t: 'map', size: value.size, children: [] };
      ancestors.push(value);
      var mi = 0;
      value.forEach(function (mv, mk) {
        if (state.nodeCount >= caps.maxNodes) {
          mapNode.truncated = true;
          return;
        }
        mapNode.children.push({ k: '[' + mi + '] key', node: serializeValue(mk, depth + 1, ancestors, state) });
        mapNode.children.push({ k: '[' + mi + '] value', node: serializeValue(mv, depth + 1, ancestors, state) });
        mi++;
      });
      ancestors.pop();
      return mapNode;
    }

    // Set.
    if (value instanceof Set) {
      var setNode = { t: 'set', size: value.size, children: [] };
      ancestors.push(value);
      var si = 0;
      value.forEach(function (sv) {
        if (state.nodeCount >= caps.maxNodes) {
          setNode.truncated = true;
          return;
        }
        setNode.children.push({ k: String(si), node: serializeValue(sv, depth + 1, ancestors, state) });
        si++;
      });
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
      if (state.nodeCount >= caps.maxNodes) {
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
    appendPrototypeChain(objNode, value, depth, ancestors, state);
    ancestors.pop();
    return objNode;
  }

  // Keep the prototype links as explicit tree nodes.  Walking until null is
  // important for `class Child extends Parent`: showing only Child.prototype
  // hides the inherited methods on Parent.prototype and Object.prototype.
  // The same caps used for ordinary values protect the inspector from hostile
  // proxies and unusually large prototype objects.
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

    while (chainDepth < caps.maxDepth) {
      var proto;
      try {
        proto = Object.getPrototypeOf(current);
      } catch (_) {
        return;
      }

      if (proto === null) {
        if (state.nodeCount >= caps.maxNodes) {
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

      if (state.nodeCount >= caps.maxNodes) {
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
        if (state.nodeCount >= caps.maxNodes) {
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
        protoNode.children.push({ k: pk, node: serializeValue(pVal, chainDepth + 2, ancestors, state) });
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

module.exports = { makeSerializer: makeSerializer, DEFAULT_CAPS: DEFAULT_CAPS };
