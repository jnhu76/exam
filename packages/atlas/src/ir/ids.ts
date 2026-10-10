/**
 * Atlas IR v0.1 stable logical IDs — ATLAS-IR-026/-027/-020.
 *
 * The grammar is per-namespace, not one character class. `SEMANTIC_ID !=
 * SOURCE_PATH`: no identity may contain a repository path, file name,
 * extension, line number or commit SHA (ATLAS-IR-020). A pure file move or
 * rename must never change a semantic ID.
 */

import {
  CURATED_NAMESPACES,
  MIRRORED_NAMESPACES,
  type NodeKind,
} from "./types.js";

/** Node kind → its ID namespace prefix (ir §2). */
const KIND_NAMESPACE: Record<NodeKind, string> = {
  Capability: "capability",
  Facet: "facet",
  Workflow: "workflow",
  Operation: "operation",
  Interface: "interface",
  Permission: "permission",
  RolePreset: "role",
  Scope: "scope",
  PolicyValue: "policy",
  DurableEntity: "entity",
  NormativeAuthority: "authority",
  WorkItem: "work",
};

/** Namespace prefix → the node kinds that may carry it. */
const NAMESPACE_KINDS: Map<string, Set<NodeKind>> = (() => {
  const map = new Map<string, Set<NodeKind>>();
  for (const kind of Object.keys(KIND_NAMESPACE) as NodeKind[]) {
    const ns = KIND_NAMESPACE[kind];
    const set = map.get(ns) ?? new Set<NodeKind>();
    set.add(kind);
    map.set(ns, set);
  }
  return map;
})();

/** Curated segment: `[a-z0-9][a-z0-9_-]*` (ATLAS-IR-026). */
const CURATED_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** Mirrored keys are the owner's spelling verbatim — reject only what could
 * never be a catalog key: whitespace, empty, control characters. */
