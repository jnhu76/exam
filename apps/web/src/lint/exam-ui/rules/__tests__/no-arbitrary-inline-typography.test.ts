import { ruleTester } from "../../ruleTester";
import rule from "../no-arbitrary-inline-typography";

/**
 * Inline-style arbitrary-typography tests
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §15, §17C).
 *
 * Enforces static one-off inline-style typography values. Zero existing debt
 * (no inline-style typography in lint scope), so the rule lands green.
 */
ruleTester().run("no-arbitrary-inline-typography", rule, {
  valid: [
    // No style attribute.
    '<div className="text-sm">x</div>',
    // style with non-typography properties only.
    '<div style={{ display: "flex", marginTop: 8 }}>x</div>',
    // Dynamic style value on a typography key → not statically resolvable → review-only.
    "<div style={{ fontSize: size }}>x</div>",
    // Dynamic style object → cannot resolve keys.
    "<div style={computedStyle}>x</div>",
    "<div style={{ ...props.style }}>x</div>",
    // String style (rare) → not resolvable.
    '<div style="color:red">x</div>',
    // A typography key on a recipe node whose recipe OWNS that property →
    // de-duped to the conflict rule (this rule yields).
    '<div className="type-metadata" style={{ lineHeight: 1.2 }}>x</div>',
    '<div className="type-section-title" style={{ color: "red" }}>x</div>',
  ],
  invalid: [
    // Static one-off fontSize.
    {
      code: "<div style={{ fontSize: 11 }}>x</div>",
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    {
      code: '<div style={{ fontSize: "11px" }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // lineHeight.
    {
      code: "<div style={{ lineHeight: 1.7 }}>x</div>",
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // letterSpacing.
    {
      code: '<div style={{ letterSpacing: "0.02em" }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // fontWeight.
    {
      code: "<div style={{ fontWeight: 450 }}>x</div>",
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // fontFamily.
    {
      code: '<div style={{ fontFamily: "Inter" }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // font shorthand.
    {
      code: '<div style={{ font: "500 12px/1 sans-serif" }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // A typography key on a recipe node whose recipe does NOT own that property
    // (type-numeric layout-owns size) → this rule still reports the one-off.
    {
      code: '<div className="type-numeric" style={{ fontSize: 11 }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // Mixed: one typography + one non-typography key → reports only the typography key.
    {
      code: '<div style={{ fontSize: 11, display: "block" }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
    // String-literal key form.
    {
      code: '<div style={{ "fontSize": 11 }}>x</div>',
      errors: [{ messageId: "noArbitraryInlineTypography" }],
    },
  ],
});
