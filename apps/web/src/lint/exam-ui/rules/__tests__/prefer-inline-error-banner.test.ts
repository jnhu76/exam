import { ruleTester } from "../../ruleTester";
import rule from "../prefer-inline-error-banner";

ruleTester().run("prefer-inline-error-banner", rule, {
  valid: [
    // 1. The authority component usage.
    "<InlineErrorBanner>{err}</InlineErrorBanner>",
    // 2. A div with only ONE destructive utility (just text-destructive) is
    //    not the banner recipe (too weak a signal).
    '<div role="alert" className="rounded-md text-destructive">x</div>',
    // 3. Destructive utilities but NO rounded utility — not the banner recipe.
    '<div role="alert" className="border-destructive bg-destructive/10 text-destructive">x</div>',
    // 4. Non-div element with the full recipe (rule targets <div>).
    '<section role="alert" className="rounded-md border-destructive bg-destructive/10 text-destructive">x</section>',
    // 5. Purely dynamic className.
    '<div role="alert" className={dyn}>x</div>',
    // 6. A neutral (non-destructive) banner — primary, not an error banner.
    '<div role="alert" className="rounded-md border-primary bg-primary/10 text-primary">info</div>',
    // 7. Rounded + border-destructive only (one family) — not enough.
    '<div role="alert" className="rounded-lg border-destructive">x</div>',
    // 8. NARROW boundary: a destructive+rounded <div> WITHOUT role="alert" is
    //    NOT the banner recipe — this is the false-semantic-overlap shape
    //    (e.g. a low-time timer chip). Excluded by the role requirement.
    '<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-right text-destructive">{time}</div>',
    // 9. NARROW boundary: a multi-role status <div> whose destructive branch
    //    has the recipe but has no role attr — excluded by the role
    //    requirement.
    '<div className={`rounded-md border p-3 text-sm ${c ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{msg}</div>',
    // 10. A non-alert role on an otherwise recipe-matching div — not a banner.
    '<div role="status" className="rounded-md border-destructive bg-destructive/10 text-destructive">{err}</div>',
    // 11. Dynamic role value — the rule does not reason about runtime roles.
    '<div role={r} className="rounded-md border-destructive bg-destructive/10 text-destructive">{err}</div>',
    // 12. No role attribute at all on a recipe div — not a banner.
    '<div className="rounded-md border-destructive bg-destructive/10 text-destructive">{err}</div>',
  ],
  invalid: [
    // A. Canonical InlineErrorBanner recipe with role="alert".
    {
      code: '<div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // B. LoginPage style (text + bg destructive, rounded, role=alert, no
    //    border-destructive).
    {
      code: '<div role="alert" className="text-sm text-destructive bg-destructive/10 p-2 rounded">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // C. role="alert" with the destructive-surface combination.
    {
      code: '<div role="alert" className="rounded border-destructive/30 bg-destructive/10 text-destructive">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // D. cn() composition.
    {
      code: '<div role="alert" className={cn("rounded-md", "border-destructive bg-destructive/10 text-destructive")}>{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // E. Template literal with static destructive classes.
    {
      code: '<div role="alert" className={`rounded-md ${c ? "border-destructive bg-destructive/10 text-destructive" : ""}`}>{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
    // F. role="alert" expressed as a JSX expression container literal.
    {
      code: '<div role={"alert"} className="rounded-md border-destructive bg-destructive/10 text-destructive">{err}</div>',
      errors: [{ messageId: "preferInlineErrorBanner" }],
    },
  ],
});
