import { ruleTester } from "../../ruleTester";
import rule from "../no-arbitrary-typography";

ruleTester().run("no-arbitrary-typography", rule, {
  valid: [
    // 1. Named text-size utilities are allowed (the standard scale is the token path).
    '<p className="text-sm text-muted-foreground">x</p>',
    // 2. Named leading / tracking allowed.
    '<p className="leading-tight tracking-tight">x</p>',
    // 3. Purely dynamic className.
    "<div className={dyn}>x</div>",
    // 4. No className.
    "<p>x</p>",
    // 5. text-destructive (a color, not a size) — allowed.
    '<p className="text-destructive">x</p>',
    // 6. Semantic typography recipe class names are allowed (the authority path).
    '<p className="type-metadata leading-none">x</p>',
    '<p className="type-section-title">x</p>',
    // 7. Responsive + named scale still allowed (not arbitrary).
    '<p className="md:text-sm">x</p>',
    // 8. clsx / twMerge static strings with named utilities allowed.
    '<p className={twMerge("text-sm", "leading-tight")}>x</p>',
  ],
  invalid: [
    // A. text-[11px] — the retired ExamTimer pattern.
    {
      code: '<div className="text-[11px] font-medium">x</div>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // B. leading-[1.6].
    {
      code: '<p className="leading-[1.6]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // C. tracking-[-0.02em].
    {
      code: '<p className="tracking-[-0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // D. In a cn() composition.
    {
      code: '<p className={cn("text-base", "leading-[1.8]")}>x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // E. Multiple arbitrary values.
    {
      code: '<p className="text-[13px] leading-[1.5]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // F. In a template literal.
    {
      code: "<p className={`text-[14px] ${x}`}>x</p>",
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // G. Responsive variant — global token policy holds under variants.
    {
      code: '<p className="md:text-[11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // H. State variant.
    {
      code: '<p className="hover:leading-[1.7]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // I. Stacked variant.
    {
      code: '<p className="group-hover:tracking-[0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // J. clsx static literal carrying an arbitrary value.
    {
      code: '<p className={clsx("text-sm", "text-[12px]")}>x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
  ],
});