const MIRRORED_KEY = /^[^\s:#]+$/;

/** Work item external object form: `work:<owner>/<repo>#<number>`. */
const WORK_ID = /^[\w.-]+\/[\w.-]+#\d+$/;

/** HTTP interface local part: `http.<METHOD>.<path-template>`. */
const HTTP_INTERFACE = /^http\.([A-Z]+)\.(\/.*)$/;

/** Seam interface local part: `<seam-kind>.<curated-name>`. */
const SEAM_INTERFACE =
  /^([a-z][a-z0-9_-]*)\.([a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*)$/;

export class InvalidAtlasIdError extends Error {
  constructor(
    readonly id: string,
    reason: string,
  ) {
    super(`invalid Atlas ID "${id}": ${reason}`);
    this.name = "InvalidAtlasIdError";
  }
}

/** The namespace prefix of an ID, or an error if there is none. */
export function idNamespace(id: string): string {
  const idx = id.indexOf(":");
  if (idx <= 0) {
    throw new InvalidAtlasIdError(id, "missing namespace prefix");
  }
  return id.slice(0, idx);
}

/** The node kinds allowed to carry `id`, per its namespace. */
export function kindsForId(id: string): ReadonlySet<NodeKind> {
  const ns = idNamespace(id);
  const kinds = NAMESPACE_KINDS.get(ns);
  if (!kinds) {
    throw new InvalidAtlasIdError(id, `unknown namespace "${ns}"`);
  }
  return kinds;
}

function validateCuratedLocal(id: string, local: string): void {
  const segments = local.split(".");
  if (segments.length === 0 || local.length === 0) {
    throw new InvalidAtlasIdError(id, "empty local name");
  }
  for (const segment of segments) {
    if (!CURATED_SEGMENT.test(segment)) {
      throw new InvalidAtlasIdError(
        id,
        `segment "${segment}" violates the curated grammar [a-z0-9][a-z0-9_-]*`,
      );
    }
  }
}

function validatePolicyLocal(id: string, local: string): void {
  const slash = local.indexOf("/");
  if (slash <= 0 || slash === local.length - 1) {
    throw new InvalidAtlasIdError(
      id,
      'policy ID must be "<dimension>/<value>"',
    );
  }
  const dimension = local.slice(0, slash);
  const value = local.slice(slash + 1);
  // The dimension mirrors the owning source's field path verbatim
  // (e.g. exam.timingMode), so camelCase segments are legal here.
  const POLICY_DIMENSION_SEGMENT = /^[a-z][a-zA-Z0-9_-]*$/;
  for (const segment of dimension.split(".")) {
    if (!POLICY_DIMENSION_SEGMENT.test(segment)) {
      throw new InvalidAtlasIdError(
        id,
        `policy dimension segment "${segment}" violates the mirrored-dimension grammar`,
      );
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new InvalidAtlasIdError(
      id,
      `policy value "${value}" is not a valid verbatim value`,
    );
  }
}

function validateHttpInterface(id: string, local: string): void {
  const match = HTTP_INTERFACE.exec(local);
  if (!match) {
    throw new InvalidAtlasIdError(
      id,
      'HTTP interface ID must be "http.<METHOD>.<path-template>"',
    );
  }
  const method = match[1];
  const path = match[2];
  if (method === undefined || path === undefined) {
    throw new InvalidAtlasIdError(
      id,
      'HTTP interface ID must be "http.<METHOD>.<path-template>"',
    );
  }
  if (!/^[A-Z]+$/.test(method)) {
    throw new InvalidAtlasIdError(id, "HTTP method must be upper case");
  }
  if (!path.startsWith("/")) {
    throw new InvalidAtlasIdError(id, "HTTP path template must start with /");
  }
  if (/[#?]/.test(path)) {
    throw new InvalidAtlasIdError(
      id,
      "HTTP path template must not carry query or fragment",
    );
  }
}

/**
 * Validate an ID against its own namespace sub-grammar (ATLAS-IR-026).
 * Throws {@link InvalidAtlasIdError} on violation.
 */
export function validateAtlasId(id: string): void {
  const ns = idNamespace(id);
  const local = id.slice(ns.length + 1);
  if (CURATED_NAMESPACES.includes(ns as (typeof CURATED_NAMESPACES)[number])) {
    validateCuratedLocal(id, local);
    return;
  }
  switch (ns) {
    case "permission":
    case "role":
    case "authority":
      if (!MIRRORED_KEY.test(local)) {
        throw new InvalidAtlasIdError(
          id,
          "mirrored key must be the owner's spelling verbatim",
        );
      }
      return;
    case "policy":
      validatePolicyLocal(id, local);
      return;
    case "work":
      if (!WORK_ID.test(local)) {
        throw new InvalidAtlasIdError(
          id,
          'work ID must be "<owner>/<repo>#<number>"',
        );
      }
      return;
    case "interface":
      if (local.startsWith("http.")) {
        validateHttpInterface(id, local);
      } else {
        const match = SEAM_INTERFACE.exec(local);
        if (!match) {
          throw new InvalidAtlasIdError(
            id,
            'non-HTTP interface ID must be "<seam-kind>.<curated-name>"',
          );
        }
      }
      return;
    default:
      throw new InvalidAtlasIdError(id, `unknown namespace "${ns}"`);
  }
}

/** True when `id` satisfies its namespace sub-grammar. */
export function isValidAtlasId(id: string): boolean {
  try {
    validateAtlasId(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * ATLAS-IR-027 — HTTP path-template normalization, so two writers cannot
 * emit different IDs for one endpoint: upper-case method; registered path
 * with its runtime prefix and leading `/`; duplicate slashes collapsed;
 * trailing slash removed; parameter names kept verbatim; no query, fragment
 * or host; path case preserved.
 */
export function normalizeHttpPathTemplate(
  method: string,
  rawPath: string,
): string {
  const upper = method.toUpperCase();
  let path = rawPath.trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const qOrHash = path.search(/[?#]/);
  if (qOrHash >= 0) {
    path = path.slice(0, qOrHash);
  }
  return `interface:http.${upper}.${path}`;
}

/** Build a validated ID of the given kind, or throw. */
export function atlasId(kind: NodeKind, localName: string): string {
  const id = `${KIND_NAMESPACE[kind]}:${localName}`;
  validateAtlasId(id);
  return id;
}

/** Reject any ID that smuggles a repository path, extension, line or SHA. */
const PATH_SMUGGLE =
  /\.(ts|tsx|js|mjs|json|md|sql)$|(^|[./])(src|apps|packages|dist|node_modules)([./]|$)|:\d+/;

/**
 * ATLAS-IR-020/ATLAS-IR-081 — no identity may contain a repository path,
 * file name, extension, line number or SHA. Applied to every node ID at
 * normalization time; a violation is a writer defect.
 *
 * HTTP interface IDs are exempt: their `contract_identity` (method +
 * normalized path template) IS the wire-contract identity by ATLAS-IR-024,
 * and `:param` segments are verbatim template parameters, not line anchors.
 */
export function assertIdIsNotASourcePath(id: string): void {
  if (id.startsWith("interface:http.")) {
    return;
  }
  const local = id.slice(id.indexOf(":") + 1);
  if (PATH_SMUGGLE.test(local)) {
    throw new InvalidAtlasIdError(
      id,
      "semantic ID must not embed a repository path, extension or line (ATLAS-IR-020)",
    );
  }
  if (/[0-9a-f]{40}/.test(local)) {
    throw new InvalidAtlasIdError(
      id,
      "semantic ID must not embed a commit SHA",
    );
  }
}
