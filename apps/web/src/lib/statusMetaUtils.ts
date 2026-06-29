import { statusMeta } from "./statusMeta.js";

/**
 * The full union of all status label keys (literal strings), extracted from
 * the `statusMeta` table via `satisfies`. Used to bridge the widened
 * `StatusMeta.labelKey: string` (interface) back to the literal-key union that
 * react-i18next's type-augmented `t()` requires.
 *
 * Why this exists: `StatusMeta` is an interface, so its `labelKey` is widened
 * to `string`. But `statusMeta` is declared `as const satisfies Record<...>`,
 * which preserves the literal key per entry. `LabelKey` captures that union so
 * call sites can write `t(statusLabelKey(meta.labelKey))` and stay compile-time
 * safe without scattering `as` casts.
 */
export type LabelKey = (typeof statusMeta)[keyof typeof statusMeta]["labelKey"];

/**
 * Narrows a runtime status `labelKey` string to the `LabelKey` literal union.
 *
 * This is a *type-level* bridge only — it performs no runtime check because the
 * value already comes from `statusMeta` (a closed table). If `labelKey` were
 * ever sourced from outside the table, add a runtime guard; today every caller
 * passes `getStatusMeta(status).labelKey`, which is always a valid key.
 */
export function statusLabelKey(key: string): LabelKey {
  return key as LabelKey;
}
