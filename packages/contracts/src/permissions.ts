import { z } from "zod";

/**
 * Read-projection contracts for the authorization surfaces.
 *
 * These are THIN projections of existing authority — the values come from
 * `@exam/authz` (permission catalog, role presets) and from the assignment
 * authority kernel (`deriveAssignmentAuthority`) — never from a new registry,
 * DB table, or frontend copy. See `docs/architecture/authorization.md`.
 */

// ── Permission registry projection ───────────────────────────────────

/** One permission key with its semantic display category. */
export const PermissionEntrySchema = z.object({
  key: z.string(),
  category: z.string(),
});

export type PermissionEntry = z.infer<typeof PermissionEntrySchema>;

/** One role preset projected for the roles × permissions matrix. */
export const RolePresetEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  purpose: z.string(),
  isSystem: z.boolean(),
  assignable: z.boolean(),
  loginAllowed: z.boolean(),
  defaultScope: z.string(),
  permissions: z.array(z.string()),
  sensitivePermissions: z.array(z.string()),
});

export type RolePresetEntry = z.infer<typeof RolePresetEntrySchema>;

/** Response for `GET /admin/permission-registry`. */
export const PermissionRegistryResponseSchema = z.object({
  permissions: z.array(PermissionEntrySchema),
  rolePresets: z.array(RolePresetEntrySchema),
});

export type PermissionRegistryResponse = z.infer<
  typeof PermissionRegistryResponseSchema
>;

// ── Effective authority of a user ─────────────────────────────────────

/**
 * The resolved assignment authority for one user — the discriminated result of
 * the existing `deriveAssignmentAuthority` kernel, projected verbatim. An
 * `ok:false` result is a NORMAL outcome (e.g. `no_active_assignments`), not an
 * error.
 */
export const EffectiveAuthoritySchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    authority: z.object({
      primaryRole: z.string(),
      activeRoles: z.array(z.string()),
      capabilities: z.array(z.string()),
      assignmentIds: z.array(z.string()),
    }),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
  }),
]);

export type EffectiveAuthority = z.infer<typeof EffectiveAuthoritySchema>;

/** One user-role-assignment row (the authoritative source for the "why"). */
export const UserAssignmentEntrySchema = z.object({
  id: z.string(),
  role: z.string(),
  isPrimary: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type UserAssignmentEntry = z.infer<typeof UserAssignmentEntrySchema>;

/** Response for `GET /admin/users/:id/effective-authority`. */
export const EffectiveAuthorityResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    username: z.string(),
  }),
  authority: EffectiveAuthoritySchema,
  assignments: z.array(UserAssignmentEntrySchema),
});

export type EffectiveAuthorityResponse = z.infer<
  typeof EffectiveAuthorityResponseSchema
>;

// ── Audit action metadata projection ─────────────────────────────────

/** One active audit action projected from the audit policy registry. */
export const AuditActionMetadataEntrySchema = z.object({
  action: z.string(),
  durability: z.string(),
  obligation: z.string(),
  frequency: z.string(),
});

export type AuditActionMetadataEntry = z.infer<
  typeof AuditActionMetadataEntrySchema
>;

/** Response for `GET /admin/audit-log/actions`. */
export const AuditActionMetadataResponseSchema = z.object({
  actions: z.array(AuditActionMetadataEntrySchema),
});

export type AuditActionMetadataResponse = z.infer<
  typeof AuditActionMetadataResponseSchema
>;
