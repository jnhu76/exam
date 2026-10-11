/**
 * Deterministic normalization (ir §7 ATLAS-IR-063..-067).
 *
 * - Records sharing a semantic key merge deterministically: agreeing
 *   single-valued fields merge; disagreeing single-valued fields are a
 *   CONFLICT error — never first-writer-wins, never last-writer-wins
 *   (ATLAS-IR-065).
 * - Set-valued fields are the union of the inputs; order-bearing content is
 *   ordered by its declared ordering key, and two records claiming the same
 *   ordering key with different content are a CONFLICT, not a concatenation.
 * - Exactly identical parallel edges collapse to one; qualified-parallel
 *   edges remain distinct (ATLAS-IR-066).
 * - Source refs dedupe on their full form (ATLAS-IR-067).
 */

import { canonicalJson } from "./serialize.js";
import {
  buildRecordSchemas,
  validateRecordSemantics,
  type ConformanceFinding,
  type RecordSchemas,
} from "../ir/validate.js";
import {
  EDGE_KINDS,
  NODE_KINDS,
  type EdgeKind,
  type NodeKind,
} from "../ir/types.js";
import { validateRecord } from "../ir/record.js";
import { locatorKey } from "../ir/records.js";

export class SemanticConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticConflictError";
  }
}

export interface NormalizationResult {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  findings: ConformanceFinding[];
}

/** Item identity inside a set-valued array field, for merge/conflict rules. */
function arrayItemKey(field: string, item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  if (item !== null && typeof item === "object") {
    const record = item as Record<string, unknown>;
    switch (field) {
      case "source_refs":
        return locatorKey(record as never);
      case "durable_effects":
        return `${String(record["entity_ref"])}|${String(record["effect_kind"])}`;
      case "additional_gates":
        return `${String(record["capability_ref"])}|${String(record["effect"])}`;
      case "transition_refs":
        return `${String(record["target"])}|${String(record["direction"])}`;
      case "parties":
        return String(record["party"]);
      default:
        return canonicalJson(item);
    }
  }
  return canonicalJson(item);
}

/**
 * Merge two values for a field. Returns the merged value, or throws a
 * {@link SemanticConflictError} on incompatible single-value fields.
 * Array fields union by item key; same key + different content = conflict.
 */
function mergeFieldValue(
  field: string,
  a: unknown,
  b: unknown,
  where: string,
): unknown {
  if (Array.isArray(a) && Array.isArray(b)) {
    const byKey = new Map<string, unknown>();
    for (const item of [...a, ...b]) {
      const key = arrayItemKey(field, item);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, item);
        continue;
      }
      if (canonicalJson(existing) !== canonicalJson(item)) {
        throw new SemanticConflictError(
          `${where}.${field}: two records claim ordering key ${key} with different content (ATLAS-IR-065)`,
        );
      }
    }
    return [...byKey.entries()]
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([, item]) => item);
  }
  if (
    a !== null &&
    typeof a === "object" &&
    b !== null &&
    typeof b === "object"
  ) {
    const merged: Record<string, unknown> = {
      ...(a as Record<string, unknown>),
    };
    for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
      if (merged[key] === undefined) {
        merged[key] = value;
        continue;
      }
      merged[key] = mergeFieldValue(
        `${field}.${key}`,
        merged[key],
        value,
        where,
      );
    }
    return merged;
  }
  if (canonicalJson(a) !== canonicalJson(b)) {
    throw new SemanticConflictError(
      `${where}.${field}: incompatible duplicate values ${JSON.stringify(a)} vs ${JSON.stringify(b)} (ATLAS-IR-065 — conflict, never last-write-wins)`,
    );
  }
  return a;
}

function mergeRecords(
  group: Array<{ key: string; record: Record<string, unknown> }>,
  entity: string,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const { key, record } of group) {
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...record });
      continue;
    }
    const where = `${entity}[${key}]`;
    for (const [field, value] of Object.entries(record)) {
      if (existing[field] === undefined) {
        existing[field] = value;
        continue;
      }
      existing[field] = mergeFieldValue(field, existing[field], value, where);
    }
  }
  return [...byKey.values()];
}

