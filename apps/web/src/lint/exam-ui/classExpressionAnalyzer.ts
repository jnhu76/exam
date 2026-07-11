/**
 * Static class-expression analyzer (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §10).
 *
 * The flat `collectClassNameTokens()` (in `classNameUtils.ts`) flattens every
 * statically-knowable token into one set. That is correct for the existing
 * rules (`no-business-shadow`, `prefer-inline-error-banner`,
 * `no-arbitrary-typography`) where any single matching token is independently a
 * violation. But it is WRONG for the recipe-conflict rule, which must reason
 * about which classes CO-OCCUR on a single element at runtime:
 *
 *   cond ? "type-metadata" : "type-metric text-3xl"
 *
 * A flat set would yield {type-metadata, type-metric, text-3xl} and falsely
 * report "type-metadata + text-3xl" as a conflict — but those two never
 * co-exist on the same element.
 *
 * This analyzer returns the list of POSSIBLE CO-OCCURRENCE PATHS — the maximal
 * sets of static tokens that can appear together. Each path is checked
 * independently by the conflict rule.
 *
 * Combination cap: if a className expression expands to more than
 * MAX_ALTERNATIVES paths, the result degrades to `unknown` (review-only) so a
 * pathological conditional does not cause combinatorial explosion.
 *
 * Layering: a LEAF logic module. Consumes the JSX expression AST. Does NOT know
 * about Tailwind utilities or recipes — it only produces token-string paths. It
 * is the NEW substrate for the conflict rule ONLY; the existing flat extractor
 * is retained for the rules that need it.
 */
import type { TSESTree } from "@typescript-eslint/utils";

/** Maximum alternatives before the analysis degrades to "unknown". */
export const MAX_ALTERNATIVES = 32;

export type ClassExpressionAnalysis =
  | { kind: "known"; alternatives: string[][] }
  | { kind: "partially-known"; alternatives: string[][] }
  | { kind: "unknown" };

const EMPTY: string[][] = [];

/**
 * Analyze a JSX className expression value (the `attr.value` of a className
 * attribute) into possible co-occurrence paths.
 *
 * - A static string `"a b c"` → one path `["a","b","c"]`.
 * - A ternary `cond ? "a" : "b c"` → two paths `["a"]` and `["b","c"]`.
 * - A `cn()`/`clsx()`/`twMerge()` call merges its arg-paths pointwise (cartesian
 *   product, capped).
 * - A dynamic value (identifier/member) → `unknown`.
 * - A conditional with an unknown branch → `partially-known` (the known branch
 *   is still a path).
 */
export function analyzeClassExpression(
  expr: TSESTree.Node | null | undefined,
): ClassExpressionAnalysis {
  if (!expr) return { kind: "known", alternatives: [] };
  const result = walk(expr);
  return result;
}

/** Internal: every walk returns either a set of alternatives or unknown. */
type WalkResult =
  | { kind: "known" | "partially-known"; alternatives: string[][] }
  | { kind: "unknown" };

