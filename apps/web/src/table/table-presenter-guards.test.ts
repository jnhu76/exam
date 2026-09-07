/**
 * Presenter-pairing structural guards (issue #461 corrective C1; debt
 * deferred from #458 C3).
 *
 * INVARIANT: a business column whose effective overflow resolves to a
 * presenter policy (`truncate`, `truncate-middle`, `line-clamp-2`) must
 * actually render through `DataTableOverflowText` with a matching mode.
 * Without this guard a declaration can legally claim
 * `meta: { role: "long-text", overflow: "truncate" }` while the renderer
 * returns the raw value — metadata exists, but the truncation/accessibility
 * behavior does not.
 *
 * Semantic TS-AST pairing, never "presenter appears somewhere in the file":
 *   - TanStack column defs (`meta: { role, overflow }`): the column's own
 *     `cell` renderer must render the presenter, and every presenter use
 *     inside that renderer must match the column's effective mode.
 *   - Hand-built tables (`<DataTableColumns columns={[...]}>`): declarations
 *     pair positionally with the body row template's `DataTableCell` elements
 *     (row templates with a different cell count — span/loading rows — do not
 *     participate); each presenter-mode declaration's cell must render the
 *     presenter with the matching mode. If no row template can prove the
 *     pairing, the guard fails loud instead of skipping.
 *   - Non-literal role/overflow/mode/cell values fail loud. The single
 *     non-literal `columns` consumer is DesktopDataTable, whose inputs are
 *     the DataViewColumnDefs already guarded per-column by this test.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import type { ComponentProps } from "react";
import {
  DataTableOverflowText,
  ROLE_OVERFLOW,
} from "@/components/shared/DataTableContract";

/**
 * The modes DataTableOverflowText owns, derived from its `mode` prop type so
 * the compiler ties this set to the component: removing a mode there fails
 * this file's compilation, and a new mode must be added here consciously or
 * the guard silently stops covering it.
 */
type PresenterMode = ComponentProps<typeof DataTableOverflowText>["mode"];
const PRESENTER_MODES: ReadonlySet<string> = new Set<string>([
  "truncate",
  "truncate-middle",
  "line-clamp-2",
] satisfies PresenterMode[]);

/** The generic renderer piping runtime-guarded DataViewColumnDefs into the
 * colgroup; its `columns` prop is legitimately non-literal. */
const GENERIC_COLGROUP_CONSUMER = "components/shared/DesktopDataTable.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "lint") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function unwrapAssertion(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression))
    return unwrapAssertion(expression.expression);
  if (expression.kind === ts.SyntaxKind.TypeAssertionExpression) {
    return unwrapAssertion((expression as ts.TypeAssertion).expression);
  }
  return expression;
}

function propName(prop: ts.ObjectLiteralElementLike): string | null {
  if (
    ts.isPropertyAssignment(prop) ||
    ts.isShorthandPropertyAssignment(prop) ||
    ts.isMethodDeclaration(prop)
  ) {
    return prop.name.kind === ts.SyntaxKind.Identifier
      ? prop.name.text
      : ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
        ? prop.name.text
        : null;
  }
  return null;
}

function getProp(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const prop of objectLiteral.properties) {
    if (propName(prop) === name) {
      if (ts.isPropertyAssignment(prop)) return prop.initializer;
      if (ts.isShorthandPropertyAssignment(prop)) return prop.name;
    }
  }
  return undefined;
}

/** Element-like node → its tag name identifier (null for non-identifier tags). */
function tagNameOf(
  element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxOpeningElement,
): ts.Identifier | null {
  const tag = ts.isJsxElement(element)
    ? element.openingElement.tagName
    : element.tagName;
  return ts.isIdentifier(tag) ? tag : null;
}

function isNamedElement(
  node: ts.Node,
  name: string,
): node is ts.JsxElement | ts.JsxSelfClosingElement {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = tagNameOf(node);
    return tag !== null && tag.text === name;
  }
  return false;
}

/** JSX element containers (JsxElement/self-closing) by tag name in subtree —
 * containers, not opening tags, so subtree walks include the children. */
function collectElements(root: ts.Node, name: string): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (isNamedElement(node, name)) found.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return found;
}

function nearestAncestorElement(
  node: ts.Node,
  name: string,
): ts.Node | undefined {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isNamedElement(cursor, name)) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

/** Attributes of an element-like node (self-closing or paired). */
function jsxAttributes(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
): readonly ts.JsxAttributeLike[] {
  return ts.isJsxElement(element)
    ? element.openingElement.attributes.properties
    : element.attributes.properties;
}

/**
 * DataTableOverflowText modes used inside `root` (string-literal modes only);
 * a non-literal mode is reported via `nonLiteralMode`.
 */
