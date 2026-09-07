import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The web `src/` root (this helper lives in `src/test/`). */
export const webSrcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function parseText(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

/** Import specifier → file path for every `@/pages/**` import in a parsed App source. */
export function pageImportsFromSourceFile(
  sourceFile: ts.SourceFile,
): Map<string, string> {
  const imports = new Map<string, string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const module = node.moduleSpecifier;
    if (!module || !ts.isStringLiteral(module)) return;
    if (!module.text.startsWith("@/pages/")) return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const spec of bindings.elements) {
      imports.set(
        spec.name.text,
        join(webSrcRoot, `${module.text.slice(2)}.tsx`),
      );
    }
  });
  return imports;
}

/**
 * Resolved route entry: fully-qualified route string + component name.
 * Produced by walking the App.tsx JSX AST and resolving nested Route paths.
 */
export interface ResolvedRouteEntry {
  /** Fully-resolved route pattern (e.g. `/admin/questions/:id/edit`). */
  route: string;
  /** Page component name (imported from `@/pages/**`). */
  page: string;
}

/**
 * Route-aware extraction from App.tsx source text. Resolves nested React
 * Router structure into fully-qualified `{route, page}` pairs. Pure: operates
 * on the given source string, never on disk (mutation proofs parse mutants
 * in memory).
 *
 * Entries appear only for routes whose element is a page component imported
 * from `@/pages/**` — redirects (`<Navigate>`), index routes rendering
 * App-local components, and layout routes are not page entries. Deduplicates
 * by `${route}::${page}` key, so distinct route identities remain
 * independently proven: multiple distinct routes pointing to the same
 * component (duplicate-component route coverage) each appear. Identical
 * duplicate entries (the same route::page twice) collapse to one — exact
 * duplicate-pair multiplicity is not claimed.
 */
export function resolvedRouteEntriesFromSource(
  source: string,
): ResolvedRouteEntry[] {
  const appFile = join(webSrcRoot, "App.tsx");
  const sourceFile = parseText(appFile, source);
  const imports = pageImportsFromSourceFile(sourceFile);
  const seen = new Set<string>();
  const entries: ResolvedRouteEntry[] = [];

  function extractPath(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): string | undefined {
    const pathAttr = node.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) &&
        ts.isIdentifier(a.name) &&
        a.name.text === "path",
    );
    if (!pathAttr?.initializer) return undefined;
    return ts.isStringLiteral(pathAttr.initializer)
      ? pathAttr.initializer.text
      : undefined;
  }

  function extractElement(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): string | undefined {
    const elemAttr = node.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) &&
        ts.isIdentifier(a.name) &&
        a.name.text === "element",
    );
    if (!elemAttr?.initializer) return undefined;
    let expr: ts.Expression | undefined = elemAttr.initializer;
    if (ts.isJsxExpression(expr)) expr = expr.expression;
    if (expr && (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr))) {
      const inner = ts.isJsxElement(expr)
        ? expr.openingElement
        : (expr as ts.JsxSelfClosingElement);
      if (ts.isIdentifier(inner.tagName) && imports.has(inner.tagName.text)) {
        return inner.tagName.text;
      }
    }
    return undefined;
  }

  function isIndexRoute(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): boolean {
    return node.attributes.properties.some(
      (a) =>
        ts.isJsxAttribute(a) &&
        ts.isIdentifier(a.name) &&
        a.name.text === "index",
    );
  }

  function addEntry(resolvedPath: string, componentName: string) {
    const key = `${resolvedPath}::${componentName}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ route: resolvedPath, page: componentName });
    }
  }

  function processRouteChildren(
    routeNode: ts.JsxElement,
    resolvedPath: string,
  ) {
    for (const child of routeNode.children) {
      const childOpening = ts.isJsxElement(child)
        ? child.openingElement
        : ts.isJsxSelfClosingElement(child)
          ? child
          : null;
      if (
        !childOpening ||
        !ts.isIdentifier(childOpening.tagName) ||
        childOpening.tagName.text !== "Route"
      )
        continue;

      if (isIndexRoute(childOpening)) {
        const indexName = extractElement(childOpening);
        if (indexName) {
          addEntry(resolvedPath, indexName);
        }
      } else {
        const localPath = extractPath(childOpening) ?? "";
        const childResolvedPath = resolvedPath + "/" + localPath;
        const componentName = extractElement(childOpening);
        if (componentName) {
          addEntry(childResolvedPath, componentName);
        }
        // Recurse into paired <Route> children.
        if (ts.isJsxElement(child)) {
          processRouteChildren(child, childResolvedPath);
        }
      }
    }
  }

  // Walk top-level <Routes> → child <Route> elements.
  sourceFile.forEachChild(function walk(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      ts.isIdentifier(node.openingElement.tagName) &&
      node.openingElement.tagName.text === "Routes"
    ) {
      for (const child of node.children) {
        // Top-level routes can be self-closing or paired elements.
        const opening = ts.isJsxElement(child)
          ? child.openingElement
          : ts.isJsxSelfClosingElement(child)
            ? child
            : null;
        if (
          !opening ||
          !ts.isIdentifier(opening.tagName) ||
          opening.tagName.text !== "Route"
        )
          continue;

        const localPath = extractPath(opening) ?? "";
        const componentName = extractElement(opening);
        if (componentName) {
          addEntry(localPath, componentName);
        }
        // Recurse into nested Route children (only for paired elements).
        if (ts.isJsxElement(child)) {
          processRouteChildren(child, localPath);
        }
      }
    }
    node.forEachChild(walk);
  });

  return entries;
}

/** The route entries of the on-disk App.tsx (production reading path). */
export function resolvedRouteEntries(): ResolvedRouteEntry[] {
  return resolvedRouteEntriesFromSource(
    readFileSync(join(webSrcRoot, "App.tsx"), "utf8"),
  );
}