function walk(expr: TSESTree.Node): WalkResult {
  switch (expr.type) {
    case "Literal": {
      if (typeof (expr as TSESTree.Literal).value === "string") {
        return {
          kind: "known",
          alternatives: [tokens((expr as TSESTree.Literal).value as string)],
        };
      }
      return { kind: "unknown" };
    }
    case "TemplateLiteral": {
      // Static quasis carry literal segments. A template like
      // `a b ${cond ? "c" : "d"} e` has quasis ["a b ", " e"] and one expression.
      // We treat each quasi's tokens as a constant prefix/suffix and merge with
      // the embedded expressions' alternatives (cartesian product).
      const quasiTokens: string[] = [];
      for (const q of (expr as TSESTree.TemplateLiteral).quasis) {
        quasiTokens.push(...tokens(q.value.raw));
      }
      const exprParts: WalkResult[] = (
        expr as TSESTree.TemplateLiteral
      ).expressions.map((e) => walk(e));
      const merged = mergeAll([
        { kind: "known", alternatives: [quasiTokens] },
        ...exprParts,
      ]);
      return merged;
    }
    case "JSXExpressionContainer":
    case "JSXFragment":
      // JSXExpressionContainer wraps the real expression; descend.
      if (expr.type === "JSXExpressionContainer")
        return walk((expr as TSESTree.JSXExpressionContainer).expression);
      return { kind: "unknown" };
    case "ArrayExpression": {
      // [a, b, c] → cartesian product of each element's alternatives.
      const parts = (expr as TSESTree.ArrayExpression).elements
        .map((el) => (el === null ? null : walk(el)))
        .filter((el: WalkResult | null): el is WalkResult => el !== null);
      return mergeAll(parts);
    }
    case "LogicalExpression": {
      // `a && "b"` → a may be falsy (so "b" is absent) OR truthy ("b" present).
      //   → paths: [] (from a-falsy, if a is dynamic → unknown) and [a's paths + "b"].
      // `a || "b"` → if a is unknown, "b" is a fallback path.
      // Conservative: merge left+right alternatives; for `&&` also include the
      // right side alone (when left is truthy but dynamic, the right tokens still
      // apply). We treat `&&`/`||` identically by merging both sides' paths.
      const l = walk((expr as TSESTree.LogicalExpression).left);
      const r = walk((expr as TSESTree.LogicalExpression).right);
      return mergeAll([l, r]);
    }
    case "ConditionalExpression": {
      const c = expr as TSESTree.ConditionalExpression;
      const cons = walk(c.consequent);
      const alt = walk(c.alternate);
      // If BOTH branches are known → union of paths (each is a distinct path).
      // If ONE branch is unknown → partially-known (the known branch still yields
      // a path; the unknown branch is an additional unknown runtime state).
      if (cons.kind === "unknown" && alt.kind === "unknown")
        return { kind: "unknown" };
      const alts: string[][] = [];
      let partially = false;
      if (cons.kind === "unknown") partially = true;
      else alts.push(...cons.alternatives);
      if (alt.kind === "unknown") partially = true;
      else alts.push(...alt.alternatives);
      // Deduplicate identical paths.
      return {
        kind: partially ? "partially-known" : "known",
        alternatives: dedupe(alts),
      };
    }
    case "ChainExpression":
      return walk((expr as TSESTree.ChainExpression).expression);
    case "BinaryExpression": {
      // `"a" + "b"` → ["a","b"]; `"a" + dyn` → partially-known.
      if ((expr as TSESTree.BinaryExpression).operator === "+") {
        return mergeAll([
          walk((expr as TSESTree.BinaryExpression).left),
          walk((expr as TSESTree.BinaryExpression).right),
        ]);
      }
      return { kind: "unknown" };
    }
    case "CallExpression": {
      const call = expr as TSESTree.CallExpression;
      const callee = call.callee;
      const name =
        callee.type === "Identifier"
          ? callee.name
          : callee.type === "MemberExpression" &&
              callee.property.type === "Identifier"
            ? callee.property.name
            : "";
      if (name === "cn" || name === "clsx" || name === "twMerge") {
        // cn(a, b, c) → cartesian product of each arg's alternatives.
        const parts = call.arguments.map((a) => walk(a));
        return mergeAll(parts);
      }
      return { kind: "unknown" };
    }
    case "ObjectExpression": {
      // cn({ "type-metadata": cond, "p-4": true }) — object-arg form.
      // Only STATIC keys with a truthy-or-dynamic value contribute. A key whose
      // value is `false`/`null`/`0` is excluded. A dynamic value (identifier) →
      // the key MIGHT apply → treat as a partially-known single path.
      const knownKeys: string[] = [];
      let partially = false;
      for (const prop of (expr as TSESTree.ObjectExpression).properties) {
        if (prop.type !== "Property") continue;
        const key = propertyKey(prop);
        if (key === null) continue;
        // Static-falsy value → key never applies.
        if (isStaticFalsy(prop.value)) continue;
        // Static-truthy value → key always applies (in this object).
        // Dynamic value → key conditionally applies → partially-known.
        if (!isStaticTruthy(prop.value)) partially = true;
        knownKeys.push(...tokens(key));
      }
      return {
        kind: partially ? "partially-known" : "known",
        alternatives: knownKeys.length ? [knownKeys] : EMPTY,
      };
    }
    default:
      // Identifiers, member expressions, etc. → dynamic → unknown.
      return { kind: "unknown" };
  }
}

/** Whitespace-split a literal string into token strings (empty removed). */
function tokens(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean);
}

/** Cartesian-merge a list of walk results into one alternatives set (capped). */
function mergeAll(parts: WalkResult[]): WalkResult {
  const filtered = parts.filter(
    (p): p is Extract<WalkResult, { alternatives: string[][] }> =>
      p.kind !== "unknown",
  );
  if (filtered.length < parts.length) {
    // At least one unknown part. If there are known/partial parts, the result is
    // partially-known (those known tokens still co-occur); otherwise unknown.
    if (filtered.length === 0) return { kind: "unknown" };
    const merged = cartesian(filtered.map((p) => p.alternatives));
    return { kind: "partially-known", alternatives: merged };
  }
  // No unknown parts, but a partial part makes the whole merge partial.
  const hasPartial = parts.some((p) => p.kind === "partially-known");
  const merged = cartesian(filtered.map((p) => p.alternatives));
  return {
    kind: hasPartial ? "partially-known" : "known",
    alternatives: merged,
  };
}

/** Cartesian product of token-path arrays, with the MAX_ALTERNATIVES cap. */
function cartesian(groups: string[][][]): string[][] {
  if (groups.length === 0) return [[]];
  let result: string[][] = [[]];
  for (const group of groups) {
    if (group.length === 0) {
      // An empty-alternative group (e.g. an empty string quasi) contributes
      // nothing; leave result as-is.
      continue;
    }
    const next: string[][] = [];
    for (const prefix of result) {
      for (const path of group) {
        next.push([...prefix, ...path]);
        if (next.length > MAX_ALTERNATIVES) {
          return next; // cap reached; caller treats overflow as-is (degraded)
        }
      }
    }
    result = dedupe(next);
    if (result.length > MAX_ALTERNATIVES) return result;
  }
  return result;
}

/** Deduplicate an array of token paths (order-independent within a path). */
function dedupe(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of paths) {
    const key = [...p].sort().join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Read a static property key from an ObjectExpression Property, or null. */
function propertyKey(prop: TSESTree.Property): string | null {
  const key = prop.key;
  if (prop.computed) {
    // {["a"]: x} — only if the computed key is a literal.
    if (key.type === "Literal" && typeof key.value === "string")
      return key.value;
    return null;
  }
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") {
    if (typeof key.value === "string") return key.value;
    return null;
  }
  return null;
}

function isStaticFalsy(node: TSESTree.Node): boolean {
  if (node.type === "Literal") {
    const v = (node as TSESTree.Literal).value;
    return v === false || v === null || v === 0 || v === "";
  }
  return false;
}

function isStaticTruthy(node: TSESTree.Node): boolean {
  if (node.type === "Literal") {
    const v = (node as TSESTree.Literal).value;
    return (
      v === true ||
      (typeof v === "number" && v !== 0) ||
      (typeof v === "string" && v !== "")
    );
  }
  return false;
}
