import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural CSS-rule extraction shared by the author-CSS authority gates
 * (AppIcon stroke cascade, default-border layer placement).
 *
 * WHY structural: jsdom cannot evaluate native cascade @layer, so no
 * in-vitest computed-style check can distinguish "base-layer default" from
 * "unlayered default". These gates pin the source structure that the
 * Tailwind v4 build compiles into the correct cascade order; the runtime
 * behavior is proven by browser computed-style probes (issue 577
 * review-fix-1 evidence).
 */

export type CssRule = {
  file: string;
  selectors: string[];
  body: string;
  /** Enclosing at-rule headers, outermost first (e.g. ["@layer base"]). */
  atRules: string[];
};

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract every rule (including rules nested in @layer/@media blocks). */
export function parseCssRules(file: string, css: string): CssRule[] {
  const src = stripCssComments(css);
  const rules: CssRule[] = [];
  const atContexts: string[] = [];
  const headers: Array<{ at: boolean; text: string }> = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      const text = buf.trim();
      buf = "";
      const at = text.startsWith("@");
      headers.push({ at, text });
      if (at) atContexts.push(text);
    } else if (ch === "}") {
      const top = headers.pop();
      if (top && !top.at) {
        rules.push({
          file,
          selectors: top.text
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          body: buf.trim(),
          atRules: [...atContexts],
        });
      }
      if (top && top.at) atContexts.pop();
      buf = "";
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** Every author stylesheet under the web src tree (superset of the main.tsx import closure). */
export function listAuthorStylesheets(srcRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".css")) out.push(p);
    }
  };
  walk(srcRoot);
  return out.sort();
}

/**
 * The BLOCKER-1 failure class: a bare-universal rule that assigns
 * border-color (via declaration or @apply border-border) outside @layer base.
 * Unlayered, it beats every layered border-color utility app-wide.
 */
export function unlayeredUniversalBorderRules(rules: CssRule[]): CssRule[] {
  return rules.filter((rule) => {
    const universal = rule.selectors.every((s) => s === "*");
    if (!universal) return false;
    const setsBorderColor =
      /(?:^|[;{\s])border-color\s*:/.test(rule.body) ||
      /@apply[^;{}]*border-border/.test(rule.body);
    if (!setsBorderColor) return false;
    return !rule.atRules.some((a) => a.startsWith("@layer"));
  });
}
