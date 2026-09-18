import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SaveIndicator } from "@/components/exam/SaveIndicator";

/**
 * Semantic feedback tone layer (issue 577 M4 / Corrective G).
 *
 * The data-feedback-tone attribute is the single owner of the repeated
 * soft-feedback color triple (bg/border/text) for chips, banners, and timer
 * wells. These tests pin the recipe (values resolve through the SAME status
 * triples StatusBadge consumes — no new colors), the migrated consumers, and
 * a derivation guard: business UI may not re-derive the border-X/N +
 * bg-X/N soft-feedback pair outside the audited allowlist (issue 577 residue
 * awaiting its own migration pass).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPES_CSS = readFileSync(join(HERE, "recipes.css"), "utf8");
const WEB_SRC = join(HERE, "..");

const TONES = [
  "neutral",
  "info",
  "positive",
  "caution",
  "destructive",
] as const;
const TRIPLE: Record<(typeof TONES)[number], string> = {
  neutral: "status-neutral",
  info: "status-info",
  positive: "status-positive",
  caution: "status-caution",
  destructive: "status-destructive",
};

function extractRule(css: string, tone: string): string {
  const re = new RegExp(`\\[data-feedback-tone="${tone}"\\]\\s*\\{`);
  const m = re.exec(css);
  if (!m) return "";
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(bodyStart, i - 1);
}

describe("feedback tone recipes (issue 577 M4)", () => {
  it("defines exactly the five semantic feedback tones", () => {
    for (const tone of TONES) {
      expect(extractRule(RECIPES_CSS, tone), `missing tone: ${tone}`).not.toBe(
        "",
      );
    }
    const defined = [
      ...RECIPES_CSS.matchAll(/\[data-feedback-tone="(\w+)"\]/g),
    ];
    expect(new Set(defined.map((m) => m[1]!)).size).toBe(TONES.length);
  });

  it("resolves every tone through the status triples (no new colors, no hex)", () => {
    const declarationsOnly = RECIPES_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarationsOnly).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    for (const tone of TONES) {
      const rule = extractRule(RECIPES_CSS, tone);
      expect(rule).toContain(`var(--${TRIPLE[tone]}-bg)`);
      expect(rule).toContain(`var(--${TRIPLE[tone]}-border)`);
      expect(rule).toContain(`var(--${TRIPLE[tone]}-text)`);
    }
  });

  it("owns only the color triple — geometry stays with the consumer", () => {
    for (const tone of TONES) {
      const rule = extractRule(RECIPES_CSS, tone);
      const props = [...rule.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]!);
      expect(props.sort()).toEqual(["background", "border-color", "color"]);
    }
  });
});

describe("SaveIndicator consumes the feedback owner", () => {
  it.each([
    ["idle", "neutral"],
    ["saving", "info"],
    ["saved", "positive"],
    ["error", "destructive"],
  ] as const)("state %s renders tone %s", (state, tone) => {
    const { container } = render(<SaveIndicator state={state} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-feedback-tone")).toBe(tone);
  });

  it("keeps its geometry but not a second color authority", () => {
    const source = readFileSync(
      join(WEB_SRC, "components", "exam", "SaveIndicator.tsx"),
      "utf8",
    );
    expect(source).toContain("data-feedback-tone");
    expect(source).not.toMatch(
      /border-(primary|success|destructive|warning)\/\d+/,
    );
    expect(source).not.toMatch(/bg-(primary|success|destructive|warning)\/\d+/);
  });
});

describe("InlineErrorBanner / ErrorState consume the feedback owner", () => {
  it("banner is destructive-toned without a hand-built surface", () => {
    const source = readFileSync(
      join(WEB_SRC, "components", "shared", "InlineErrorBanner.tsx"),
      "utf8",
    );
    expect(source).toContain('data-feedback-tone="destructive"');
    expect(source).not.toContain("bg-destructive-soft");
    expect(source).not.toMatch(/border-destructive\/\d+/);
  });

  it("error placeholder border is tone-owned", () => {
    const source = readFileSync(
      join(WEB_SRC, "components", "shared", "ErrorState.tsx"),
      "utf8",
    );
    expect(source).toContain('data-feedback-tone="destructive"');
    expect(source).not.toMatch(/border-destructive\/\d+/);
  });
});

/**
 * Derivation guard (R6): the co-occurring `border-X/<alpha>` + `bg-X/<alpha>`
 * pair is the repeated soft-feedback signature the feedback owner replaces.
 * Component-local interaction derivations (a bg-only tint, a solid border)
 * stay legal — see issue 577 §13. The allowlist is the audited M4 residue that
 * still awaits its page-level migration; a NEW site outside it must fail.
 */
