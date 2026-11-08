import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPA_ROUTE_TEMPLATES } from "@exam/contracts";

/**
 * #864 drift guard: the server-side closed route-template vocabulary
 * (`SPA_ROUTE_TEMPLATES` in @exam/contracts — the single authority consumed
 * by the client-event ingest projection AND the proctor timeline read
 * projection) must stay in exact lockstep with the SPA router actually
 * declared in App.tsx. A route added/removed/renamed here without updating
 * the vocabulary fails this test — and vice versa — instead of silently
 * widening or narrowing what `client_events.route` may persist.
 *
 * This test reads App.tsx as SOURCE TEXT only (importing the app module
 * would drag the React tree into a unit test and rewrites import.meta.url
 * semantics); the parser below is deliberately structural (brace-aware tag
 * scanning), not a regex over path literals: JSX attributes carry `>`
 * inside `element={<X />}`, so a flat regex would mis-slice the tree.
 */

interface RouteTree {
  /** Absolute paths of every non-wildcard route declaration. */
  paths: Set<string>;
  /** Count of `*` splat routes (rendered placeholders — excluded by design). */
  splats: number;
}

/** Extracts the <Route> tree from AppRoutes() as absolute path strings. */
function extractDeclaredPaths(source: string): RouteTree {
  const routesStart = source.indexOf("export function AppRoutes");
  expect(routesStart).toBeGreaterThan(-1);
  const routesEnd = source.indexOf("/**", routesStart);
  const body = source.slice(routesStart, routesEnd);

  const paths = new Set<string>();
  let splats = 0;
  // Context stack of absolute parent paths for currently-open layout routes.
  const stack: string[] = [];
  // `<Route` must be followed by whitespace/`>`/`/` so the outer `<Routes>`
  // wrapper is not mistaken for a route element.
  const OPEN_TAG = /<Route(?=[\s/>])/g;
  let i = 0;
  while (i < body.length) {
    OPEN_TAG.lastIndex = i;
    const openMatch = OPEN_TAG.exec(body);
    const open = openMatch === null ? -1 : openMatch.index;
    const close = body.indexOf("</Route>", i);
    if (open === -1 && close === -1) break;
    if (close !== -1 && (open === -1 || close < open)) {
      stack.pop();
      i = close + "</Route>".length;
      continue;
    }
    // Scan to the end of this opening tag, tracking JSX brace depth so `>`
    // inside element={...} does not terminate the tag.
    let j = open + "<Route".length;
    let braces = 0;
    let selfClosing = false;
    while (j < body.length) {
      const ch = body[j];
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === ">" && braces === 0) {
        selfClosing = body[j - 1] === "/";
        break;
      }
      j++;
    }
    if (j >= body.length) throw new Error("unterminated <Route> tag");
    const attrs = body.slice(open, j);
    i = j + 1;

    const parent = stack.at(-1);
    const pathMatch = /(?:\s|^)path="([^"]*)"/.exec(attrs);
    const isIndex = /(?:\s|^)index(?:\s|>|$)/.test(attrs);
    let absolute: string;
    if (isIndex) {
      // Index route: the parent path itself is the navigable page.
      if (!parent) throw new Error("index route without a parent layout");
      absolute = parent;
    } else if (pathMatch) {
      const declared = pathMatch[1]!;
      if (declared === "*") {
        splats++;
        continue; // splat placeholders never enter the vocabulary
      }
      // React Router semantics: a child path beginning with "/" is itself
      // absolute and ignores the parent prefix.
      absolute = declared.startsWith("/")
        ? declared
        : parent
          ? `${parent}/${declared}`
          : declared;
    } else {
      throw new Error(`<Route> without path/index: ${attrs}`);
    }
    paths.add(absolute);
    if (!selfClosing) stack.push(absolute);
  }
  return { paths, splats };
}

/**
 * Parser self-tests on synthetic fixtures: the drift guard's trust rests on
 * this parser, so a JSX-style change must fail HERE instead of silently
 * narrowing the guard (vacuity counter alone cannot catch a validator that
 * stops validating — architecture-review hardening).
 */
describe("extractDeclaredPaths fixture self-test", () => {
  it("handles nested layouts, index routes, absolute children, self-closing and splats", () => {
    const fixture = [
      "export function AppRoutes() {",
      "  return (",
      "    <Routes>",
      '      <Route path="/admin" element={<AdminLayout />}>',
      "        <Route index element={<Home />} />",
      '        <Route path="users" element={<Users />} />',
      '        <Route path="/abs" element={<Abs />} />',
      '        <Route path="*" element={<NotFound />} />',
      '        <Route path="items" element={<Items />}>',
      '          <Route path=":id/edit" element={<Edit />} />',
      "        </Route>",
      "      </Route>",
      '      <Route path="/standalone" element={<S />} />',
      '      <Route path="*" element={<N />} />',
      "    </Routes>",
      "  );",
      "}",
      "/**",
      " * doc tail",
      " */",
    ].join("\n");
    const { paths, splats } = extractDeclaredPaths(fixture);
    expect(paths).toEqual(
      new Set([
        "/admin",
        "/admin/users",
        "/abs",
        "/admin/items",
        "/admin/items/:id/edit",
        "/standalone",
      ]),
    );
    expect(splats).toBe(2);
  });

  it("throws on a route-shaped tag without path/index", () => {
    expect(() =>
      extractDeclaredPaths(
        "export function AppRoutes() { return <Routes><Route element={<X />} /></Routes>; }\n/**\n */",
      ),
    ).toThrow(/<Route> without path\/index/);
  });
});

describe("SPA route-template vocabulary drift guard (#864)", () => {
  // vitest runs with the app package root as cwd; resolve the router source
  // from there instead of import.meta.url (which vite rewrites when the
  // module graph reaches the browser-oriented app tree).
  const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

  it("SPA_ROUTE_TEMPLATES exactly equals the App.tsx route declarations", () => {
    const { paths } = extractDeclaredPaths(appSource);
    const declared = new Set(SPA_ROUTE_TEMPLATES);
    expect([...declared].filter((p) => !paths.has(p))).toEqual([]);
    expect([...paths].filter((p) => !declared.has(p))).toEqual([]);
  });

  it("the parser found a non-trivial tree (guard against silent no-op parses)", () => {
    const { paths, splats } = extractDeclaredPaths(appSource);
    // The real SPA declares dozens of routes plus layout splats; a parse
    // regression that yields ~0 routes must fail loudly instead of
    // vacuously passing set equality against a stale vocabulary.
    expect(paths.size).toBeGreaterThanOrEqual(40);
    expect(splats).toBeGreaterThanOrEqual(2);
  });
});
