import { ruleTester } from "../../ruleTester";
import rule from "../prefer-field-error";

ruleTester().run("prefer-field-error", rule, {
  valid: [
    // 1. The authority component usage itself is never a violation.
    "<FieldError>{err}</FieldError>",
    // 2. A <p> with text-destructive but NO size utility is not the recipe.
    '<p className="text-destructive">{err}</p>',
    // 3. A <p> with a size utility but no destructive utility is not flagged.
    '<p className="text-sm">{msg}</p>',
    // 4. Destructive text on a non-<p> element (e.g. an icon span).
    '<span className="text-sm text-destructive">*</span>',
    // 5. Destructive text on a heading element.
    '<h2 className="text-destructive text-sm">boom</h2>',
    // 6. Purely dynamic className is not inspected (no false positive).
    "<p className={dynamic}>x</p>",
    // 7. No className at all.
    "<p>plain</p>",
    // 8. Destructive with /opacity modifier but no size — still not the recipe.
    '<p className="text-destructive/80">{err}</p>',
    // 9. The authority component used with a className prop.
    '<FieldError className="mt-2">{err}</FieldError>',
  ],
  invalid: [
    // A. Canonical bypass: <p text-sm text-destructive>.
    {
      code: '<p className="text-sm text-destructive">{err}</p>',
      errors: [{ messageId: "preferFieldError" }],
    },
    // B. text-xs variant (GradingDetailPage style).
    {
      code: '<p className="text-xs text-destructive">{err}</p>',
      errors: [{ messageId: "preferFieldError" }],
    },
    // C. With role="alert" and mt spacing — still a field-error bypass.
    {
      code: '<p role="alert" className="mt-1 text-sm text-destructive">{err}</p>',
      errors: [{ messageId: "preferFieldError" }],
    },
    // D. Arbitrary text-size value also triggers (text-[12px]).
    {
      code: '<p className="text-[12px] text-destructive">{err}</p>',
      errors: [{ messageId: "preferFieldError" }],
    },
    // E. Classes in cn(...) composition are inspected.
    {
      code: '<p className={cn("text-sm", "text-destructive")}>{err}</p>',
      errors: [{ messageId: "preferFieldError" }],
    },
    // F. Template-literal static quasis are inspected.
    {
      code: "<p className={`text-sm text-destructive ${extra}`}>{err}</p>",
      errors: [{ messageId: "preferFieldError" }],
    },
  ],
});

// Authority-implementation exemption: FieldError.tsx itself is never flagged,
// even though its className is exactly the recipe. We simulate that by checking
// that the rule's create() short-circuits on the filename — tested at the
// config scope level (see exam-ui-scope.test.ts). Here we only assert the
// recipe itself IS detected in ordinary files.
