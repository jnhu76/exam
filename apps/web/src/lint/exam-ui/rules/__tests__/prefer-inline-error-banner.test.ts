import { ruleTester } from "../../ruleTester";
import rule from "../prefer-inline-error-banner";

ruleTester().run("prefer-inline-error-banner", rule, {
  valid: [
    // 1. The authority component usage.
    "<InlineErrorBanner>{err}</InlineErrorBanner>",
    // 2. A div with only ONE destructive utility (just text-destructive) is
    //    not the banner recipe (too weak a signal).
    '<div className="rounded-md text-destructive">x</div>',
    // 3. Destructive utilities but NO rounded utility — not the banner recipe.
    '<div className="border-destructive bg-destructive/10 text-destructive">x</div>',
    // 4. Non-div element with the full recipe (rule targets <div>).
    '<section className="rounded-md border-destructive bg-destructive/10 text-destructive">x</section>',
    // 5. Purely dynamic className.
    "<div className={dyn}>x</div>",
    // 6. A neutral (non-destructive) banner — primary, not an error banner.
    '<div className="rounded-md border-primary bg-primary/10 text-primary">info</div>',
    // 7. Rounded + border-destructive only (one family) — not enough.
    '<div className="rounded-lg border-destructive">x</div>',
  ],
  invalid: [
    // A. Canonical InlineErrorBanner recipe (ExamDetailPage style).
    {
      code: '<div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // B. LoginPage style (text + bg destructive, rounded, no border-destructive).
    {
      code: '<div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // C. With role="alert".
    {
      code: '<div role="alert" className="rounded border-destructive/30 bg-destructive/10 text-destructive">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // D. cn() composition.
    {
      code: '<div className={cn("rounded-md", "border-destructive bg-destructive/10 text-destructive")}>{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // E. Template literal with static destructive classes.
    {
      code: '<div className={`rounded-md ${c ? "border-destructive bg-destructive/10 text-destructive" : ""}`}>{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
  ],
});
