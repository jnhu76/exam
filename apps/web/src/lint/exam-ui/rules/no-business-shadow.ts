/**
 * exam-ui/no-business-shadow
 *
 * Ordinary business content must not introduce shadow-based elevation.
 * Shadows are reserved for visual roles that intentionally own elevation
 * (overlays, floating surfaces, sticky topbar). This is a forward authority
 * rule: existing business-page shadow debt is grandfathered by baseline, but
 * no NEW business-page shadow may land.
 *
 * Detection: any Tailwind `shadow-*` utility in a className expression in
 * business / feature scopes. The matched token set (e.g. ["shadow-sm"]) is
 * the baseline signature, so a new shadow-sm in a previously-clean file fails
 * while the existing occurrences stay green.
 *
 * Exclusions (enforced by config `files` glob AND by path here):
 *   - components/ui (generated shadcn primitives — may use shadow freely);
 *   - components/layout (owns the sticky topbar elevation intentionally).
 *
 * Diagnostic-only: no autofix.
 */
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  findUtilities,
  prefixFamily,
  type ClassNameToken,
} from "../classNameUtils";

const SHADOW_FAMILY = prefixFamily("shadow", "shadow");

export default createRule({
  name: "no-business-shadow",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not introduce shadow-based elevation; shadows are reserved for overlay/floating authorities.",
    },
    schema: [],
    messages: {
      noBusinessShadow:
        "Business content must not introduce shadow utilities ({{ tokens }}). Shadows are reserved for overlay/floating visual roles. If this is a genuine overlay/topbar elevation, move it into the authoritative component; otherwise remove the shadow.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens: ClassNameToken[] = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        const shadows = findUtilities(tokens, SHADOW_FAMILY);
        if (shadows.length === 0) return;

        const shadowTokens = shadows.map((s) => s.value);
        maybeSuppress(
          asSuppressable(context),
          "no-business-shadow",
          shadowTokens,
          attr,
          "noBusinessShadow",
          { tokens: shadowTokens.join(", ") },
        );
      },
    };
  },
});
