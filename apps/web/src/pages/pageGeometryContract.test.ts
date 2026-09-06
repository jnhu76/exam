import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LAYOUT_RENDERED_PAGES,
  ROUTE_PAGE_ROLES,
  type RoutePageRole,
} from "@/lib/pageRoles";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..");

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

/**
 * The closed role vocabulary is parsed out of PageContainer.tsx (the single
 * authority) so this test can never drift from the component.
 */
const pageContainerRoles = (() => {
  const sourceFile = parse(
    join(srcRoot, "components/shared/PageContainer.tsx"),
  );
  let roles: string[] | null = null;
  sourceFile.forEachChild(function walk(node: ts.Node) {
    if (
      roles === null &&
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => d.name.getText() === "roleClasses",
      )
    ) {
      const decl = node.declarationList.declarations.find(
        (d) => d.name.getText() === "roleClasses",
      );
      const init = decl?.initializer;
      if (init && ts.isObjectLiteralExpression(init)) {
        roles = init.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => p.name.getText().replace(/['"]/g, ""));
      }
    }
    node.forEachChild(walk);
  });
  if (roles === null) throw new Error("roleClasses not found in PageContainer");
  return roles as readonly string[];
})();

/** All `<PageContainer role="…">` string-literal roles declared in a file. */
function declaredPageContainerRoles(file: string): string[] {
  const sourceFile = parse(file);
  const roles: string[] = [];
  sourceFile.forEachChild(function walk(node: ts.Node) {
    if (
      ts.isJsxOpeningElement(node) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "PageContainer"
    ) {
      const roleAttr = node.attributes.properties.find(
        (a): a is ts.JsxAttribute =>
          ts.isJsxAttribute(a) &&
          ts.isIdentifier(a.name) &&
          a.name.text === "role",
      );
      if (!roleAttr) {
        roles.push("(missing role prop)");
        return;
      }
      const init = roleAttr.initializer;
      if (init && ts.isStringLiteral(init)) roles.push(init.text);
      else roles.push("(non-literal role)");
    }
    node.forEachChild(walk);
  });
  return roles;
}

/** Import specifier → file path for every `@/pages/**` import in App.tsx. */
function routedPageImports(): Map<string, string> {
  const appFile = join(srcRoot, "App.tsx");
  const sourceFile = parse(appFile);
  const imports = new Map<string, string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const module = node.moduleSpecifier;
    if (!module || !ts.isStringLiteral(module)) return;
    if (!module.text.startsWith("@/pages/")) return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const spec of bindings.elements) {
      imports.set(spec.name.text, join(srcRoot, `${module.text.slice(2)}.tsx`));
    }
  });
  return imports;
}

/** The page components referenced by `<Route element={<X />}>` in App.tsx. */
function routedPageComponents(): Map<string, string> {
  const appFile = join(srcRoot, "App.tsx");
  const sourceFile = parse(appFile);
  const imports = routedPageImports();
  const routed = new Map<string, string>();
  sourceFile.forEachChild(function walk(node: ts.Node) {
    // Routes appear both as self-closing `<Route … />` and paired elements.
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "Route"
    ) {
      const elementAttr = node.attributes.properties.find(
        (a): a is ts.JsxAttribute =>
          ts.isJsxAttribute(a) &&
          ts.isIdentifier(a.name) &&
          a.name.text === "element",
      );
      let expr:
        | ts.JsxElement
        | ts.JsxSelfClosingElement
        | ts.Expression
        | undefined = elementAttr?.initializer;
      // element={<X />} wraps the element in a JsxExpression — unwrap it.
      if (expr && ts.isJsxExpression(expr)) expr = expr.expression;
      if (expr && (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr))) {
        const inner = ts.isJsxElement(expr)
          ? expr.openingElement
          : (expr as ts.JsxSelfClosingElement);
        if (ts.isIdentifier(inner.tagName) && imports.has(inner.tagName.text)) {
          routed.set(inner.tagName.text, imports.get(inner.tagName.text)!);
        }
      }
    }
    node.forEachChild(walk);
  });
  return routed;
}

/**
 * Resolved route entry: fully-qualified route string + component name.
 * Produced by walking the App.tsx JSX AST and resolving nested Route paths.
 */
interface ResolvedRouteEntry {
  /** Fully-resolved route pattern (e.g. `/admin/questions/:id/edit`). */
  route: string;
  /** Page component name (imported from `@/pages/**`). */
  page: string;
}

/**
 * Route-aware extraction from App.tsx. Resolves nested React Router structure
 * into fully-qualified `{route, page}` pairs so the fixture can be compared
 * against actual routing — not just component-name sets.
 *
 * Deduplicates by `${route}::${page}` key so component-name-multiplicity is
 * proven: if two routes render the same component, both appear.
 */
