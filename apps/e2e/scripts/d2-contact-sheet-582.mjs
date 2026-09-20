/**
 * D2 blind contact-sheet builder for EXAM-582 Stage B.
 *
 * Reads a d2-ab capture directory (.tmp/ui-patrol/d2-ab/<run>/) and renders
 * two reviewer-facing sheets:
 *   - macro sheet: full-viewport pairs per surface, scaled down for overview
 *     (raw PNGs remain the authoritative artifacts);
 *   - micro sheet: native-pixel crops (M1–M4), unscaled.
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never px values, never
 * "old/new/current/candidate". The X↔px mapping lives exclusively in
 * docs/research/exam-582-d2-visual-ab-1/artifacts/variant-map.json.
 *
 * Usage:
 *   node scripts/d2-contact-sheet-582.mjs <captureRoot> <macroOut.png> <microOut.png>
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, macroOut, microOut] = process.argv.slice(2);
if (!captureRoot || !macroOut || !microOut) {
  process.stderr.write(
    "usage: d2-contact-sheet-582.mjs <captureRoot> <macroOut.png> <microOut.png>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D2", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D2", "micro");
const SURFACE_ORDER = [
  "dashboard",
  "exam-list",
  "questions",
  "settings",
  "dialog",
  "take",
];
const SURFACE_LABELS = {
  dashboard: "Dashboard / overview",
  "exam-list": "Exam list (dense table)",
  questions: "Question management (dense table + tags)",
  settings: "Settings / admin form",
  dialog: "Assignment dialog",
  take: "Candidate exam runtime",
};

function listFiles(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function macroRows(suffix) {
  const files = listFiles(MACRO_DIR);
  const rows = [];
  for (const surface of SURFACE_ORDER) {
    const x = files.find((f) => f === `${surface}-X-${suffix}.png`);
    const y = files.find((f) => f === `${surface}-Y-${suffix}.png`);
    if (x && y) {
      rows.push({ surface, x: join(MACRO_DIR, x), y: join(MACRO_DIR, y) });
    }
  }
  return rows;
}

function microRows() {
  const files = listFiles(MICRO_DIR);
  const groups = new Map();
  for (const f of files) {
    const m = f.match(/^(m\d-[a-z-]+)-(X|Y)-1440x900\.png$/);
    if (!m) continue;
    const key = m[1];
    groups.set(key, {
      ...(groups.get(key) ?? {}),
      [m[2].toLowerCase()]: join(MICRO_DIR, f),
    });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function pairHtml(urlX, urlY, label, widthCss) {
  const style =
    widthCss === null ? "" : ` style="width:${widthCss}px;height:auto"`;
  return `
  <tr>
    <td class="cap">${esc(label)}<br><span class="v">Variant X</span></td>
    <td><img src="${pathToFileURL(urlX).href}"${style}></td>
    <td><img src="${pathToFileURL(urlY).href}"${style}></td>
    <td class="cap"><span class="v">Variant Y</span><br>${esc(label)}</td>
  </tr>`;
}

const sheetCss = `
  body { margin: 16px; font: 14px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p.note { margin: 0 0 14px; color: #555; max-width: 1100px; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  table { border-collapse: collapse; }
  td { border: 1px solid #bbb; padding: 4px; vertical-align: top; }
  td.cap { width: 130px; font-size: 13px; background: #f5f5f5; }
  .v { font-weight: 600; }
  img { display: block; border: 1px solid #ddd; }
`;

// ── Macro sheet (scaled overview; raw PNGs authoritative) ──
{
  const desktop = macroRows("1440x900");
  const narrow = macroRows("1100x800");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D2 A/B — macro contact sheet (blind)</h1>
  <p class="note">Chinese-language exam/LMS admin + candidate surfaces. Same build, seed, routes,
  user, browser, DPR=1, zoom 100%, light theme, HarmonyOS Sans SC; ONLY the D2 variable
  (body / control text size) differs between the two variants of each pair. Images are
  scaled for overview — the raw per-surface PNGs in D2/macro/ are authoritative.</p>
  <h2>1440 × 900</h2>
  <table>${desktop.map((r) => pairHtml(r.x, r.y, SURFACE_LABELS[r.surface], 690)).join("")}</table>
  ${narrow.length ? `<h2>1100 × 800</h2><table>${narrow.map((r) => pairHtml(r.x, r.y, SURFACE_LABELS[r.surface], 520)).join("")}</table>` : ""}
  </body></html>`;
  mkdirSync(dirname(macroOut), { recursive: true });
  const htmlPath = `${macroOut}.html`;
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: macroOut, fullPage: true });
  await browser.close();
  process.stdout.write(`macro sheet -> ${macroOut}\n`);
}

// ── Micro sheet (native pixels, unscaled) ──
{
  const groups = microRows();
  const MICRO_LABELS = {
    "m1-table": "M1 — dense table body (header + rows + tag cells)",
    "m2-form": "M2 — form controls (label / input / button)",
    "m3-sidebar": "M3a — sidebar navigation items",
    "m3-heading": "M3b — page heading + body/secondary copy",
    "m4-runtime": "M4 — candidate runtime (stem / options / controls)",
  };
  const rows = groups.map(([key, pair]) =>
    pairHtml(pair.x, pair.y, MICRO_LABELS[key] ?? key, null),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D2 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled crops stored 1:1 from the browser framebuffer (DPR=1). Judge these
  pairs at native resolution; do not rely on the scaled macro sheet for glyph-level judgement.</p>
  <table>${rows.join("")}</table>
  </body></html>`;
  mkdirSync(dirname(microOut), { recursive: true });
  const htmlPath = `${microOut}.html`;
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1620, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: microOut, fullPage: true });
  await browser.close();
  process.stdout.write(`micro sheet -> ${microOut}\n`);
}
