import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPA_ROUTE_TEMPLATES } from "@exam/contracts";
import { AppRoutes } from "../App";

/**
 * #864 drift guard: the server-side closed route-template vocabulary
 * (`SPA_ROUTE_TEMPLATES` in @exam/contracts — the single authority consumed
 * by the client-event ingest projection AND the proctor timeline read
 * projection) must stay in exact lockstep with the SPA router actually
 * declared in App.tsx. A route added/removed/renamed here without updating
 * the vocabulary fails this test — and vice versa — instead of silently
 * widening or narrowing what `client_events.route` may persist.
 *
 * The parser below is deliberately structural (brace-aware tag scanning),
 * not a regex over path literals: JSX attributes carry `>` inside
 * `element={<X />}`, so a flat regex would mis-slice the tree.
 */

interface RouteTree {
  /** Absolute paths of every non-wildcard, non-redirect-only route. */
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
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("<Route", i);
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
      absolute = parent ? `${parent}/${declared}` : declared;
    } else {
      throw new Error(`<Route> without path/index: ${attrs}`);
    }
    paths.add(absolute);
    if (!selfClosing) stack.push(absolute);
  }
  return { paths, splats };
}

describe("SPA route-template vocabulary drift guard (#864)", () => {
  const appSource = readFileSync(
    fileURLToPath(new URL("../App.tsx", import.meta.url)),
    "utf8",
  );

  it("AppRoutes is still exported (guard anchor)", () => {
    expect(typeof AppRoutes).toBe("function");
  });

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
