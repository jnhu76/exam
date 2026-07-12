/**
 * Surface semantic vocabulary — machine-readable mirror of
 * docs/frontend/P3-UI-surface-vocabulary.md (UI-SURFACE-1).
 *
 * This is the source of truth for the confirmed semantic surface recipe names.
 * Future UI-LINT-2 (`exam-ui/no-raw-surface`) synchronizes its allowed-recipe
 * list against `CONFIRMED_SURFACES`. Do not add a name here without first
 * documenting its semantic purpose in the surface vocabulary document.
 *
 * Surface roles own region-level appearance (background / border / radius /
 * elevation). They do NOT own layout, typography, component behavior, or
 * accessibility contracts, and they do NOT replace the color authority —
 * domain-status color still flows through statusMeta.ts + StatusBadge, and
 * feedback color through the --danger / --success / etc. tokens.
 */
export type SurfaceRecipeName =
  | "page"
  | "content"
  | "subtle"
  | "navigation"
  | "overlay"
  | "attention";

/** Confirmed semantic surface recipe names (one public recipe per role). */
export const CONFIRMED_SURFACES: readonly SurfaceRecipeName[] = [
  "page",
  "content",
  "subtle",
  "navigation",
  "overlay",
  "attention",
];

/** True if `name` is a confirmed semantic surface recipe. */
export function isConfirmedSurface(name: string): name is SurfaceRecipeName {
  return (CONFIRMED_SURFACES as readonly string[]).includes(name);
}

/**
 * Surface roles that legitimately own elevation (shadow). Everything else
 * must remain flat (elevation.none). Mirrors the surface vocabulary §4.2.
 */
export const ELEVATION_OWNERS: readonly SurfaceRecipeName[] = ["overlay"];

/** True if the surface role is an allowed elevation owner. */
export function ownsElevation(name: string): boolean {
  return (ELEVATION_OWNERS as readonly string[]).includes(name);
}
