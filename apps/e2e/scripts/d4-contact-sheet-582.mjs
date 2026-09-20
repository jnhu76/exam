/**
 * D4 blind contact-sheet builder for EXAM-582 Stage B (D4).
 *
 * Reads a d4-ab capture directory (.tmp/ui-patrol/d4-ab/<run>/) and renders
 * two reviewer-facing sheets:
 *   - macro sheet: full-viewport pairs per surface/viewport, scaled down for
 *     overview (raw PNGs remain the authoritative artifacts);
 *   - micro sheet: native-pixel header+rows crops, unscaled.
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never px values, never
 * "old/new/current/candidate". The X↔px mapping lives exclusively in
 * docs/research/exam-582-d4-visual-ab-1/validity/variant-map.json, which is
 * NOT part of the judge bundle.
 *
 * Usage:
 *   node scripts/d4-contact-sheet-582.mjs <captureRoot> <macroOut.png> <microOut.png>
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, macroOut, microOut] = process.argv.slice(2);
if (!captureRoot || !macroOut || !microOut) {
  process.stderr.write(
    "usage: d4-contact-sheet-582.mjs <captureRoot> <macroOut.png> <microOut.png>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D4", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D4", "micro");
const SURFACE_ORDER = ["exam-list", "questions", "audit-logs", "users"];
const SURFACE_LABELS = {
  "exam-list": "Exam list (dense table)",
  questions: "Question management (dense table + tags)",
  "audit-logs": "Audit logs (dense diagnostic table)",
  users: "Users (dense table + role badges + actions)",
};
const VIEWPORTS = [
  { name: "1440x900", label: "1440 × 900", macroWidth: 690 },
  { name: "1100x800", label: "1100 × 800", macroWidth: 520 },
  {
    name: "1023x800",
    label: "1023 × 800 (boundary, sidebar out of flow)",
    macroWidth: 490,
  },
];

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
    const m = f.match(/^([a-z-]+)-(X|Y)-(\d+x\d+)\.png$/);
    if (!m) continue;
    const key = `${m[3]}:${m[1]}`;
    groups.set(key, {
      surface: m[1],
      viewport: m[3],
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

const SHEET_NOTE = `Chinese-language exam/LMS admin surfaces with dense governed tables.
Same build, seed, routes, user, browser, DPR=1, zoom 100%, light theme, HarmonyOS Sans SC.
The single variable is the TABLE-HEADER font size; the body/control text baseline is frozen
upstream and identical in both arms, header line-height and weight are fixed. Images are
scaled for overview — the raw per-surface PNGs in D4/macro/ are authoritative.`;

// ── Macro sheet (scaled overview; raw PNGs authoritative) ──
{
  const sections = VIEWPORTS.map((vp) => {
    const rows = macroRows(vp.name);
    if (!rows.length) return "";
    return `<h2>${vp.label}</h2><table>${rows
      .map((r) => pairHtml(r.x, r.y, SURFACE_LABELS[r.surface], vp.macroWidth))
      .join("")}</table>`;
  }).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D4 A/B — macro contact sheet (blind)</h1>
  <p class="note">${SHEET_NOTE}</p>
  ${sections}
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

// ── Micro sheet (native pixels, unscaled — authoritative for glyph judgement) ──
{
  const groups = microRows();
  const rows = groups.map(([key, pair]) =>
    pairHtml(
      pair.x,
      pair.y,
      `${SURFACE_LABELS[pair.surface] ?? pair.surface} — header band + 3 body rows (${pair.viewport})`,
      null,
    ),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D4 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled header+rows crops stored 1:1 from the browser framebuffer (DPR=1).
  Judge these pairs at native resolution; do not rely on the scaled macro sheet for glyph-level
  judgement. ${SHEET_NOTE}</p>
  <table>${rows.join("")}</table>
  </body></html>`;
  mkdirSync(dirname(microOut), { recursive: true });
  const htmlPath = `${microOut}.html`;
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1700, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: microOut, fullPage: true });
  await browser.close();
  process.stdout.write(`micro sheet -> ${microOut}\n`);
}
