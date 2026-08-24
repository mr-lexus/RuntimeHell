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
    var objNode = { t: 'object', label: value.constructor && value.constructor.name !== 'Object' ? value.constructor.name : undefined, children: [] };
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
    ancestors.pop();
    return objNode;
  }

  return function serialize(root) {
    var state = { nodeCount: 0 };
    return serializeValue(root, 0, [], state);
  };
}

module.exports = { makeSerializer: makeSerializer, DEFAULT_CAPS: DEFAULT_CAPS };
