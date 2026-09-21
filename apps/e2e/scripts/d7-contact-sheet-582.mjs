/**
 * D7 blind contact-sheet builder for EXAM-582 Stage B (D7).
 *
 * Reads a d7-ab capture directory (.tmp/ui-patrol/d7-ab/<run>/) and renders
 * reviewer-facing sheets:
 *   - macro sheet: full-viewport pairs per surface/viewport, scaled down for
 *     overview (raw PNGs remain the authoritative artifacts). Macro captures
 *     ALWAYS include the page behind the modal/sheet — the D7 question is
 *     relational.
 *   - micro sheet: native-pixel crops, unscaled — modal/panel edges with
 *     underlying page context, interior bands, the destructive confirm whole,
 *     the sheet panel edge, and the small-overlay control reference.
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never the background tier,
 * never "old/new", never which arm is which. The X↔tier mapping lives
 * exclusively in
 * docs/research/exam-582-d7-visual-ab-1/validity/variant-map.json, which is
 * NOT part of the judge bundle.
 *
 * Usage:
 *   node scripts/d7-contact-sheet-582.mjs <captureRoot> <outJudgeDir>
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, judgeDir] = process.argv.slice(2);
if (!captureRoot || !judgeDir) {
  process.stderr.write(
    "usage: d7-contact-sheet-582.mjs <captureRoot> <outJudgeDir>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D7", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D7", "micro");
const SURFACE_ORDER = [
  "course-dialog",
  "users-dialog",
  "exam-detail-confirm",
  "import-dialog",
  "sheet-nav",
];
const SURFACE_LABELS = {
  "course-dialog": "Create-form dialog over a card-table page",
  "users-dialog": "Create-form dialog over a card-table page (second sample)",
  "exam-detail-confirm": "Destructive confirmation over a sectioned page",
  "import-dialog": "Large import-wizard dialog over an admin page",
  "sheet-nav": "Navigation drawer (edge-attached) over a card page",
};
const CROP_LABELS = {
  edge: "modal edge + page context on all sides",
  interior: "modal interior band: form + footer",
  select: "small-overlay control reference (popover over the modal)",
  context: "confirmation + page context on all sides",
  whole: "confirmation, whole modal",
  "sheet-edge": "drawer edge + underlying page",
};
const VIEWPORTS = [
  { name: "1440x900", label: "1440 × 900", macroWidth: 690 },
  { name: "1100x800", label: "1100 × 800", macroWidth: 520 },
  {
    name: "1023x800",
    label: "1023 × 800 (below-lg: navigation drawer)",
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

/** surface -> viewport -> {x, y} for each micro crop kind */
function microGroups() {
  const files = listFiles(MICRO_DIR);
  const groups = new Map();
  for (const f of files) {
    const m = f.match(/^([a-z-]+?)-([a-z]+)-(X|Y)-(\d+x\d+)\.png$/);
    if (!m) continue;
    const key = `${m[1]}:${m[4]}:${m[2]}`;
    if (!groups.has(key)) {
      groups.set(key, { surface: m[1], viewport: m[4], kind: m[2] });
    }
    groups.get(key)[m[3].toLowerCase()] = join(MICRO_DIR, f);
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
  td.cap { width: 170px; font-size: 13px; background: #f5f5f5; }
  .v { font-weight: 600; }
  img { display: block; border: 1px solid #ddd; }
`;

const SHEET_NOTE = `Chinese-language exam/LMS admin pages with dense forms, tables and cards.
Same build, seed, routes, user, browser, DPR=1, zoom 100%, light theme, HarmonyOS Sans SC.
Typography, controls, badges, borders, radii, shadows, the overlay dimming and the layout are
frozen upstream decisions or product values, identical in both arms. The single variable is the
large modal/drawer background color. Every macro capture keeps the page behind the modal/drawer
visible — the judgement is relational. Images are scaled for overview in the macro sheet only;
the raw per-surface PNGs are authoritative, and the micro sheets are native pixels.`;

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
  <h1>D7 A/B — macro contact sheet (blind)</h1>
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

// ── Micro sheet (native pixels, unscaled — authoritative for edge/boundary
// judgement) ──
{
  const groups = [...microGroups().values()];
  const orderOf = (g) => {
    const s = SURFACE_ORDER.indexOf(g.surface);
    return `${s < 0 ? 9 : s}:${g.viewport}:${Object.keys(CROP_LABELS).indexOf(g.kind)}`;
  };
  groups.sort((a, b) => orderOf(a).localeCompare(orderOf(b)));
  const rows = groups
    .map((g) => {
      if (!g.x || !g.y) return "";
      const surface = SURFACE_LABELS[g.surface] ?? g.surface;
      const kind =
        g.surface === "sheet-nav" && g.kind === "edge"
          ? "drawer edge + underlying page"
          : (CROP_LABELS[g.kind] ?? g.kind);
      return pairHtml(g.x, g.y, `${surface} — ${kind} (${g.viewport})`, null);
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D7 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled crops stored 1:1 from the browser framebuffer (DPR=1).
  Judge these pairs at native resolution; do not rely on the scaled macro sheet for edge-level
  judgement. Every crop keeps enough of the page behind the modal/drawer to judge the
  relationship between the large overlay and the page it floats over. ${SHEET_NOTE}</p>
  <table>${rows}</table>
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
