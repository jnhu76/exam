/**
 * D5 blind contact-sheet builder for EXAM-582 Stage B (D5).
 *
 * Reads a d5-ab capture directory (.tmp/ui-patrol/d5-ab/<run>/) and renders
 * reviewer-facing sheets:
 *   - macro sheet: full-viewport pairs per surface/viewport, scaled down for
 *     overview (raw PNGs remain the authoritative artifacts);
 *   - micro sheet: native-pixel table crops AND tight badge-context crops,
 *     unscaled;
 *   - per-surface micro pair sheets: one file per surface with its native
 *     standard + tight crops stacked (readable evidence over one-sheet
 *     convenience — the badge is small, so per-surface sheets keep it
 *     inspectable).
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never px values, never
 * "old/new/current/candidate", never which arm is taller. The X↔px mapping
 * lives exclusively in
 * docs/research/exam-582-d5-visual-ab-1/validity/variant-map.json, which is
 * NOT part of the judge bundle.
 *
 * Usage:
 *   node scripts/d5-contact-sheet-582.mjs <captureRoot> <outJudgeDir>
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, judgeDir] = process.argv.slice(2);
if (!captureRoot || !judgeDir) {
  process.stderr.write(
    "usage: d5-contact-sheet-582.mjs <captureRoot> <outJudgeDir>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D5", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D5", "micro");
const SURFACE_ORDER = [
  "exam-list",
  "grading-queue",
  "recovery-queue",
  "users",
  "scores",
];
const SURFACE_LABELS = {
  "exam-list": "Exam list (dense table, lifecycle statuses)",
  "grading-queue": "Grading queue (dense table, grading statuses)",
  "recovery-queue":
    "Recovery queue (dense diagnostic table, icon-bearing + text-only statuses)",
  users: "Users (dense table, account statuses)",
  scores: "Scores (dense table, pass/fail statuses)",
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

/** surface -> viewport -> {x, y, xTight, yTight} */
function microGroups() {
  const files = listFiles(MICRO_DIR);
  const groups = new Map();
  for (const f of files) {
    const m = f.match(/^([a-z-]+?)(-tight)?-(X|Y)-(\d+x\d+)\.png$/);
    if (!m) continue;
    const key = `${m[1]}:${m[4]}`;
    if (!groups.has(key)) {
      groups.set(key, { surface: m[1], viewport: m[4] });
    }
    const g = groups.get(key);
    if (m[2]) {
      g[m[3].toLowerCase() + "Tight"] = join(MICRO_DIR, f);
    } else {
      g[m[3].toLowerCase()] = join(MICRO_DIR, f);
    }
  }
  return groups;
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
  td.cap { width: 150px; font-size: 13px; background: #f5f5f5; }
  .v { font-weight: 600; }
  img { display: block; border: 1px solid #ddd; }
`;

const SHEET_NOTE = `Chinese-language exam/LMS admin surfaces with dense governed tables.
Same build, seed, routes, user, browser, DPR=1, zoom 100%, light theme, HarmonyOS Sans SC.
Body/control typography and table-header typography are frozen upstream and identical in both arms;
StatusBadge typography, padding, gap, radius, border, colors and icon policy are the product's, unchanged.
The single variable is the STATUS BADGE physical height. Images are scaled for overview in the macro
sheet only — the raw per-surface PNGs are authoritative, and the micro sheets are native pixels.`;

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
  <h1>D5 A/B — macro contact sheet (blind)</h1>
  <p class="note">${SHEET_NOTE}</p>
  ${sections}
  </body></html>`;
  const macroOut = join(judgeDir, "macro-contact-sheet.png");
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
  const groups = [...microGroups().entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rows = groups
    .map(([key, g]) => {
      if (!g.x || !g.y) return "";
      const label = `${SURFACE_LABELS[g.surface] ?? g.surface} — header band + 3 body rows (${g.viewport})`;
      return pairHtml(g.x, g.y, label, null);
    })
    .join("");
  const tightRows = groups
    .map(([key, g]) => {
      if (!g.xTight || !g.yTight) return "";
      const label = `${SURFACE_LABELS[g.surface] ?? g.surface} — badge + adjacent columns, tight context (${g.viewport})`;
      return pairHtml(g.xTight, g.yTight, label, null);
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D5 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled crops stored 1:1 from the browser framebuffer (DPR=1).
  Judge these pairs at native resolution; do not rely on the scaled macro sheet for glyph-level
  judgement. ${SHEET_NOTE}</p>
  <h2>Table context: header band + 3 body rows</h2>
  <table>${rows}</table>
  <h2>Tight context: body text | status badge | adjacent column</h2>
  <table>${tightRows}</table>
  </body></html>`;
  const microOut = join(judgeDir, "micro-contact-sheet.png");
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

// ── Per-surface micro pair sheets (§22 readability) ──
{
  const groups = microGroups();
  const perSurface = new Map();
  for (const [, g] of groups) {
    if (!perSurface.has(g.surface)) perSurface.set(g.surface, []);
    perSurface.get(g.surface).push(g);
  }
  mkdirSync(join(judgeDir, "micro"), { recursive: true });
  for (const [surface, entries] of perSurface) {
    entries.sort((a, b) => a.viewport.localeCompare(b.viewport));
    const sections = entries
      .map((g) => {
        let html = "";
        if (g.x && g.y) {
          html += `<h2>${g.viewport} — header band + 3 body rows</h2><table>${pairHtml(g.x, g.y, SURFACE_LABELS[surface] ?? surface, null)}</table>`;
        }
        if (g.xTight && g.yTight) {
          html += `<h2>${g.viewport} — badge + adjacent columns, tight context</h2><table>${pairHtml(g.xTight, g.yTight, SURFACE_LABELS[surface] ?? surface, null)}</table>`;
        }
        return html;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
    </style></head><body>
    <h1>D5 A/B — ${esc(SURFACE_LABELS[surface] ?? surface)} (blind, native pixels)</h1>
    <p class="note">Unscaled crops, DPR=1. ${SHEET_NOTE}</p>
    ${sections}
    </body></html>`;
    const out = join(judgeDir, "micro", `${surface}-pair.png`);
    const htmlPath = `${out}.html`;
    writeFileSync(htmlPath, html);
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1700, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    process.stdout.write(`per-surface sheet -> ${out}\n`);
  }
}
