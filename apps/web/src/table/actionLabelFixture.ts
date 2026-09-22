import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import { AuditAction } from "@exam/authz";
import {
  TYPE_BADGE_BORDER_PX,
  TYPE_BADGE_GLYPH_WIDTH_PX,
  TYPE_BADGE_PADDING_PX,
  TYPE_CELL_BORDER_PX,
  TYPE_CELL_PADDING_PX,
} from "@/table/typeFixture";

/**
 * Action-label column width authority fixture (issue #598).
 *
 * The action-label column token (9.5rem) is VOCABULARY-BOUND: it is derived
 * from the widest legal localized operational action label, measured at the
 * real product font. The universe is rebuilt automatically from the two
 * authorities — the platform action registry (`@exam/authz` `AuditAction`, the
 * same closed vocabulary the API audit policy is exhaustively keyed by) and
 * the `admin.audit.filterActions.*` i18n copy namespace — so a newly declared
 * action grows the fixture and turns the contract guard red until display copy
 * lands and the token is revisited.
 *
 * WHY the guard covers the whole declared registry rather than an
 * "active-only" subset: action lifecycle (active / reserved / deprecated) is
 * owned by the API audit policy layer, which the web must not depend on. A
 * web-side active-only gate would therefore need a second, drifting lifecycle
 * source of truth — and it would miss exactly the defect this gate exists for:
 * `exam.published_schedule_updated` is actively emitted and shipped without
 * copy, so it silently took the raw-key path. The registry is additive by
 * contract ("new vocabulary is additive", auditActions.ts), so pinning the
 * display vocabulary to the FULL declared vocabulary is a closed rule with one
 * owner: declare an action → copy is required. Historical / version-skew rows
 * whose key is not (or no longer) in the registry still use the raw-key
 * compatibility path, which is presenter-bounded (see AuditLogPage).
 *
 * Geometry: the label renders in the audit page's page-local pill — the same
 * 12px product font + px-2 chrome family as the type-role badge, so the type
 * fixture's measured constants are reused rather than re-declared. The pill
 * carries no border, so the badge border term is a conservative +2px bound.
 */
export const ACTION_LABEL_NAMESPACE = "admin.audit.filterActions";

/** The single namespace key that is a filter option, not an action value. */
export const ACTION_LABEL_FILTER_ONLY_KEYS: readonly string[] = ["all"];

export const ACTION_LABEL_COLUMN_TOKEN = "9.5rem";
export const ACTION_LABEL_COLUMN_WIDTH_PX = 9.5 * 16; // 152px

/** The declared action vocabulary — web-visible half of the registry pair. */
export const ACTION_LABEL_VOCABULARY: readonly string[] =
  Object.values(AuditAction);

/** Estimated rendered width of one action pill (px) at the product font. */
export function estimateActionLabelWidth(label: string): number {
  return (
    label.length * TYPE_BADGE_GLYPH_WIDTH_PX +
    TYPE_BADGE_PADDING_PX +
    TYPE_BADGE_BORDER_PX
  );
}

export interface ActionLabelFixtureRow {
  action: string;
  key: string;
  locale: string;
  label: string;
  estimatedWidthPx: number;
}

/**
 * The fixture enumerates the registry DYNAMICALLY, so it must bypass the
 * per-key `t()` typing the way the locale files themselves are untyped data.
 */
type DynamicT = (key: string, options?: Record<string, unknown>) => unknown;

function namespaceLabels(locale: string): Record<string, string> {
  const t = i18n.t.bind(i18n) as DynamicT;
  const resolved = t(ACTION_LABEL_NAMESPACE, {
    lng: locale,
    returnObjects: true,
  });
  return resolved && typeof resolved === "object"
    ? (resolved as Record<string, string>)
    : {};
}

/**
 * The action values the copy namespace actually carries (filter-only keys
 * excluded). The guard pins this against {@link ACTION_LABEL_VOCABULARY} in
 * both directions: a declared action without copy would silently fall back to
 * the raw machine key, and a copy key with no declared action is dead copy or
 * a typo.
 */
export function actionLabelCopyKeys(
  locale: string = SUPPORTED_LOCALES[0],
): string[] {
  return Object.keys(namespaceLabels(locale)).filter(
    (key) => !ACTION_LABEL_FILTER_ONLY_KEYS.includes(key),
  );
}

/**
 * Derives the full action-label verification universe: every declared action
 * value × every supported locale. Copy is read from the namespace object, so a
 * declared action with no entry there falls back to its own key path in
 * {@link actionLabelFixture} — which is what the guard's `label !== key`
 * assertion reds on.
 */
export function actionLabelFixture(): ActionLabelFixtureRow[] {
  const rows: ActionLabelFixtureRow[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const labels = namespaceLabels(locale);
    for (const action of ACTION_LABEL_VOCABULARY) {
      const key = `${ACTION_LABEL_NAMESPACE}.${action}`;
      const label = String(labels[action] ?? key);
      rows.push({
        action,
        key,
        locale,
        label,
        estimatedWidthPx: estimateActionLabelWidth(label),
      });
    }
  }
  return rows;
}

/** The widest estimated action pill across the whole universe (px). */
export function maxActionLabelWidth(): number {
  return Math.max(...actionLabelFixture().map((row) => row.estimatedWidthPx));
}

/**
 * The action-label column's content box (column width − cell padding −
 * border). The frozen invariant: contentBox ≥ widest label estimate (+ slack
 * comes from the over-estimating glyph constant).
 */
export function actionLabelColumnContentBoxPx(): number {
  return (
    ACTION_LABEL_COLUMN_WIDTH_PX - TYPE_CELL_PADDING_PX - TYPE_CELL_BORDER_PX
  );
}
