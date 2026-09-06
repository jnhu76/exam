/**
 * exam-ui/no-dialog-spatial-override
 *
 * Dialog geometry is owned by the DialogContent / AlertDialogContent size
 * vocabulary (P3 §12 dialog contract, issue 459): sm = 384, md = 512 (default),
 * lg = 672, plus the Content max-height and the data-slot="dialog-body"
 * vertical-scroll convention. A page overriding that geometry with bare
 * max-w-* / max-h-* / overflow-* utilities (including responsive-prefixed
 * variants like sm:max-w-lg) recreates the pre-contract page-private dialog
 * spatial system this rule exists to retire.
 *
 * Scope: JSX elements named DialogContent / AlertDialogContent in files that
 * import them from the ui/dialog / ui/alert-dialog primitives
 * (import-anchored, so a local component with the same name is not flagged).
 * components/ui itself is excluded by the ESLint config globs.
 *
 * Not reported:
 *   - any other element's className (dialog-body and inner content regions
 *     own their own scroll, e.g. a preview list inside the body);
 *   - purely dynamic className expressions (statically knowable segments
 *     only, consistent with the other exam-ui rules).
 *
 * Diagnostic-only: no autofix.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
} from "../classNameUtils";

const DIALOG_CONTENT_IMPORT_RE = /^@\/components\/ui\/(?:dialog|alert-dialog)$/;

const DIALOG_ELEMENT_NAMES = new Set(["DialogContent", "AlertDialogContent"]);

/** Bare spatial utilities that override the dialog contract. */
const SPATIAL_OVERRIDE_RE = /(^|:)(max-w-|max-h-|overflow(?:-x|-y)?)/;

function isSpatialOverride(token: string): boolean {
  return SPATIAL_OVERRIDE_RE.test(token);
}

function importsDialogPrimitive(
  ast: import("@typescript-eslint/utils").TSESTree.Program,
): boolean {
  return ast.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      typeof statement.source.value === "string" &&
      DIALOG_CONTENT_IMPORT_RE.test(statement.source.value) &&
      statement.specifiers.some(
        (spec) =>
          spec.type === "ImportSpecifier" &&
          spec.imported.type === "Identifier" &&
          DIALOG_ELEMENT_NAMES.has(spec.imported.name),
      ),
  );
}

export default createRule({
  name: "no-dialog-spatial-override",
  meta: {
    type: "problem",
    docs: {
      description:
        "DialogContent/AlertDialogContent geometry (max-width, max-height, overflow) is owned by the size vocabulary — never overridden with bare utilities.",
    },
    schema: [],
    messages: {
      noDialogSpatialOverride:
        '"{{token}}" overrides the dialog spatial contract. Use the size vocabulary (sm/md/lg) and the data-slot="dialog-body" scroll convention instead of bare max-w/max-h/overflow utilities.',
    },
  },
  defaultOptions: [],
  create(context) {
    const anchored = importsDialogPrimitive(context.sourceCode.ast);
    if (!anchored) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (!DIALOG_ELEMENT_NAMES.has(node.name.name)) return;
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;
        const tokens = collectClassNameTokens(attr.value).filter((token) =>
          isSpatialOverride(token.value),
        );
        for (const token of tokens) {
          context.report({
            node: token.node,
            messageId: "noDialogSpatialOverride",
            data: { token: token.value },
          });
        }
      },
    };
  },
});
