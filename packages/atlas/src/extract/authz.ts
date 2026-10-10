/**
 * Authorization extraction (#764 R1-B) — the current permission catalog,
 * role presets, scope dimensions and their membership, extracted from the
 * owning implementation (`@exam/authz`) at the observed revision.
 *
 * Mirrored identity rule (ir §6.3): the IDs mirror the owning source's keys
 * VERBATIM — `permission:<key>`, `role:<Role>`, `scope:<value>`. The
 * extractor never re-spells a key.
 *
 * Preserved invariant: RolePreset ≠ effective authorization. This module
 * models the preset facts only; it computes no grantee set and no resource
 * reach (ATLAS-IR-035 — computing effective access would reimplement server
 * authorization and is a STOP condition).
 */

import { Permission, Role, ROLE_PRESETS, Scope } from "@exam/authz";
import type { SemanticInput } from "../snapshot/types.js";
import { sourceRefRecord } from "./refs.js";

const AUTHZ_SOURCE = "packages/authz/src/catalog.ts";
const PRESETS_SOURCE = "packages/authz/src/presets.ts";

export function permissionNodes(
  sourceSha: string,
): Array<Record<string, unknown>> {
  return Object.values(Permission)
    .map((key) => ({
      kind: "Permission",
      id: `permission:${key}`,
      label: key,
      source_refs: [
        sourceRefRecord(sourceSha, {
          path_or_uri: AUTHZ_SOURCE,
          symbol: "Permission",
          extraction_method: "AST_SYMBOL_LOOKUP",
        }),
      ],
      authority_refs: [],
      review_state: "CURATED",
      open_governance_item: { kind: "NONE" },
      key,
      catalog_status: "ACTIVE",
    }))
    .sort((a, b) => (String(a["id"]) < String(b["id"]) ? -1 : 1));
}

export function rolePresetNodes(
  sourceSha: string,
): Array<Record<string, unknown>> {
  return Object.values(Role)
    .map((roleKey) => {
      const preset = ROLE_PRESETS[roleKey];
      if (preset === undefined) {
        throw new Error(
          `catalog defect: Role ${roleKey} has no preset entry (ATLAS-IR-030)`,
        );
      }
      return {
        kind: "RolePreset",
        id: `role:${preset.key}`,
        label: preset.label,
        source_refs: [
          sourceRefRecord(sourceSha, {
            path_or_uri: PRESETS_SOURCE,
            symbol: "ROLE_PRESETS",
            extraction_method: "AST_SYMBOL_LOOKUP",
          }),
        ],
        authority_refs: [],
        review_state: "CURATED",
        open_governance_item: { kind: "NONE" },
        key: preset.key,
        preset_kind: preset.isSystem ? "SYNTHETIC_ACTOR" : "APPLICATION_ROLE",
        login_allowed: preset.loginAllowed ? "TRUE" : "FALSE",
        assignable: preset.assignable ? "TRUE" : "FALSE",
        default_scope: `scope:${preset.defaultScope}`,
        permissions: preset.permissions.map((p) => `permission:${p}`).sort(),
        sensitive_permissions: preset.sensitivePermissions
          .map((p) => `permission:${p}`)
          .sort(),
      };
    })
    .sort((a, b) => (String(a["id"]) < String(b["id"]) ? -1 : 1));
}

/**
 * Scope dimension nodes — one per closed catalog value, carrier NONE (a
 * dimension with no assignment dimension is itself a finding, ir §3.8).
 * Carrier-bearing scopes (e.g. scope:exam.assignment) are curated: their
 * carrier is an enforcement claim, not a catalog value.
 */
export function scopeDimensionNodes(
  sourceSha: string,
): Array<Record<string, unknown>> {
  return Object.values(Scope)
    .map((value) => ({
      kind: "Scope",
      id: `scope:${value}`,
      label: value,
      source_refs: [
        sourceRefRecord(sourceSha, {
          path_or_uri: AUTHZ_SOURCE,
          symbol: "Scope",
          extraction_method: "AST_SYMBOL_LOOKUP",
        }),
      ],
      authority_refs: [],
      review_state: "CURATED",
      open_governance_item: { kind: "NONE" },
      value,
      rbac_participation: "APPLICATION_SCOPE",
      resource_domain: value,
      assignment_carrier: "NONE",
      list_filtering: "UNKNOWN",
    }))
    .sort((a, b) => (String(a["id"]) < String(b["id"]) ? -1 : 1));
}

/** ATLAS-IR-030/085 — the role: namespace must equal the catalog set. */
export function assertRoleNamespaceMatchesCatalog(
  nodes: Array<Record<string, unknown>>,
): void {
  const expected = new Set(Object.values(Role).map((r) => `role:${r}`));
  const actual = new Set(
    nodes.filter((n) => n["kind"] === "RolePreset").map((n) => String(n["id"])),
  );
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `role: namespace diverges from the closed catalog set (ATLAS-IR-030): missing ${missing.join(", ")}; extra ${extra.join(", ")}`,
    );
  }
}

/** The complete extracted authz fragment. */
export function authzFragment(
  sourceSha: string,
): Pick<SemanticInput, "nodes" | "facts"> {
  const nodes = [
    ...permissionNodes(sourceSha),
    ...rolePresetNodes(sourceSha),
    ...scopeDimensionNodes(sourceSha),
  ];
  assertRoleNamespaceMatchesCatalog(nodes);
  const facts = [
    {
      fact_id: "fact:authz.permission-catalog",
      statement: `The permission catalog declares a closed union of ${Object.keys(Permission).length} capability keys at the observed revision.`,
      source_ref: sourceRefRecord(sourceSha, {
        path_or_uri: AUTHZ_SOURCE,
        symbol: "PermissionKey",
        extraction_method: "AST_SYMBOL_LOOKUP",
      }),
      snapshot: sourceSha,
      observed_kind: "DECLARED",
    },
    {
      fact_id: "fact:authz.role-closed-set",
      statement: `The role catalog declares the closed set {${Object.values(Role).join(", ")}} — seven presets, one of them a synthetic actor.`,
      source_ref: sourceRefRecord(sourceSha, {
        path_or_uri: AUTHZ_SOURCE,
        symbol: "Role",
        extraction_method: "AST_SYMBOL_LOOKUP",
      }),
      snapshot: sourceSha,
      observed_kind: "DECLARED",
    },
  ];
  return { nodes, facts };
}
