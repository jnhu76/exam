/**
 * exam-ui/no-heavy-font-weight
 *
 * CJK text reads heavy/clunky at UI sizes; the self-hosted Noto Sans CJK SC
 * loads only 400 / 500 / 700 (no 600). This rule enforces the typographic
 * weight hierarchy established in UI-PRODUCT-FINISH-CLOSURE-1:
 *
 *   - font-semibold (600) is FORBIDDEN everywhere in business/feature source.
 *     No 600 face is loaded, so the browser synthesizes a fuzzy fake bold.
 *   - font-bold (700) is allowed ONLY on large numeric metrics — elements that
 *     carry a large font-size utility (text-2xl / text-3xl / text-4xl /
 *     text-5xl). In table body / list body / form text, 700 is too heavy and
 *     must use 400 (or 500 for an emphasized primary cell via the recipe).
 *
 * Exclusions (enforced by config `files` glob): components/ui (generated shadcn
 * primitives) is never linted by exam-ui.
 *
 * Diagnostic-only: no autofix.
 */
import { createRule, asSuppressable } from "../ruleFactory";
import {
  findClassNameAttribute,
  collectClassNameTokens,
  hasToken,
  hasAnyToken,
} from "../classNameUtils";

/** Large font-size utilities that legitimize font-bold (metric / KPI display). */
const METRIC_SIZE_PATTERNS = [
  /^text-xl$/,
  /^text-2xl$/,
  /^text-3xl$/,
  /^text-4xl$/,
  /^text-5xl$/,
  /^text-6xl$/,
];

export default createRule({
  name: "no-heavy-font-weight",
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbidden font weights in business content: font-semibold (600 = synthetic bold) always; font-bold (700) except on large numeric metrics.",
    },
    schema: [],
    messages: {
      noSemibold:
        "font-semibold (600) is forbidden: no 600 face is loaded, so it renders as a fuzzy synthetic bold. Use font-medium (500) for emphasis or remove it.",
      noBoldInBody:
        "font-bold (700) is too heavy for body/table/form text. Use font-medium (500) for emphasis, or remove it and let the recipe own the weight. font-bold is reserved for large numeric metrics (text-2xl+).",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        // font-semibold: always forbidden (no 600 face loaded).
        if (hasToken(tokens, "font-semibold")) {
          asSuppressable(context).report({
            node: attr,
            messageId: "noSemibold",
          });
          return;
        }

        // font-bold: allowed only when the element also carries a large
        // metric font-size. Otherwise it's body/table/form text that should
        // not be 700.
        if (hasToken(tokens, "font-bold")) {
          const isMetric = hasAnyToken(tokens, (v) =>
            METRIC_SIZE_PATTERNS.some((p) => p.test(v)),
          );
          if (!isMetric) {
            asSuppressable(context).report({
              node: attr,
              messageId: "noBoldInBody",
            });
          }
        }
      },
    };
  },
});