function presenterUses(root: ts.Node): {
  modes: string[];
  nonLiteralMode: boolean;
} {
  const modes: string[] = [];
  let nonLiteralMode = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagNameOf(node)?.text === "DataTableOverflowText"
    ) {
      for (const attr of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(attr) ||
          !ts.isIdentifier(attr.name) ||
          attr.name.text !== "mode"
        )
          continue;
        const initializer = attr.initializer;
        const raw =
          initializer && ts.isJsxExpression(initializer)
            ? initializer.expression
            : initializer;
        const value = raw ? unwrapAssertion(raw) : undefined;
        if (value && ts.isStringLiteral(value)) {
          modes.push(value.text);
        } else {
          nonLiteralMode = true;
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(root);
  return { modes, nonLiteralMode };
}

interface ColumnDeclaration {
  role: string;
  /** Effective overflow (explicit override ?? ROLE_OVERFLOW default). */
  effective: string;
  override: boolean;
}

/** Parse one declaration object literal; null when not statically provable. */
function parseDeclaration(
  objectLiteral: ts.ObjectLiteralExpression,
): ColumnDeclaration | null {
  const roleInit = getProp(objectLiteral, "role");
  const overflowInit = getProp(objectLiteral, "overflow");
  if (!roleInit) return null;
  const role = unwrapAssertion(roleInit);
  if (!ts.isStringLiteral(role)) return null;
  if (overflowInit === undefined) {
    const effective = ROLE_OVERFLOW[role.text as keyof typeof ROLE_OVERFLOW];
    return effective === undefined
      ? null
      : { role: role.text, effective, override: false };
  }
  const overflow = unwrapAssertion(overflowInit);
  if (!ts.isStringLiteral(overflow)) return null;
  return { role: role.text, effective: overflow.text, override: true };
}

function declarationSite(sourceFile: ts.SourceFile, node: ts.Node): number {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return line + 1;
}

/**
 * Full semantic scan. Returns one message per violation, prefixed with
 * `path:line` so a red guard is immediately actionable.
 */
function presenterPairingViolations(): string[] {
  const violations: string[] = [];
  const fail = (rel: string, line: number, message: string): void => {
    violations.push(`${rel}:${line} ${message}`);
  };

  for (const path of listSourceFiles(webRoot)) {
    const rel = relative(webRoot, path);
    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /*setParentNodes*/ true,
      ts.ScriptKind.TSX,
    );

    const visit = (node: ts.Node): void => {
      // Shape 1: TanStack column definition object literal. A `meta` object
      // without a `role` key is not a DataViewColumnMeta (e.g. i18n card
      // metadata) — only a role-bearing meta enters the analysis.
      if (ts.isObjectLiteralExpression(node)) {
        const metaInit = getProp(node, "meta");
        if (
          metaInit &&
          ts.isObjectLiteralExpression(metaInit) &&
          getProp(metaInit, "role") !== undefined
        ) {
          const columnId = getProp(node, "id");
          const columnLabel =
            columnId && ts.isStringLiteral(columnId)
              ? `"${columnId.text}"`
              : "(anonymous)";
          const declaration = parseDeclaration(metaInit);
          if (!declaration) {
            fail(
              rel,
              declarationSite(sourceFile, metaInit),
              `column ${columnLabel}: meta role/overflow must be statically analyzable string literals`,
            );
          } else if (PRESENTER_MODES.has(declaration.effective)) {
            const { effective } = declaration;
            const cellInit = getProp(node, "cell");
            const cell = cellInit ? unwrapAssertion(cellInit) : undefined;
            if (
              !cell ||
              !(ts.isArrowFunction(cell) || ts.isFunctionExpression(cell))
            ) {
              fail(
                rel,
                declarationSite(sourceFile, metaInit),
                `column ${columnLabel}: effective overflow "${effective}" requires a cell renderer`,
              );
            } else {
              const { modes, nonLiteralMode } = presenterUses(cell);
              const source = declaration.override
                ? `override "${effective}"`
                : `role "${declaration.role}" default "${effective}"`;
              if (nonLiteralMode) {
                fail(
                  rel,
                  declarationSite(sourceFile, metaInit),
                  `column ${columnLabel}: DataTableOverflowText mode must be a string literal`,
                );
              }
              if (modes.length === 0 || !modes.every((m) => m === effective)) {
                fail(
                  rel,
                  declarationSite(sourceFile, metaInit),
                  `column ${columnLabel} (${source}) must render DataTableOverflowText mode="${effective}" (found: [${modes.join(", ")}])`,
                );
              }
            }
          }
        }
      }

      // Shape 2: hand-built colgroup declarations.
      if (isNamedElement(node, "DataTableColumns")) {
        for (const attr of jsxAttributes(node)) {
          if (
            !ts.isJsxAttribute(attr) ||
            !ts.isIdentifier(attr.name) ||
            attr.name.text !== "columns"
          ) {
            continue;
          }
          const initializer = attr.initializer;
          const array =
            initializer && ts.isJsxExpression(initializer)
              ? initializer.expression
              : initializer;
          if (!array || !ts.isArrayLiteralExpression(array)) {
            if (rel === GENERIC_COLGROUP_CONSUMER) continue;
            fail(
              rel,
              declarationSite(sourceFile, node),
              "DataTableColumns columns must be an array literal of declarations",
            );
            continue;
          }
          const declarations: ColumnDeclaration[] = [];
          let analyzable = true;
          for (const element of array.elements) {
            if (!ts.isObjectLiteralExpression(element)) {
              analyzable = false;
              break;
            }
            const declaration = parseDeclaration(element);
            if (!declaration) {
              analyzable = false;
              break;
            }
            declarations.push(declaration);
          }
          if (!analyzable) {
            fail(
              rel,
              declarationSite(sourceFile, node),
              "DataTableColumns declarations must be statically analyzable object literals",
            );
            continue;
          }
          const presenterIndices = declarations
            .map((d, i) => (PRESENTER_MODES.has(d.effective) ? i : -1))
            .filter((i) => i >= 0);
          if (presenterIndices.length === 0) continue;

          const table = nearestAncestorElement(node, "Table");
          if (!table) {
            fail(
              rel,
              declarationSite(sourceFile, node),
              "colgroup with presenter-mode declarations has no enclosing <Table>",
            );
            continue;
          }
          // Group body cells by their nearest TableRow template.
          const cells = collectElements(table, "DataTableCell");
          const rows = new Map<ts.Node, ts.Node[]>();
          for (const cell of cells) {
            const row = nearestAncestorElement(cell, "TableRow");
            if (!row) continue;
            const group = rows.get(row);
            if (group) group.push(cell);
            else rows.set(row, [cell]);
          }
          const rowTemplates = [...rows.values()].filter(
            (group) => group.length === declarations.length,
          );
          if (rowTemplates.length === 0) {
            fail(
              rel,
              declarationSite(sourceFile, node),
              `colgroup [${declarations.map((d) => `${d.role}:${d.effective}`).join(", ")}] has no body row template with ${declarations.length} DataTableCells to prove the pairing`,
            );
            continue;
          }
          for (const index of presenterIndices) {
            const declaration = declarations[index];
            if (!declaration) continue;
            let paired = false;
            for (const row of rowTemplates) {
              const cell = row[index];
              if (!cell) continue;
              const { modes, nonLiteralMode } = presenterUses(cell);
              if (nonLiteralMode) {
                fail(
                  rel,
                  declarationSite(sourceFile, cell),
                  `body cell #${index + 1}: DataTableOverflowText mode must be a string literal`,
                );
              }
              if (
                modes.length > 0 &&
                modes.every((m) => m === declaration.effective)
              ) {
                paired = true;
              }
            }
            if (!paired) {
              fail(
                rel,
                declarationSite(sourceFile, node),
                `colgroup column #${index + 1} (${declaration.role}, effective "${declaration.effective}") must render DataTableOverflowText mode="${declaration.effective}" in body cell #${index + 1}`,
              );
            }
          }
          // Reverse drift: a presenter inside a cell whose column declares a
          // non-presenter overflow contradicts the colgroup declaration.
          for (const [index, declaration] of declarations.entries()) {
            if (PRESENTER_MODES.has(declaration.effective)) continue;
            for (const row of rowTemplates) {
              const cell = row[index];
              if (!cell) continue;
              if (presenterUses(cell).modes.length > 0) {
                fail(
                  rel,
                  declarationSite(sourceFile, cell),
                  `body cell #${index + 1} renders DataTableOverflowText but column #${index + 1} declares "${declaration.effective}"`,
                );
              }
            }
          }
        }
      }

      node.forEachChild(visit);
    };
    visit(sourceFile);
  }
  return violations;
}

describe("table presenter-pairing structural guards (issue #461 C1)", () => {
  it("renders every presenter-overflow column through DataTableOverflowText with the matching mode", () => {
    // Covers explicit overrides (long-text+truncate, description+line-clamp-2)
    // and the presenter-default roles (description, short-id), in both the
    // TanStack shape (cell renderer) and hand-built colgroups (positional
    // pairing with body cells).
    expect(presenterPairingViolations()).toEqual([]);
  });
});