function resolvedRouteEntries(): ResolvedRouteEntry[] {
  const appFile = join(srcRoot, "App.tsx");
  const sourceFile = parse(appFile);
  const imports = routedPageImports();
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

/**
 * Root-width rule: inside the exported page component, a top-level
 * `return (<el className="…">)` whose root element both centers itself and
 * picks its own max-width competes with PageContainer's geometry authority
 * (issue 455 §23). Local narrower constraints deeper in the tree stay legal;
 * `className` expressions that are not string literals are not statically
 * decidable and are skipped (documented limitation).
 */
function pageRootWidthViolations(file: string): string[] {
  const sourceFile = parse(file);
  const violations: string[] = [];
  for (const statement of sourceFile.statements) {
    // Only exported top-level components (function or const arrow).
    const isExported =
      ts.canHaveModifiers(statement) &&
      (ts
        .getModifiers(statement)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
        false);
    if (!isExported) continue;
    let componentName: string | null = null;
    let body: ts.Block | null = null;
    if (ts.isFunctionDeclaration(statement) && statement.name?.text) {
      componentName = statement.name.text;
      body = statement.body ?? null;
    } else if (ts.isVariableStatement(statement)) {
      const d = statement.declarationList.declarations[0];
      if (d && ts.isIdentifier(d.name)) componentName = d.name.text;
      const init = d?.initializer;
      if (init && ts.isArrowFunction(init) && ts.isBlock(init.body)) {
        body = init.body;
      }
    }
    if (!componentName || !/^[A-Z]/.test(componentName) || !body) continue;
    for (const s of body.statements) {
      if (!ts.isReturnStatement(s) || !s.expression) continue;
      let root: ts.Expression = s.expression;
      while (
        ts.isParenthesizedExpression(root) ||
        ts.isAsExpression(root) ||
        ts.isNonNullExpression(root)
      ) {
        root = root.expression;
      }
      if (!ts.isJsxElement(root) && !ts.isJsxSelfClosingElement(root)) continue;
      const opening = ts.isJsxElement(root) ? root.openingElement : root;
      const classAttr = opening.attributes.properties.find(
        (a): a is ts.JsxAttribute =>
          ts.isJsxAttribute(a) &&
          ts.isIdentifier(a.name) &&
          (a.name.text === "className" || a.name.text === "class"),
      );
      const init = classAttr?.initializer;
      if (!init || !ts.isStringLiteral(init)) continue;
      const cls = init.text;
      if (/(\S|^)mx-auto/.test(cls) && /max-w-/.test(cls)) {
        violations.push(
          `${componentName}: root <${opening.tagName.getText()}> declares mx-auto + max-w-* (page geometry belongs to PageContainer)`,
        );
      }
    }
  }
  return violations;
}

const routed = routedPageComponents();
const fixture = ROUTE_PAGE_ROLES;
// Layout-rendered pages declare geometry without being routed elements;
// resolve their files statically (pages/admin/**).
const layoutRenderedFiles = new Map(
  LAYOUT_RENDERED_PAGES.map((entry) => [
    entry.page,
    join(srcRoot, "pages/admin", `${entry.page}.tsx`),
  ]),
);

describe("page geometry contract (issue 455)", () => {
  it("keeps the role vocabulary closed at six roles with admin-sparse absent", () => {
    expect([...pageContainerRoles].sort()).toEqual([
      "admin-standard",
      "admin-wide",
      "auth",
      "candidate",
      "exam-runtime",
      "form",
    ]);
    expect(pageContainerRoles).not.toContain("admin-sparse");
  });

  it.each([...routed.entries()])(
    "%s declares at least one PageContainer role from the vocabulary",
    (page, file) => {
      const roles = declaredPageContainerRoles(file);
      expect(
        roles.length,
        `page ${page} has no PageContainer role — every routed page must declare one (file ${file})`,
      ).toBeGreaterThan(0);
      for (const role of roles) {
        expect(
          pageContainerRoles.includes(role),
          `page ${page} declares unknown role "${role}"${
            role === "admin-sparse"
              ? " (removed — merged into admin-standard)"
              : ""
          }`,
        ).toBe(true);
      }
    },
  );

  it.each([...ROUTE_PAGE_ROLES, ...LAYOUT_RENDERED_PAGES])(
    "fixture $route → $page stays in sync with the declared role",
    ({ page, role }: RoutePageRole) => {
      const file = routed.get(page) ?? layoutRenderedFiles.get(page);
      expect(
        file,
        `fixture lists ${page} but App.tsx no longer routes it (and it is not a layout-rendered page)`,
      ).toBeDefined();
      const roles = declaredPageContainerRoles(file!);
      expect(
        roles.includes(role),
        `fixture expects ${page} to declare "${role}" but the file declares [${roles.join(", ")}]`,
      ).toBe(true);
    },
  );

  it("proves route→page pairs match the fixture exactly (including multiplicity)", () => {
    // Route-aware extraction: resolves nested React Router paths so the
    // fixture is proved against actual (route, page) pairs — not just
    // component-name sets. Deduplication via key ensures multiplicity is
    // proven: two routes rendering the same component both appear.
    const actual = resolvedRouteEntries();
    const fixturePairs = ROUTE_PAGE_ROLES.map((f) => `${f.route}::${f.page}`);
    const actualPairs = actual.map((e) => `${e.route}::${e.page}`);

    const fixtureSet = new Set(fixturePairs);
    const actualSet = new Set(actualPairs);

    expect(
      [...actualSet].filter((p) => !fixtureSet.has(p)),
      "actual (route, page) pairs missing from ROUTE_PAGE_ROLES fixture — add them with their honest role",
    ).toEqual([]);
    expect(
      [...fixtureSet].filter((p) => !actualSet.has(p)),
      "fixture entries whose (route, page) pair no longer exists in App.tsx",
    ).toEqual([]);
  });

  it("proves route multiplicity: duplicate-component routes are individually proven", () => {
    // This catches the class of bug where two routes share a component but
    // only one appears in the fixture — deleting one route would still pass
    // a component-name-set comparison.
    const actual = resolvedRouteEntries();
    const actualCounts = new Map<string, number>();
    for (const e of actual) {
      const key = `${e.route}::${e.page}`;
      actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
    }
    const fixtureCounts = new Map<string, number>();
    for (const f of ROUTE_PAGE_ROLES) {
      const key = `${f.route}::${f.page}`;
      fixtureCounts.set(key, (fixtureCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of actualCounts) {
      expect(
        fixtureCounts.get(key),
        `actual pair ${key} appears ${count} time(s) but fixture has ${fixtureCounts.get(key) ?? 0}`,
      ).toBe(count);
    }
  });

  it("mutation proof: changing a duplicate-component route path breaks the route fixture", async () => {
    // C1 corrective: prove the route-aware extraction catches path changes
    // that a component-name-set comparison would miss. Both
    // /admin/questions/new and /admin/questions/:id/edit render
    // QuestionEditPage — mutating one path must break the fixture.
    const { writeFileSync, readFileSync: readFS } = await import("node:fs");
    const appFile = join(srcRoot, "App.tsx");
    const original = readFS(appFile, "utf8");
    try {
      // Mutate: append "-mutant" to the :id/edit route path.
      const mutant = original.replace(
        'path="questions/:id/edit"',
        'path="questions/:id/edit-mutant"',
      );
      expect(mutant).not.toBe(
        original,
        "sanity: mutation must change the file",
      );
      writeFileSync(appFile, mutant, "utf8");

      // The route-aware extraction now sees a new (route, page) pair that the
      // fixture does not contain → the route comparison test must fail.
      const actual = resolvedRouteEntries();
      const fixturePairs = new Set(
        ROUTE_PAGE_ROLES.map((f) => `${f.route}::${f.page}`),
      );
      const unexpected = actual.filter(
        (e) => !fixturePairs.has(`${e.route}::${e.page}`),
      );
      expect(
        unexpected.length,
        "mutant route should produce an unexpected (route, page) pair",
      ).toBeGreaterThan(0);
    } finally {
      writeFileSync(appFile, original, "utf8");
    }
  });

  it.each([
    "components/layout/AdminLayout.tsx",
    "components/layout/ExamLayout.tsx",
  ])("%s owns only the gutter — no role inference, no PageContainer", (rel) => {
    const file = join(srcRoot, rel);
    const sourceFile = parse(file);
    // AST-level: comments must not trip the rule, but real JSX/imports do.
    let rendersPageContainer = false;
    let importsPageContainer = false;
    const roleLiterals: string[] = [];
    sourceFile.forEachChild(function walk(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.includes("PageContainer")
      ) {
        importsPageContainer = true;
      }
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        node.tagName.text === "PageContainer"
      ) {
        rendersPageContainer = true;
      }
      if (ts.isStringLiteral(node) && pageContainerRoles.includes(node.text)) {
        roleLiterals.push(node.text);
      }
      node.forEachChild(walk);
    });
    expect(
      rendersPageContainer || importsPageContainer,
      `${rel} must not render/import PageContainer — page width belongs to the page`,
    ).toBe(false);
    expect(
      roleLiterals,
      `${rel} must not know page-role literals — that is URL→width inference`,
    ).toEqual([]);
    expect(roleLiterals).not.toContain("admin-sparse");
  });

  it("no routed page root competes with PageContainer via mx-auto + max-w-*", () => {
    const violations = [...routed.values()].flatMap((file) =>
      pageRootWidthViolations(file),
    );
    expect(violations).toEqual([]);
  });

  it("freezes layout gutters and pairs the G.7a full-bleed escape with them", () => {
    // Model A: the layout owns exactly this gutter and nothing else. A change
    // here must be a conscious contract change — it re-flows every page under
    // the layout and silently breaks TakeExamPage's full-bleed escape, whose
    // negative margins must cancel the ExamLayout gutter exactly (G.7a).
    const admin = readFileSync(
      join(srcRoot, "components/layout/AdminLayout.tsx"),
      "utf8",
    );
    expect(admin).toContain('<main className="p-4 lg:p-8">');
    const exam = readFileSync(
      join(srcRoot, "components/layout/ExamLayout.tsx"),
      "utf8",
    );
    expect(exam).toContain('<main className="p-4 sm:p-6">');
    const takeExam = readFileSync(
      join(srcRoot, "pages/exam/TakeExamPage.tsx"),
      "utf8",
    );
    expect(takeExam).toContain("-m-4 ");
    expect(takeExam).toContain("sm:-m-6");
  });
});
