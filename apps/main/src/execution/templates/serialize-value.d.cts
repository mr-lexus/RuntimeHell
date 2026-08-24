/** Type surface for templates/serialize-value.cjs (loaded via CJS interop). */
export interface SerializerCaps {
  maxDepth?: number;
  maxNodes?: number;
  maxString?: number;
}

export interface SVNode {
  t: string;
  prim?: string;
  label?: string;
  size?: number;
  children?: { k: string; node: SVNode }[];
  refId?: number;
  truncated?: boolean;
}

export declare const DEFAULT_CAPS: Required<SerializerCaps>;
export declare function makeSerializer(userCaps?: SerializerCaps): (root: unknown) => SVNode;