function sortedByKey(
  records: Array<Record<string, unknown>>,
  keyField: string,
): Array<Record<string, unknown>> {
  return records.sort((a, b) => {
    const ka = String(a[keyField]);
    const kb = String(b[keyField]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Schema-validate every raw record, materialize defaults, merge duplicates,
 * and emit canonically ordered record arrays. Derived fields are NOT
 * computed here — the builder computes them before calling this; this
 * function is the last deterministic gate.
 */
/**
 * ATLAS-IR-063/065/067 — set-valued fields are deduplicated and sorted at
 * the SINGLE-RECORD level too, not only when two records merge: two
 * curation files that list the same set in different orders are the same
 * semantic input and must produce the same bytes. Keyed record sets
 * (`source_refs`, `additional_gates`, `parties`) are ordered by their key
 * with duplicate entries collapsed; free-prose lists (`does_not_prove`) keep
 * the author's order, which is content, not enumeration.
 */
const SET_VALUED_STRING_FIELDS: ReadonlySet<string> = new Set([
  "supporting_evidence",
  "challenging_evidence",
  "boundary_coverage",
  "permissions",
  "sensitive_permissions",
  "authority_refs",
  "state_values",
  "refusing_seams",
  "preset_refs",
  "consumed_by",
  "claim_refs",
]);

/**
 * Order a keyed record set by its key prefix and collapse byte-identical
 * duplicates (ATLAS-IR-067). The trailing index keeps the sort a stable
 * refinement for records that share a key prefix. Items may be locator
 * strings (an unresolved record's `source_refs`) or resolved SRef objects.
 */
function orderKeyedRecords(
  record: Record<string, unknown>,
  field: string,
  keyOf: (item: unknown) => string,
): void {
  const items = record[field];
  if (!Array.isArray(items)) return;
  const keyed = items.map((item, i) => ({
    item,
    key: `${keyOf(item)}|${String(i).padStart(6, "0")}`,
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const entry of keyed) {
    const canonical = canonicalJson(entry.item);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(entry.item);
  }
  record[field] = out;
}

function canonicalizeSetValuedFields(record: Record<string, unknown>): void {
  for (const field of SET_VALUED_STRING_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    const strings = value.filter((v): v is string => typeof v === "string");
    if (strings.length !== value.length) continue; // mixed types: leave to schema validation
    record[field] = [...new Set(strings)].sort();
  }
  orderKeyedRecords(record, "source_refs", (raw) => {
    if (typeof raw === "string") return raw;
    const ref = (raw ?? {}) as Record<string, unknown>;
    return [
      String(ref["repo"] ?? ""),
      String(ref["source_kind"] ?? ""),
      String(ref["path_or_uri"] ?? ""),
      String(ref["symbol"] ?? ""),
      String(ref["section"] ?? ""),
    ].join("|");
  });
  orderKeyedRecords(record, "additional_gates", (raw) => {
    const gate = (raw ?? {}) as Record<string, unknown>;
    return `${String(gate["capability_ref"] ?? "")}|${String(gate["effect"] ?? "")}`;
  });
  orderKeyedRecords(record, "parties", (raw) => {
    const party = (raw ?? {}) as Record<string, unknown>;
    return String(party["party"] ?? "");
  });
}

function canonicalizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  canonicalizeSetValuedFields(record);
  return record;
}

export function normalizeRecords(raw: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
}): NormalizationResult {
  const schemas: RecordSchemas = buildRecordSchemas(NODE_KINDS, EDGE_KINDS);
  const findings: ConformanceFinding[] = [];

  const canonicalNodes: Array<Record<string, unknown>> = [];
  raw.nodes.forEach((node, i) => {
    const kind = node["kind"];
    if (
      typeof kind !== "string" ||
      !(NODE_KINDS as readonly string[]).includes(kind)
    ) {
      throw new SemanticConflictError(
        `nodes[${i}]: unknown node kind ${JSON.stringify(kind)}`,
      );
    }
    const fields = schemas.nodes[kind as NodeKind];
    const path = `nodes[${i}]`;
    validateRecord(fields, node, path);
    const { errors, findings: recordFindings } = validateRecordSemantics(
      "node",
      node,
      path,
    );
    if (errors.length > 0) {
      throw new SemanticConflictError(errors.join("\n"));
    }
    findings.push(...recordFindings);
    canonicalNodes.push(canonicalizeRecord(fields.applyDefaults(node)));
  });

  const canonicalEdges: Array<Record<string, unknown>> = [];
  raw.edges.forEach((edge, i) => {
    const kind = edge["kind"];
    if (
      typeof kind !== "string" ||
      !(EDGE_KINDS as readonly string[]).includes(kind)
    ) {
      throw new SemanticConflictError(
        `edges[${i}]: unknown edge kind ${JSON.stringify(kind)}`,
      );
    }
    const fields = schemas.edges[kind as EdgeKind];
    const path = `edges[${i}]`;
    validateRecord(fields, edge, path);
    canonicalEdges.push(canonicalizeRecord(fields.applyDefaults(edge)));
  });

  const canonicalFacts: Array<Record<string, unknown>> = [];
  raw.facts.forEach((fact, i) => {
    validateRecord(schemas.fact, fact, `facts[${i}]`);
    canonicalFacts.push(canonicalizeRecord(schemas.fact.applyDefaults(fact)));
  });

  const canonicalEvidence: Array<Record<string, unknown>> = [];
  raw.evidence.forEach((evidence, i) => {
    const path = `evidence[${i}]`;
    validateRecord(schemas.evidence, evidence, path);
    const { errors, findings: recordFindings } = validateRecordSemantics(
      "evidence",
      evidence,
      path,
    );
    if (errors.length > 0) {
      throw new SemanticConflictError(errors.join("\n"));
    }
    findings.push(...recordFindings);
    canonicalEvidence.push(
      canonicalizeRecord(schemas.evidence.applyDefaults(evidence)),
    );
  });

  const canonicalClaims: Array<Record<string, unknown>> = [];
  raw.claims.forEach((claim, i) => {
    const path = `claims[${i}]`;
    validateRecord(schemas.claim, claim, path);
    const { errors, findings: recordFindings } = validateRecordSemantics(
      "claim",
      claim,
      path,
    );
    if (errors.length > 0) {
      throw new SemanticConflictError(errors.join("\n"));
    }
    findings.push(...recordFindings);
    canonicalClaims.push(
      canonicalizeRecord(schemas.claim.applyDefaults(claim)),
    );
  });

  const canonicalConflicts: Array<Record<string, unknown>> = [];
  raw.conflicts.forEach((conflict, i) => {
    validateRecord(schemas.conflict, conflict, `conflicts[${i}]`);
    canonicalConflicts.push(
      canonicalizeRecord(schemas.conflict.applyDefaults(conflict)),
    );
  });

  return {
    nodes: (() => {
      const merged = mergeRecords(groupNodes(canonicalNodes), "node").sort(
        (a, b) => {
          const ka = `${String(a["kind"])}|${String(a["id"])}`;
          const kb = `${String(b["kind"])}|${String(b["id"])}`;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        },
      );
      return merged;
    })(),
    edges: mergeEdges(canonicalEdges),
    facts: sortedByKey(
      mergeRecords(
        canonicalFacts.map((r) => ({ key: String(r["fact_id"]), record: r })),
        "fact",
      ),
      "fact_id",
    ),
    evidence: sortedByKey(
      mergeRecords(
        canonicalEvidence.map((r) => ({
          key: String(r["evidence_id"]),
          record: r,
        })),
        "evidence",
      ),
      "evidence_id",
    ),
    claims: sortedByKey(
      mergeRecords(
        canonicalClaims.map((r) => ({ key: String(r["claim_id"]), record: r })),
        "claim",
      ),
      "claim_id",
    ),
    conflicts: sortedByKey(
      mergeRecords(
        canonicalConflicts.map((r) => ({
          key: String(r["conflict_id"]),
          record: r,
        })),
        "conflict",
      ),
      "conflict_id",
    ),
    findings,
  };
}

/**
 * Merge + order edges: key = (source, kind, target, discriminator tuple in
 * schema field order) — ATLAS-IR-061/-066.
 */
function mergeEdges(
  edges: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const edge of edges) {
    const kind = String(edge["kind"]) as EdgeKind;
    const discriminator = edgeDiscriminator(kind, edge);
    const key = `${String(edge["source"])}|${kind}|${String(edge["target"])}|${discriminator}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, edge);
      continue;
    }
    if (canonicalJson(existing) !== canonicalJson(edge)) {
      throw new SemanticConflictError(
        `edge ${key}: parallel edges with identical qualifiers but different content (ATLAS-IR-066)`,
      );
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const ka = `${String(a["source"])}|${String(a["kind"])}|${String(a["target"])}|${edgeDiscriminator(String(a["kind"]) as EdgeKind, a)}`;
    const kb = `${String(b["source"])}|${String(b["kind"])}|${String(b["target"])}|${edgeDiscriminator(String(b["kind"]) as EdgeKind, b)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** The full qualifying-attribute tuple, in schema field order. */
function edgeDiscriminator(
  kind: EdgeKind,
  edge: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const push = (value: unknown) => parts.push(JSON.stringify(value) ?? "null");
  switch (kind) {
    case "performs":
      push(edge["step_index"]);
      push(edge["optionality"]);
      break;
    case "transitions_to":
      push(edge["direction"]);
      push(edge["guard_ref"]);
      push(edge["reachability"]);
      break;
    case "reads":
    case "writes":
      push(edge["effect_kind"]);
      push(edge["mutability"]);
      break;
    case "tracked_by":
      push(edge["relation"]);
      break;
    default:
      break;
  }
  return parts.join("|");
}

function groupNodes(
  nodes: Array<Record<string, unknown>>,
): Array<{ key: string; record: Record<string, unknown> }> {
  return nodes.map((record) => ({
    key: `${String(record["kind"])}|${String(record["id"])}`,
    record,
  }));
}
