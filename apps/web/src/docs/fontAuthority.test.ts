import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Primary-font truth coherence (#577 M1).
 *
 * Runtime truth: the primary UI family is self-hosted HarmonyOS Sans SC
 * (Regular/Medium/Bold linked in index.html). Noto Sans CJK SC is a
 * name-in-stack fallback only — no Noto sans webfont is loaded. All four
 * carriers (index.html, index.css token + comment, DESIGN.md, ui-system.md)
 * must tell this same story; a doc that re-elevates Noto to "the loaded
 * self-hosted sans" is exactly the drift class this gate catches.
 *
 * Bundled-source authority (#601): the generated @font-face
 * declarations must not list a host `local(...)` source before (or instead
 * of) the bundled WOFF2 — a host with HarmonyOS Sans SC installed would
 * otherwise silently replace the bundled binary, and the same `font-weight`
 * renders with a different optical weight per host. Regeneration after a
 * cn-font-split re-run goes through
 * scripts/fonts/bundled-font-sources.mjs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const INDEX_HTML = readFileSync(
  join(repoRoot, "apps", "web", "index.html"),
  "utf8",
);
const INDEX_CSS = readFileSync(
  join(repoRoot, "apps", "web", "src", "index.css"),
  "utf8",
);
const DESIGN = readFileSync(join(repoRoot, "DESIGN.md"), "utf8");
const UI_SYSTEM = readFileSync(
  join(repoRoot, "docs", "standards", "ui-system.md"),
  "utf8",
);

export function fontTruthViolations(files: {
  indexHtml: string;
  indexCss: string;
  design: string;
  uiSystem: string;
}): string[] {
  const v: string[] = [];
  const { indexHtml, indexCss, design, uiSystem } = files;

  if (!indexHtml.includes("/fonts/harmonyos-sans-sc/"))
    v.push("index.html no longer links the HarmonyOS Sans SC faces");
  if (/noto-sans-cjk-sc/.test(indexHtml))
    v.push(
      "index.html links a noto-sans-cjk-sc webfont (not a loaded fallback)",
    );

  const fontUi = /--font-ui:\s*([^;]+);/.exec(indexCss)?.[1] ?? "";
  if (!fontUi.trimStart().startsWith('"HarmonyOS Sans SC"'))
    v.push("--font-ui no longer resolves HarmonyOS Sans SC first");

  for (const [name, doc] of [
    ["DESIGN.md", design],
    ["ui-system.md", uiSystem],
  ] as const) {
    if (!/HarmonyOS Sans SC/.test(doc))
      v.push(
        `${name} does not name HarmonyOS Sans SC as the primary UI family`,
      );
    // A doc claiming Noto Sans CJK SC is the self-hosted/loaded primary tells
    // the superseded story.
    if (/self-hosted\s+`?Noto Sans CJK SC`?/.test(doc))
      v.push(`${name} still claims Noto Sans CJK SC is self-hosted/loaded`);
    if (/Noto Sans CJK SC.*preloaded/.test(doc))
      v.push(`${name} claims Noto Sans CJK SC is preloaded`);
  }
  return v;
}

describe("primary font truth is coherent across code + docs (R3)", () => {
  it("all four carriers tell the HarmonyOS-first story", () => {
    expect(
      fontTruthViolations({
        indexHtml: INDEX_HTML,
        indexCss: INDEX_CSS,
        design: DESIGN,
        uiSystem: UI_SYSTEM,
      }),
    ).toEqual([]);
  });

  it("the fallback framing does not claim a webfont that is not loaded", () => {
    expect(INDEX_CSS).toMatch(/fallback/i);
    expect(INDEX_CSS).not.toMatch(/self-hosted via \/fonts\/noto-sans-cjk-sc/);
  });

  it("reds when a doc re-elevates Noto to the loaded primary (mutation)", () => {
    const mutated = fontTruthViolations({
      indexHtml: INDEX_HTML,
      indexCss: INDEX_CSS,
      design: DESIGN.replace(
        /HarmonyOS Sans SC/,
        "self-hosted `Noto Sans CJK SC`",
      ),
      uiSystem: UI_SYSTEM,
    });
    expect(mutated.some((m) => m.startsWith("DESIGN.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bundled @font-face source authority (issue #601 Step 1).
// ---------------------------------------------------------------------------

const FONT_CSS_DIR = join(
  repoRoot,
  "apps",
  "web",
  "public",
  "fonts",
  "harmonyos-sans-sc",
);
const FACE_WEIGHTS = {
  "Regular.css": "400",
  "Medium.css": "500",
  "Bold.css": "700",
} as const;

type FontFace = {
  src: string;
  family: string;
  weight: string;
  display: string;
  unicodeRange: boolean;
};

export function parseFontFaces(css: string): FontFace[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1] ?? "";
    const prop = (name: string) =>
      new RegExp(`${name}\\s*:\\s*([^;\\n]+)`).exec(body)?.[1]?.trim() ?? "";
    return {
      src: prop("src"),
      family: prop("font-family"),
      weight: prop("font-weight"),
      display: prop("font-display"),
      unicodeRange: /unicode-range\s*:/.test(body),
    };
  });
}

/**
 * Pure checker over the three HarmonyOS face stylesheets. Returns every way
 * the bundled-source authority is violated (in-memory, so mutation proofs
 * never touch disk).
 */
export function bundledFontSourceViolations(files: {
  [name: string]: string;
}): string[] {
  const v: string[] = [];
  for (const [name, css] of Object.entries(files)) {
    if (!css.includes("@font-face")) {
      v.push(`${name}: no @font-face declarations found`);
      continue;
    }
    if (/local\s*\(/.test(css)) {
      v.push(
        `${name}: declares a local() source — a host-installed HarmonyOS Sans SC would precede the bundled WOFF2`,
      );
    }
    const faces = parseFontFaces(css);
    const expectedWeight =
      FACE_WEIGHTS[name as keyof typeof FACE_WEIGHTS] ?? "(unknown face)";
    for (const [i, face] of faces.entries()) {
      if (
        face.family !== '"HarmonyOS Sans SC"' &&
        face.family !== "'HarmonyOS Sans SC'"
      ) {
        v.push(`${name}: face ${i} has unexpected font-family ${face.family}`);
      }
      if (face.weight !== expectedWeight) {
        v.push(
          `${name}: face ${i} declares weight ${face.weight}, expected ${expectedWeight}`,
        );
      }
      const urls = [...face.src.matchAll(/url\("(\.\/[^"]+\.woff2)"\)/g)].map(
        (m) => m[1]!,
      );
      if (urls.length !== 1 || !/format\("woff2"\)/.test(face.src)) {
        v.push(
          `${name}: face ${i} src must be exactly one bundled woff2 url, got: ${face.src}`,
        );
      }
      if (!face.unicodeRange) {
        v.push(`${name}: face ${i} lost its unicode-range split`);
      }
      if (face.display !== "swap") {
        v.push(`${name}: face ${i} changed font-display: ${face.display}`);
      }
    }
  }
  return v;
}

describe("bundled @font-face source authority (issue #601 Step 1)", () => {
  const files = Object.fromEntries(
    Object.keys(FACE_WEIGHTS).map((name) => [
      name,
      readFileSync(join(FONT_CSS_DIR, name), "utf8"),
    ]),
  );

  it("the three face stylesheets linked from index.html exist under public/fonts", () => {
    const linked = [
      ...INDEX_HTML.matchAll(/fonts\/harmonyos-sans-sc\/(\w+\.css)/g),
    ].map((m) => m[1]!);
    expect(linked.sort()).toEqual(Object.keys(FACE_WEIGHTS).sort());
    for (const name of Object.keys(FACE_WEIGHTS)) {
      expect(existsSync(join(FONT_CSS_DIR, name)), name).toBe(true);
    }
  });

  it("declares bundled-only sources with the frozen face shape", () => {
    const violations = bundledFontSourceViolations(files);
    expect(violations).toEqual([]);
    // The shape assertions are meaningful only against the real corpus.
    const faceCount = Object.values(files).flatMap(parseFontFaces).length;
    expect(faceCount).toBeGreaterThanOrEqual(3 * 50);
    for (const [name, expected] of Object.entries(FACE_WEIGHTS)) {
      expect(
        new Set(parseFontFaces(files[name]!).map((f) => f.weight)),
      ).toEqual(new Set([expected]));
    }
  });

  it("every referenced woff2 chunk exists on disk (source = real binary)", () => {
    const chunks = Object.values(files).flatMap((css) =>
      Object.values(parseFontFaces(css)).flatMap((face) =>
        [...face.src.matchAll(/url\("(\.\/[^"]+\.woff2)"\)/g)].map(
          (m) => m[1]!,
        ),
      ),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3 * 50);
    for (const chunk of chunks) {
      expect(existsSync(join(FONT_CSS_DIR, chunk)), chunk).toBe(true);
    }
  });

  it("the directory holds no unlinked extra face stylesheet", () => {
    expect(
      readdirSync(FONT_CSS_DIR)
        .filter((f) => f.endsWith(".css"))
        .sort(),
    ).toEqual(Object.keys(FACE_WEIGHTS).sort());
  });

  it("reds when local() precedence returns (mutation)", () => {
    const mutated = {
      "Regular.css": files["Regular.css"]!.replace(
        /src:\s*url\((\s*"?\.\/[^"]+"?)\s*\)/,
        'src:local("HarmonyOS Sans SC"),url($1)',
      ),
    };
    expect(bundledFontSourceViolations(mutated)).toContainEqual(
      expect.stringContaining("Regular.css: declares a local() source"),
    );
  });
});
