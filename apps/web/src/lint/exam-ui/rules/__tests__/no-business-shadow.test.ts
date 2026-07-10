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
  ],
});
