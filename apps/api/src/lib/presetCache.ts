/**
 * Shared role-preset permission cache (P4-2A review fix #1).
 *
 * The same memoized preset lookup was duplicated in plugins/auth.ts and
 * plugins/authz.ts. This module is the single source of truth; both
 * `requireCapability`, `requireScopedCapability`, and shadow evaluation import
 * `presetAllows` from here.
 *
 * Presets are static, so the cache is safe for the process lifetime.
 */
import {
  permissionsForRole,
  type PermissionKey,
  type RoleKey,
} from "@exam/authz";

const PRESET_SETS = new Map<RoleKey, ReadonlySet<PermissionKey>>();

function presetSet(role: RoleKey): ReadonlySet<PermissionKey> {
  let set = PRESET_SETS.get(role);
  if (!set) {
    set = new Set<PermissionKey>(permissionsForRole(role));
    PRESET_SETS.set(role, set);
  }
  return set;
}

export function presetAllows(
  role: RoleKey,
  permission: PermissionKey,
): boolean {
  return presetSet(role).has(permission);
}
