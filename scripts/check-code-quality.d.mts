// Type declarations for scripts/check-code-quality.mjs — the single
// code-quality scan implementation (plain ESM so the CLI and the regression
// suite import the same code; no second scanner).
export declare const SCAN_ROOTS: readonly string[];
/** Playwright-generated output directories (repo-relative) excluded from the scan. */
export declare const GENERATED_E2E_OUTPUT_DIRS: readonly string[];
/** True when `line` contains a banned `console.log` / `console.error` call. */
export declare function isConsoleOutput(line: string): boolean;
/** Repository root derived from this script's own location, never the CWD. */
export declare function repositoryRoot(): string;
/** All violations under `repoRoot`, scanning both authoritative scan roots. */
export declare function collectViolations(repoRoot?: string): Promise<string[]>;
