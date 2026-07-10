/**
 * Tests for exam-ui/no-raw-surface-recipe (UI-LINT-2 Phase 2).
 *
 * Phase 2 scope: the surface-content bypass only — a className that combines
 * the surface-content primitives (bg-card + border + rounded-lg/rounded panel
 * radius) reproduces the `surface-content` recipe, which is owned by the
 * authoritative content components (PageSection / DataTableShell / FormSection)
 * and by the shadcn <Card> primitive (in components/ui, excluded from lint).
 *
 * Detection boundary (evidence-driven, to keep false positives low):
 *
 *   bg-card  +  border (default)  +  rounded-lg OR rounded (panel radius)
 *
 * - `<Card>` itself is NEVER flagged: its bg-card/border/rounded live in the
 *   generated shadcn primitive (components/ui), which is excluded from lint
 *   scope. So business pages may freely use <Card> as a low-level primitive
 *   (Option A — Card stays primitive).
 * - `rounded-md` (control radius) is deliberately NOT a panel radius: a
 *   control block like ExamTimer uses `rounded-md border ... bg-card` and is
 *   NOT a surface-content recomposition, so it is not flagged.
 * - A single primitive (bg-card alone, border alone) is not a recomposition.
 * - Purely dynamic className values are not inspected.
 *
 * Deliberately NOT flagged:
 *   - shadow-sm on its own (covered by no-business-shadow);
 *   - attention surfaces (bg-destructive/10 etc.) — component-owned
 *     (InlineErrorBanner / ErrorState);
 *   - subtle surfaces (bg-muted) — legitimate primitive;
 *   - the recipe class itself (surface-content).
 */
import { ruleTester } from "../../ruleTester";
import rule from "../no-raw-surface-recipe";

ruleTester().run("no-raw-surface-recipe", rule, {
  valid: [
    // 1. The semantic recipe is the replacement — never flagged.
    '<div className="surface-content p-5">{children}</div>',
    // 2. <Card> usage is never flagged by THIS rule (Card is a primitive; its
    //    utilities live in components/ui which is out of lint scope). We do
    //    not even inspect it here.
    '<Card className="shadow-sm">{children}</Card>',
    // 3. bg-card alone — not a recomposition.
    '<div className="bg-card">{x}</div>',
    // 4. border alone.
    '<div className="border rounded-lg">{x}</div>',
    // 5. rounded-lg alone.
    '<div className="rounded-lg bg-card">{x}</div>',
    // 6. Control-radius (rounded-md) block like ExamTimer: NOT a panel surface.
    '<div className="rounded-md border px-3 bg-card text-foreground">{x}</div>',
    // 7. rounded-md + bg-card + border-border in a cn() — control, not panel.
    '<div className={cn("rounded-md border", "bg-card")}>{x}</div>',
    // 8. attention surface (destructive) — component-owned, not flagged here.
    '<div className="rounded-lg border-destructive bg-destructive/10">{x}</div>',
    // 9. subtle surface — legitimate primitive.
    '<div className="rounded-lg bg-muted p-3">{x}</div>',
    // 10. Purely dynamic className.
    "<div className={dyn}>{x}</div>",
    // 11. No className.
    "<div>{x}</div>",
    // 12. bg-card + rounded-lg but no border — incomplete recomposition.
    '<div className="bg-card rounded-lg p-5">{x}</div>',
    // 13. border + rounded-lg but no bg-card — a plain bordered panel.
    '<div className="border rounded-lg p-5">{x}</div>',
  ],
  invalid: [
    // A. Canonical bypass: rounded-lg + border + bg-card.
    {
      code: '<div className="rounded-lg border bg-card p-5">{children}</div>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // B. base `rounded` (also panel radius).
    {
      code: '<div className="rounded border bg-card">{children}</div>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // C. Different token order.
    {
      code: '<div className="bg-card border rounded-lg p-3">{x}</div>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // D. With shadow-sm too (still the bypass; shadow is a separate concern).
    {
      code: '<div className="rounded-lg border bg-card p-5 shadow-sm">{x}</div>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // E. In a cn(...) composition.
    {
      code: '<div className={cn("rounded-lg", "border bg-card")}>{x}</div>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // F. In a template literal.
    {
      code: "<div className={`relative rounded-lg border bg-card p-5 ${x}`}>{c}</div>",
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
    // G. On an <aside> element (TakeExamPage sidebar shape).
    {
      code: '<aside className="rounded-lg border bg-card p-3">{x}</aside>',
      errors: [{ messageId: "noRawSurfaceRecipe" }],
    },
  ],
});
