/**
 * exam-ui/no-arbitrary-filter-width
 *
 * Toolbar/filter control sizing is owned by the semantic tier vocabulary
 * (issue 458, P3 §C toolbar): `narrow` = 9rem, `wide` = 11.25rem, declared via
 * <ToolbarFilter size="narrow|wide"> on the single toolbar authority
 * (DataToolbar). A page writing an arbitrary width (w-[Npx] / w-[Nrem],
 * including min-/max- and responsive variants) on a filter control inside a
 * <DataToolbar> recreates the page-owned width guessing this rule exists to
 * retire — there is never a third tier and never a page-owned px.
 *
 * Scope (all three conditions must hold):
 *   - the file imports DataToolbar from @/components/shared/DataToolbar
 *     (import-anchored);
 *   - the element is a known filter control (SelectTrigger / Input /
 *     TagFilterSelect / bare <input>);
 *   - the element is a JSX descendant of <DataToolbar> (ancestor walk, so a
 *     control nested in a fragment or conditional still counts).
 *
 * Not reported (by design):
 *   - controls OUTSIDE a DataToolbar (forms, dialogs, tables — structural
 *     widths elsewhere remain page-owned);
 *   - component-owned widths inside shared components (TagFilterSelect's own
 *     trigger fill classes live in components/shared, outside any
 *     DataToolbar ancestor in that file; DatePicker and SearchInput keep
 *     their self-owned widths);
 *   - unrelated structural widths (sidebar, dialogs, cells, actions).
 *
 * Diagnostic-only: no autofix.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
} from "../classNameUtils";

const TOOLBAR_IMPORT_RE = /^@\/components\/shared\/DataToolbar$/;

const FILTER_CONTROL_NAMES = new Set([
  "SelectTrigger",
  "Input",
  "TagFilterSelect",
  "input",
]);

/** Arbitrary px/rem widths (with optional variant prefix and min-/max-). */
const ARBITRARY_WIDTH_RE = /(^|:)(min-|max-)?w-\[[0-9.]+(px|rem)\]/;

function importsDataToolbar(ast: TSESTree.Program): boolean {
  return ast.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      typeof statement.source.value === "string" &&
      TOOLBAR_IMPORT_RE.test(statement.source.value),
  );
}

function isInsideDataToolbar(node: TSESTree.JSXOpeningElement): boolean {
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (current.type === "JSXElement") {
      const name = current.openingElement.name;
      if (name.type === "JSXIdentifier" && name.name === "DataToolbar") {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

export default createRule({
  name: "no-arbitrary-filter-width",
  meta: {
    type: "problem",
    docs: {
      description:
        "Toolbar/filter control widths are owned by the narrow/wide semantic tier (ToolbarFilter) — never a page-local arbitrary width.",
    },
    schema: [],
    messages: {
      noArbitraryFilterWidth:
        'Filter control width "{{token}}" is page-owned. Declare the semantic tier instead: <ToolbarFilter size="narrow|wide">.',
    },
  },
  defaultOptions: [],
  create(context) {
    const anchored = importsDataToolbar(context.sourceCode.ast);
    if (!anchored) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (!FILTER_CONTROL_NAMES.has(node.name.name)) return;
        if (!isInsideDataToolbar(node)) return;
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;
        const tokens = collectClassNameTokens(attr.value).filter((token) =>
          ARBITRARY_WIDTH_RE.test(token.value),
        );
        for (const token of tokens) {
          context.report({
            node: token.node,
            messageId: "noArbitraryFilterWidth",
            data: { token: token.value },
          });
        }
      },
    };
  },
});
