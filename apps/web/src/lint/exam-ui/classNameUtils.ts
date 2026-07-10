/**
 * Shared helpers for exam-ui ESLint rules.
 *
 * These rules reason about Tailwind utility classes that appear in JSX
 * `className` attributes. A className value in this codebase can be:
 *
 *   - a static string literal:           `<p className="text-sm text-destructive">`
 *   - a template literal (static quasis): `className={`a b ${cond ? "c" : "d"}`}`
 *   - a `cn(...)` call:                   `className={cn("a", cond && "b", obj)}`
 *   - a ternary / logical expr:           `className={cond ? "a" : "b"}`
 *   - a bare identifier / member expr:    `className={someVar}` (dynamic — unknown)
 *
 * To keep false positives low, we only inspect the STATICALLY KNOWABLE string
 * segments: literals, template quasis, and the string-literal arguments of
 * `cn(...)` / `clsx(...)` / `twMerge(...)` call expressions. A purely dynamic
 * className is returned as an empty token set (not reported).
 */
import type { TSESTree } from "@typescript-eslint/utils";
import type { RuleContext } from "@typescript-eslint/utils/ts-eslint";

export type ClassNameToken = {
  /** The matched utility substring (e.g. "shadow-sm", "text-destructive"). */
  value: string;
  /** The AST node that owns the token, for reporting. */
  node: TSESTree.Node;
};

const CLASS_NAME_ATTR = "className";

/** A named Tailwind utility family matcher (prefix-stem aware). */
export type UtilityFamily = {
  /** Rule-facing label, e.g. "shadow". */
  name: string;
  /**
   * Match a single whitespace-delimited className token. Must fully match the
   * token (anchored). Return the matched substring or null.
   */
  match: (token: string) => string | null;
};

/** Build a regex-backed family matcher for `prefix` utilities. */
export function prefixFamily(name: string, prefix: string): UtilityFamily {
  // e.g. prefix "shadow" matches shadow, shadow-sm, shadow-2xl, shadow-inner,
  // shadow-none, shadow-[...]. It must NOT match "shadow" inside another word
  // — but since tokens are whitespace-delimited utility fragments, a token
  // equals one utility, so an anchored match is correct.
  const re = new RegExp(`^(?:${prefix}(?:-[\\w[\\]\\\\/.-]+)?)$`);
  return {
    name,
    match: (tok) => (re.test(tok) ? tok : null),
  };
}

/** Match an exact token from a set, e.g. {"text-destructive"}. */
export function exactFamily(
  name: string,
  tokens: readonly string[],
): UtilityFamily {
  const set = new Set(tokens);
  return {
    name,
    match: (tok) => (set.has(tok) ? tok : null),
  };
}

/** Find the `className` JSXAttribute on a JSXOpeningElement, if any. */
export function findClassNameAttribute(
  node: TSESTree.JSXOpeningElement,
): TSESTree.JSXAttribute | null {
  for (const attr of node.attributes) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === CLASS_NAME_ATTR
    ) {
      return attr;
    }
  }
  return null;
}

/**
 * Collect every static className token on a node, descending through the
 * expression shapes this codebase uses. Returns one ClassNameToken per
 * whitespace-delimited static utility fragment found.
 */
export function collectClassNameTokens(
  expr: TSESTree.Node | null,
  out: ClassNameToken[] = [],
): ClassNameToken[] {
  if (!expr) return out;
  switch (expr.type) {
    case "Literal": {
      if (typeof expr.value === "string") {
        pushTokens(expr.value, expr, out);
      }
      break;
    }
    case "TemplateLiteral": {
      // Static quasis carry the literal parts; expressions are dynamic.
      for (const q of expr.quasis) {
        pushTokens(q.value.raw, q, out);
      }
      // Descend into embedded expressions so `cn(\`a ${cond ? "b" : "c"}\`)`
      // and `${cond ? "x" : "y"}` quasis are still inspected.
      for (const ex of expr.expressions) {
        collectClassNameTokens(ex, out);
      }
      break;
    }
    case "JSXExpressionContainer":
      collectClassNameTokens(expr.expression, out);
      break;
    case "ArrayExpression":
      for (const el of expr.elements) collectClassNameTokens(el, out);
      break;
    case "LogicalExpression":
      collectClassNameTokens(expr.left, out);
      collectClassNameTokens(expr.right, out);
      break;
    case "ConditionalExpression":
      collectClassNameTokens(expr.consequent, out);
      collectClassNameTokens(expr.alternate, out);
      break;
    case "CallExpression": {
      // cn(...) / clsx(...) / twMerge(...) — inspect string-literal args only.
      const callee = expr.callee;
      const name =
        callee.type === "Identifier"
          ? callee.name
          : callee.type === "MemberExpression" &&
              callee.property.type === "Identifier"
            ? callee.property.name
            : "";
      if (name === "cn" || name === "clsx" || name === "twMerge") {
        for (const arg of expr.arguments) collectClassNameTokens(arg, out);
      }
      break;
    }
    case "ChainExpression":
      collectClassNameTokens(expr.expression, out);
      break;
    case "BinaryExpression":
      if (expr.operator === "+") {
        collectClassNameTokens(expr.left, out);
        collectClassNameTokens(expr.right, out);
      }
      break;
    default:
      // Identifiers, member expressions, JSX elements, etc. are dynamic.
      break;
  }
  return out;
}

function pushTokens(
  raw: string,
  node: TSESTree.Node,
  out: ClassNameToken[],
): void {
  if (!raw) return;
  for (const piece of raw.split(/\s+/)) {
    if (piece) out.push({ value: piece, node });
  }
}

/**
 * Run a family matcher against collected tokens; return the matching tokens.
 */
export function findUtilities(
  tokens: ClassNameToken[],
  family: UtilityFamily,
): ClassNameToken[] {
  return tokens
    .map((t) => {
      const m = family.match(t.value);
      return m ? { value: m, node: t.node } : null;
    })
    .filter((x): x is ClassNameToken => x !== null);
}

/** Return true if any collected token equals `value`. */
export function hasToken(tokens: ClassNameToken[], value: string): boolean {
  return tokens.some((t) => t.value === value);
}

/** Return true if any token matches a predicate. */
export function hasAnyToken(
  tokens: ClassNameToken[],
  pred: (v: string) => boolean,
): boolean {
  return tokens.some((t) => pred(t.value));
}

/** Re-export RuleContext type for rules. */
export type { RuleContext };

/**
 * Whitespace-split a literal className string into a token set. Used by tests
 * and baseline normalization.
 */
export function tokenizeClassName(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}
