import { ruleTester } from "../../ruleTester";
import rule from "../no-arbitrary-typography";

/**
 * Arbitrary-typography enforcement tests
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §5, §15, §16, §17C).
 *
 * Codifies the syntax matrix after the rule was rewritten on
 * parseTailwindCandidate + classifyArbitraryValue:
 *   ENFORCED  — typography categories (font-size/line-height/letter-spacing/
 *               font-weight/font-family) across all routes + variants;
 *   OUT       — text-color arbitrary values (color/token authority owns them);
 *   REVIEW    — ambiguous var(--x)/calc()/bare-number (not lint-enforced).
 */
ruleTester().run("no-arbitrary-typography", rule, {
  valid: [
    // --- named utilities (the standard scale / named tokens are the token path) ---
    '<p className="text-sm text-muted-foreground">x</p>',
    '<p className="leading-tight tracking-tight">x</p>',
    '<p className="font-bold font-mono">x</p>',
    '<p className="tabular-nums">x</p>',
    // responsive + named scale allowed
    '<p className="md:text-sm hover:font-bold">x</p>',
    // semantic recipe class names allowed (the authority path)
    '<p className="type-metadata">x</p>',
    '<p className="type-section-title">x</p>',
    // purely dynamic / no className
    "<div className={dyn}>x</div>",
    "<p>x</p>",

    // --- COLOR is OUT OF POLICY (text color, not typography) ---
    '<p className="text-[color:var(--brand)]">x</p>',
    '<p className="text-[#fff]">x</p>',
    '<p className="text-[#123456]">x</p>',
    '<p className="text-[rgb(0_0_0)]">x</p>',
    '<p className="[color:red]">x</p>',

    // --- AMBIGUOUS is REVIEW-ONLY (not lint-enforced) ---
    '<p className="text-[var(--brand)]">x</p>',
    '<p className="font-[var(--weight)]">x</p>',
    '<p className="text-[calc(1rem+2px)]">x</p>',
    '<p className="text-[11]">x</p>',

    // --- cn/clsx/twMerge static named utilities ---
    '<p className={twMerge("text-sm", "leading-tight")}>x</p>',
    '<p className={cn("font-sans", "tracking-normal")}>x</p>',
  ],
  invalid: [
    // --- font-size arbitrary ---
    {
      code: '<div className="text-[11px] font-medium">x</div>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="text-[length:11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- line-height arbitrary ---
    {
      code: '<p className="leading-[1.6]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="lh-[1.4]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- letter-spacing arbitrary ---
    {
      code: '<p className="tracking-[-0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- font-weight arbitrary ---
    {
      code: '<p className="font-[450]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- font-family arbitrary ---
    {
      code: '<p className="font-[family-name:Inter]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- arbitrary PROPERTY forms ---
    {
      code: '<p className="[font-size:11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="[line-height:1.7]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="[letter-spacing:0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="[font-weight:450]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="[font-family:Inter]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- slash line-height modifier (arbitrary) ---
    {
      code: '<p className="text-[11px]/[13px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- composition: in cn() ---
    {
      code: '<p className={cn("text-base", "leading-[1.8]")}>x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- multiple arbitrary values → one report (first hit) ---
    {
      code: '<p className="text-[13px] leading-[1.5]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- template literal ---
    {
      code: "<p className={`text-[14px] ${x}`}>x</p>",
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- variant forms (responsive/state/stacked/arbitrary descendant) ---
    {
      code: '<p className="md:text-[11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="hover:leading-[1.7]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="group-hover:tracking-[0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    {
      code: '<p className="data-[state=open]:text-[11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // a descendant-target variant is still an arbitrary value on SOME element:
    {
      code: '<p className="[&>span]:text-[11px]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- important modifier ---
    {
      code: '<p className="text-[11px]!">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- negative utility ---
    {
      code: '<p className="-tracking-[0.02em]">x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
    // --- clsx static literal ---
    {
      code: '<p className={clsx("text-sm", "text-[12px]")}>x</p>',
      errors: [{ messageId: "noArbitraryTypography" }],
    },
  ],
});
