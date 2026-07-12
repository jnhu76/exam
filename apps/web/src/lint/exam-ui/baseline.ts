/**
 * Deterministic existing-violation baseline for exam-ui rules.
 *
 * Strategy: "existing-violation baseline" keyed by a stable, line-number-free
 * signature. A signature is `<relative-file-path>::<sorted-deduped-tokens>`.
 *
 * - Existing violations (captured at rule-introduction time) are suppressed.
 * - A NEW equivalent violation in a different file, or a new token in an
 *   already-listed file, is reported.
 *
 * This keeps the repository green today while still rejecting new bypasses —
 * the required invariant of UI-LINT-1. As business pages migrate to the
 * authoritative components, entries are removed (the migration tasks own this).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve the directory of this module. Under native ESM we'd use
 * `import.meta.url`, but ESLint loads our TS config via jiti (CJS transform),
 * where `import.meta.url` is unavailable. `__dirname` is provided by jiti in
 * CJS mode and points at this file's transpiled location, so baseline.json
 * (which ships beside this file) resolves correctly under both.
 */
const HERE =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname((await import("node:url")).fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, "baseline.json");

type BaselineMap = Record<string, string[]>;

let cached: BaselineMap | null = null;

/** Read the baseline.json that ships beside this module. */
function load(): BaselineMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineMap;
  } catch {
    cached = {};
  }
  return cached;
}

/** Used by tests to reset the module cache between cases. */
export function __resetBaselineCacheForTests(): void {
  cached = null;
}

/**
 * Build the stable signature for a violation set in one file under one rule.
 *
 * `tokens` are the matched utility tokens (e.g. ["shadow-sm"]) for that file;
 * they are sorted and de-duplicated so reordering or duplication in source
 * does not change the signature.
 */
export function signature(
  relativePath: string,
  tokens: readonly string[],
): string {
  const sorted = Array.from(new Set(tokens)).sort().join("|");
  return `${relativePath}::${sorted}`;
}

/**
 * Return true if the given (ruleId, signature) pair is an accepted existing
 * violation and must be suppressed.
 *
 * `ruleId` may be passed with or without the `exam-ui/` namespace prefix; both
 * forms resolve to the same baseline key (baseline.json stores the full
 * `exam-ui/<name>` form for human readability).
 */
export function isGrandfathered(ruleId: string, sig: string): boolean {
  const map = load();
  const list = map[ruleId] ?? map[`exam-ui/${ruleId}`];
  return Array.isArray(list) ? list.includes(sig) : false;
}

/**
 * Return true if the given file path is in the baseline for `ruleId` at all.
 * (Useful when a rule wants to know whether ANY violation in that file is
 * grandfathered, regardless of exact token set.)
 */
export function fileIsListed(ruleId: string, relativePath: string): boolean {
  const map = load();
  const list = map[ruleId] ?? map[`exam-ui/${ruleId}`];
  if (!Array.isArray(list)) return false;
  return list.some((sig) => sig.startsWith(`${relativePath}::`));
}

export { BASELINE_PATH };