const BUSINESS_ROOTS = [
  "pages",
  "components/shared",
  "components/exam",
  "components/layout",
  "components/settings",
  "components/question",
  "components/notifications",
  "features",
];
// Mirror of scripts/lib/ui-scan-roots.mjs (its closure test keeps the real
// list honest; mirrors-with-pointer is the established pattern here).

const RESIDUE_ALLOWLIST: Record<string, string[]> = {
  "components/exam/ExamTimer.tsx": ["border-destructive/30+bg-destructive/10"],
  "pages/exam/StartExamPage.tsx": [
    "border-warning/20+bg-warning/10",
    "border-primary/30+bg-primary/10",
    "border-destructive/30+bg-destructive/10",
  ],
  "pages/exam/TakeExamPage.tsx": ["border-destructive/30+bg-destructive/10"],
  "pages/admin/RecoveryAttemptDetailPage.tsx": [
    "border-warning/40+bg-warning/10",
  ],
  "pages/admin/ProctorDashboardPage.tsx": [
    "border-warning/40+bg-warning/10",
    "border-warning/30+bg-warning/10",
  ],
};

const BORDER_TINT =
  /border-(primary|success|destructive|warning|info|danger)\/\d+/g;
const BG_TINT = /bg-(primary|success|destructive|warning|info|danger)\/\d+/g;

function walk(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (["dist", "coverage", "node_modules", "__snapshots__"].includes(e.name))
      continue;
    const t = join(dir, e.name);
    if (e.isDirectory()) walk(t, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name))
      out.push(t);
  }
  return out;
}

export function feedbackDerivationViolations(
  files: { path: string; text: string }[],
): string[] {
  const violations: string[] = [];
  for (const { path, text } of files) {
    const rel = path.slice(WEB_SRC.length + 1);
    const allowed = RESIDUE_ALLOWLIST[rel] ?? [];
    text.split("\n").forEach((line, i) => {
      const borders = [...line.matchAll(BORDER_TINT)].map((m) => m[0]);
      const bgs = [...line.matchAll(BG_TINT)].map((m) => m[0]);
      if (borders.length === 0 || bgs.length === 0) return;
      for (const b of borders) {
        for (const g of bgs) {
          const pair = `${b}+${g}`;
          if (!allowed.includes(pair)) {
            violations.push(
              `${rel}:${i + 1}: ${pair} — use data-feedback-tone`,
            );
          }
        }
      }
    });
  }
  return violations;
}

describe("no new ad-hoc soft-feedback derivation (R6)", () => {
  it("business roots contain only the audited M4 residue", () => {
    const files = BUSINESS_ROOTS.flatMap((root) =>
      walk(join(WEB_SRC, root)),
    ).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    expect(feedbackDerivationViolations(files)).toEqual([]);
  });

  it("reds on a new derivation site (in-memory mutation)", () => {
    const files = [
      {
        path: join(WEB_SRC, "pages", "admin", "SomePage.tsx"),
        text: '<div className="border-warning/40 bg-warning/10">x</div>',
      },
    ];
    expect(feedbackDerivationViolations(files)).toHaveLength(1);
  });
});
