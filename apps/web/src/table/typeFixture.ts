import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import { AssignableRoleSchema } from "@exam/contracts";

/**
 * Type column width authority fixture (issue #590).
 *
 * The type column token (7.25rem) is VOCABULARY-BOUND: it is derived from the
 * widest legal badge across the bounded enumerated-label families rendered in
 * type-role columns, measured at the real product font. The families are the
 * authority-backed enumerated-label universes — user role labels (including
 * the `unknown` display fallback), question-type labels in both namespaces
 * that render them, candidate-field type/required labels, import-log types,
 * and incident severities. This module rebuilds the derivation automatically
 * from those authorities — no copied label list — so a new label in any
 * family grows the fixture and turns the structural test red until the token
 * is revisited.
 *
 * Deliberately NOT part of this fixture — content wider than the token that
 * is tracked as the focused type-role vocabulary follow-up of issue #590
 * (fitting them would drive the token to ~9.5rem and is a separate contract
 * decision, not a silent inheritance of this derivation):
 *   - audit-log action pills (`admin.audit.filterActions.*`; widest
 *     关闭考试（自动） ≈ 112px — an enumerated family, but audit-only) and
 *     raw audit action-key/target-type fallbacks (unbounded machine strings);
 *   - InvitationsCard `expiresAt`, a toLocaleString() datetime misdeclared
 *     into the type role (semantically a date-role column).
 *
 * The per-glyph width is a MEASURED product constant (Chromium, 12px badge
 * text — the same measurement campaign as statusFixture's 12.4px constant):
 * every character is estimated at the CJK advance, an over-estimate for
 * ASCII, so the estimator is a safe upper bound. The runtime half of the
 * two-level gate renders the real pill in the dense-table-cell-fitting E2E.
 */
export const TYPE_BADGE_GLYPH_WIDTH_PX = 12.4;
export const TYPE_BADGE_PADDING_PX = 16; // px-2 × 2 (covers the narrower workbench-compact badge)
export const TYPE_BADGE_BORDER_PX = 2; // 1px border × 2 (workbench-compact is borderless; bound covers it)
export const TYPE_CELL_PADDING_PX = 32; // px-4 × 2
export const TYPE_CELL_BORDER_PX = 1;
export const TYPE_COLUMN_TOKEN = "7.25rem";
export const TYPE_COLUMN_WIDTH_PX = 7.25 * 16; // 116px

/** Estimated rendered width of one type badge (px) at the product font. */
export function estimateTypeBadgeWidth(label: string): number {
  return (
    label.length * TYPE_BADGE_GLYPH_WIDTH_PX +
    TYPE_BADGE_PADDING_PX +
    TYPE_BADGE_BORDER_PX
  );
}

/**
 * The i18n namespaces whose full key sets are enumerated-label families
 * rendered in type columns. Enumerating the namespace object (not a copied
 * key list) keeps the locale files the single copy authority: a new label
 * key enters the fixture automatically.
 */
export const TYPE_LABEL_NAMESPACES = [
  "admin.users.roleLabels",
  "questionType",
  "admin.questions.questionTypes",
  "candidateResult.questionTypes",
  "admin.candidateFields.typeLabels",
  "admin.candidateFields.requiredLabels",
  "admin.importLogs.typeLabels",
  "admin.recoveryQueue.severity",
] as const;

export interface TypeBadgeFixtureRow {
  family: string;
  key: string;
  locale: string;
  label: string;
  estimatedWidthPx: number;
}

/**
 * The fixture enumerates label families DYNAMICALLY (namespace objects, not
 * literal keys), so it must bypass the per-key `t()` typing the way the
 * locale files themselves are untyped data.
 */
type DynamicT = (key: string, options?: Record<string, unknown>) => unknown;

function namespaceLabels(
  namespace: string,
  locale: string,
): Record<string, string> {
  const t = i18n.t.bind(i18n) as DynamicT;
  const resolved = t(namespace, { lng: locale, returnObjects: true });
  return resolved && typeof resolved === "object"
    ? (resolved as Record<string, string>)
    : {};
}

/**
 * Derives the full type-badge verification universe from the authorities:
 * the role-label family keys from AssignableRoleSchema (+ the `unknown`
 * display fallback, which UsersPage renders for any unlocalized catalog
 * label), plus every key of each label namespace above, per locale.
 */
export function typeBadgeFixture(): TypeBadgeFixtureRow[] {
  const t = i18n.t.bind(i18n) as DynamicT;
  const rows: TypeBadgeFixtureRow[] = [];
  const roleKeys = [...AssignableRoleSchema.options, "unknown"];
  for (const locale of SUPPORTED_LOCALES) {
    for (const family of TYPE_LABEL_NAMESPACES) {
      const labels = namespaceLabels(family, locale);
      const keys =
        family === "admin.users.roleLabels" ? roleKeys : Object.keys(labels);
      for (const key of keys) {
        const label = String(
          labels[key] ?? t(`${family}.${key}`, { lng: locale }),
        );
        rows.push({
          family,
          key,
          locale,
          label,
          estimatedWidthPx: estimateTypeBadgeWidth(label),
        });
      }
    }
  }
  return rows;
}

/** The widest estimated badge across the whole universe (px). */
export function maxTypeBadgeWidth(): number {
  return Math.max(...typeBadgeFixture().map((row) => row.estimatedWidthPx));
}

/**
 * The type column's content box (column width − cell padding − border).
 * The frozen invariant: contentBox ≥ widest badge (+ slack comes from the
 * over-estimating glyph constant).
 */
export function typeColumnContentBoxPx(): number {
  return TYPE_COLUMN_WIDTH_PX - TYPE_CELL_PADDING_PX - TYPE_CELL_BORDER_PX;
}
