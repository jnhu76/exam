import { ruleTester } from "../../ruleTester";
import rule from "../no-typography-authority-conflict";

/**
 * Recipe-authority conflict rule tests
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §12, §17D).
 *
 * These prove the deterministic, semantic-free conflict gate across:
 *  - the canonical §12 examples;
 *  - property-BUNDLE modeling (text-3xl touches size+line-height);
 *  - variant TARGET (descendant/pseudo-element utilities do NOT conflict);
 *  - co-occurrence path independence (no cross-path false conflicts);
 *  - color participation (color is owned by most recipes);
 *  - inline-style keys on a recipe node;
 *  - multiple recipes on one path.
 */
ruleTester().run("no-typography-authority-conflict", rule, {
  valid: [
    // 1. No recipe present → rule does not apply.
    '<div className="text-lg font-semibold">x</div>',
    // 3. type-numeric text-sm font-mono is VALID — size/family/weight layout-owned.
    '<div className="type-numeric text-sm font-mono">x</div>',
    // 4. Structural companions never conflict (touch no owned property).
    '<h2 className="type-section-title mt-4 flex rounded-md">x</h2>',
    // 5. min-h-* on type-long-response is VALID — min-height is layout-owned.
    '<div className="type-long-response min-h-16">x</div>',
    // 6. A descendant-target variant does NOT conflict with the root recipe.
    '<div className="type-metadata [&>span]:text-lg">x</div>',
    // 7. A pseudo-element variant does NOT conflict with the root recipe.
    '<div className="type-metadata before:text-xs">x</div>',
    // 8. Co-occurrence: two branches that never co-exist → no false conflict.
    '<div className={cond ? "type-metadata" : "type-metric"}>x</div>',
    // 10. A recipe alone with no conflicting companion.
    '<div className="type-page-title">x</div>',
    // 11. Dynamic className → unknown → not enforced.
    "<div className={someVar}>x</div>",
    // 12. text-3xl on type-section-title would conflict, but here it is absent.
    '<h2 className="type-section-title">x</h2>',
    // 13. Inline style on a NON-recipe node is not this rule's concern.
    "<div style={{ fontSize: 11 }}>x</div>",
    // 14. Inline style touching a LAYOUT-OWNED property on a recipe node is valid.
    '<div className="type-numeric" style={{ fontSize: 11 }}>x</div>',
  ],
  invalid: [
    // A. §12 example: type-metadata leading-none → conflict (line-height owned).
    {
      code: '<div className="type-metadata leading-none">x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
    {
      code: '<div className="type-metric text-3xl">x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // B. §12 example: type-metadata text-sm → conflict (font-size + line-height owned).
    {
      code: '<div className="type-metadata text-sm">x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // C. §12 example: type-section-title text-lg font-semibold → conflict.
    {
      code: '<h2 className="type-section-title text-lg font-semibold">x</h2>',
      errors: [
        { messageId: "authorityConflict" },
        { messageId: "authorityConflict" },
      ],
    },
    // D. Color participates: text-red-500 on type-section-title (color owned).
    {
      code: '<h2 className="type-section-title text-red-500">x</h2>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // E. Self-target variant still conflicts (md:text-lg on section-title).
    {
      code: '<h2 className="type-section-title md:text-lg">x</h2>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // F. Interaction variant conflicts (hover:font-bold on section-title).
    {
      code: '<h2 className="type-section-title hover:font-bold">x</h2>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // G. font-[family-name:...] on a family-owning recipe conflicts.
    {
      code: '<div className="type-metadata font-[family-name:Inter]">x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // H. Multiple recipes on one path → MULTIPLE_TYPE_RECIPES.
    {
      code: '<div className="type-body type-metadata">x</div>',
      errors: [{ messageId: "multipleRecipes" }],
    },
    // I. Inline-style owned-property key on a recipe node conflicts.
    {
      code: '<div className="type-metadata" style={{ lineHeight: 1.2 }}>x</div>',
      errors: [{ messageId: "authorityConflictInlineStyle" }],
    },
    // J. Inline-style color key on a color-owning recipe conflicts.
    {
      code: '<div className="type-section-title" style={{ color: "red" }}>x</div>',
      errors: [{ messageId: "authorityConflictInlineStyle" }],
    },
    // K. The font shorthand inline-style expands to multiple owned props.
    {
      code: '<div className="type-metadata" style={{ font: "500 12px/1 sans-serif" }}>x</div>',
      errors: [{ messageId: "authorityConflictInlineStyle" }],
    },
    // L. Co-occurrence: BOTH branches conflict independently → two reports.
    {
      code: '<div className={cond ? "type-metadata leading-none" : "type-metadata text-sm"}>x</div>',
      errors: [
        { messageId: "authorityConflict" },
        { messageId: "authorityConflict" },
      ],
    },
    // M. Conflict inside a cn() composition.
    {
      code: '<div className={cn("type-metadata", "leading-none")}>x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
    // N. important modifier pierces authority → conflict on owned property.
    {
      code: '<div className="type-metadata leading-none!">x</div>',
      errors: [{ messageId: "authorityConflict" }],
    },
  ],
});
