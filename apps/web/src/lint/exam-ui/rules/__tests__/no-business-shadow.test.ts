import { ruleTester } from "../../ruleTester";
import rule from "../no-business-shadow";

ruleTester().run("no-business-shadow", rule, {
  valid: [
    // 1. No shadow utility at all.
    '<div className="rounded-lg border p-4">x</div>',
    // 2. Purely dynamic className.
    "<div className={dyn}>x</div>",
    // 3. No className.
    "<div>x</div>",
    // 4. Unrelated "shadow" substring inside another token must NOT match.
    '<div className="drop-shadow-sm">x</div>',
    //    (drop-shadow-* is a filter utility, not the elevation shadow family)
    // 5. drop-shadow under a variant prefix is still a filter, not elevation.
    '<div className="hover:drop-shadow-md">x</div>',
    // 6. A semantic surface/elevation authority class is NOT a raw shadow
    //    utility and must not be flagged (the authority path, not a violation).
    '<div className="surface-overlay">x</div>',
    '<div className="elevation-overlay">x</div>',
  ],
  invalid: [
    // A. shadow-sm in a business element.
    {
      code: '<Card className="shadow-sm">x</Card>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // B. shadow-md.
    {
      code: '<div className="shadow-md">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // C. shadow (bare).
    {
      code: '<div className="shadow">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // D. shadow in cn() composition.
    {
      code: '<Card className={cn("rounded-lg", "shadow-sm")}>x</Card>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // E. shadow in a template literal.
    {
      code: '<Card className={`rounded-lg ${"shadow-sm"}`}>x</Card>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // F. shadow-xs (the topbar value — would be flagged in business scope,
    //    grandfathered only in components/layout via config).
    {
      code: '<div className="shadow-xs">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // G. shadow-lg / shadow-xl / shadow-2xl / shadow-inner / shadow-none — the
    //    full elevation family is forbidden in business scope, not just sm/md.
    {
      code: '<div className="shadow-lg">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    {
      code: '<div className="shadow-2xl">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // H. variant-prefixed shadows — the global token policy forbids raw shadow
    //    utilities regardless of variant prefix (UI-MIGRATE-N-W4B §M).
    {
      code: '<div className="hover:shadow-md">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    {
      code: '<div className="md:shadow-lg">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    {
      code: '<div className="data-[state=open]:shadow-lg">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    {
      code: '<div className="group-hover:shadow-lg">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // I. arbitrary-bracket shadow value — a raw shadow utility in arbitrary
    //    form is still a raw shadow utility.
    {
      code: '<div className="shadow-[0_2px_8px_rgb(0_0_0/0.12)]">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // J. variant-prefixed arbitrary shadow.
    {
      code: '<div className="hover:shadow-[0_2px_8px_rgb(0_0_0/0.12)]">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // K. variant-prefixed shadow inside cn() composition.
    {
      code: '<Card className={cn("rounded-lg", "hover:shadow-md")}>x</Card>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // L. shadow-none — an explicit raw elevation override is still a raw shadow
    //    utility (UI-VISUAL-AUTHORITY-CLOSURE-1 §23.W.1). Business consumers
    //    must use an authoritative component variant, surface role, or future
    //    flattening authority instead of raw shadow-none. No such flattening
    //    authority exists today — StatsCard avoids Card entirely.
    {
      code: '<div className="shadow-none">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // M. important shadow form — the `!` modifier does not escape the policy.
    {
      code: '<div className="shadow-sm!">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
    // N. descendant/pseudo-element variant with shadow — a shadow on a
    //    generated/descendant box is still a raw shadow utility.
    {
      code: '<div className="[&>span]:shadow-sm">x</div>',
      errors: [{ messageId: "noBusinessShadow" }],
    },
  ],
});
