/**
 * Tests for exam-ui/no-raw-typography (UI-LINT-2 Phase 1).
 *
 * Scope of Phase 1: the section-title bypass only — a className that combines a
 * section-title-scale text-size utility (text-base / text-lg) with a
 * section-title weight utility (font-semibold / font-bold) reproduces the
 * `type-section-title` recipe, which is owned by the authoritative section
 * components (PageSection / FormSection / DataTableShell).
 *
 * Deliberately NOT flagged in Phase 1:
 *   - metric-size text (text-2xl/3xl/4xl/5xl) + bold — blocked on StatsCard
 *     migration coverage (UI-MIGRATE-N);
 *   - a single size OR a single weight alone (not a recipe recomposition);
 *   - body/secondary/metadata sizes (text-sm/text-xs) — too broad, high
 *     false-positive, no migrated broad page coverage yet;
 *   - the recipe class itself (type-section-title) — that is the replacement;
 *   - purely dynamic className values.
 */
import { ruleTester } from "../../ruleTester";
import rule from "../no-raw-typography";

ruleTester().run("no-raw-typography", rule, {
  valid: [
    // 1. The semantic recipe is the replacement — never flagged.
    '<h2 className="type-section-title">{title}</h2>',
    // 2. A size utility alone is not a recomposition.
    '<h2 className="text-base">{title}</h2>',
    // 3. A weight utility alone is not a recomposition.
    '<h2 className="font-semibold">{title}</h2>',
    // 4. body/sm size + weight — not a section-title scale; allowed in Phase 1.
    '<p className="text-sm font-medium">{body}</p>',
    // 5. metadata size + weight — allowed.
    '<span className="text-xs font-medium">{meta}</span>',
    // 6. metric-size text (text-2xl) + bold — DEFERRED (StatsCard migration).
    '<p className="text-2xl font-bold">{value}</p>',
    '<p className="text-3xl font-bold tabular-nums">{value}</p>',
    // 7. Purely dynamic className.
    "<h2 className={dyn}>{title}</h2>",
    // 8. No className.
    "<h2>{title}</h2>",
    // 9. text-lg with only a color utility, no weight — not a recomposition.
    '<h2 className="text-lg text-foreground">{title}</h2>',
    // 10. tracking/leading layout utilities do not trigger.
    '<h2 className="text-lg leading-tight tracking-tight font-normal">{x}</h2>',
    // 11. font-normal (not a section-title weight) — allowed.
    '<h2 className="text-base font-normal">{title}</h2>',
  ],
  invalid: [
    // A. Canonical section-title bypass: text-base + font-semibold.
    {
      code: '<h2 className="text-base font-semibold">{title}</h2>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // B. Page-scale section title: text-lg + font-semibold.
    {
      code: '<h2 className="text-lg font-semibold">{title}</h2>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // C. font-bold variant (also a section-title weight).
    {
      code: '<h2 className="text-base font-bold">{title}</h2>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // D. On a non-heading element (a div) — still a section-title recomposition.
    {
      code: '<div className="text-lg font-semibold">{title}</div>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // E. In a cn(...) composition.
    {
      code: '<h2 className={cn("text-base", "font-semibold")}>{title}</h2>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // F. In a template literal with other utilities.
    {
      code: "<h2 className={`text-lg font-semibold ${extra}`}>{title}</h2>",
      errors: [{ messageId: "noRawTypography" }],
    },
    // G. CardTitle with the recipe (the DashboardPage bypass shape).
    {
      code: '<CardTitle className="text-lg font-semibold">{t}</CardTitle>',
      errors: [{ messageId: "noRawTypography" }],
    },
    // H. With truncation and color — still the bypass.
    {
      code: '<h1 className="truncate text-lg font-semibold text-foreground">{t}</h1>',
      errors: [{ messageId: "noRawTypography" }],
    },
  ],
});
