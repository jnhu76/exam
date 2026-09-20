/**
 * D6 blind contact-sheet builder for EXAM-582 Stage B (D6).
 *
 * Reads a d6-ab capture directory (.tmp/ui-patrol/d6-ab/<run>/) and renders
 * reviewer-facing sheets:
 *   - macro sheet: full-viewport question-management pairs per viewport
 *     (scaled overview; the raw PNGs remain the authoritative artifacts),
 *     including the 1023 card-context pairs as a clearly separated section;
 *   - micro sheet: native-pixel band crops (header + fixture rows) AND tight
 *     badge-context crops, unscaled;
 *   - per-pair micro sheets (§26): one file per evidence pair (short-cjk,
 *     medium-cjk, cluster-3, cluster-overflow, dense-rows) stacking its
 *     native standard + tight crops.
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never weight values, never
 * "old/new/current/candidate/heavier", never which arm is bolder. The
 * X↔weight mapping lives exclusively in
 * docs/research/exam-582-d6-visual-ab-1/validity/variant-map.json, which is
 * NOT part of the judge bundle.
 *
 * Usage:
 *   node scripts/d6-contact-sheet-582.mjs <captureRoot> <outJudgeDir>
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, judgeDir] = process.argv.slice(2);
if (!captureRoot || !judgeDir) {
  process.stderr.write(
    "usage: d6-contact-sheet-582.mjs <captureRoot> <outJudgeDir>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D6", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D6", "micro");

const MACRO_ROWS = [
  {
    file: "questions",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Question Management — dense table (primary)",
    width: 700,
  },
  {
    file: "questions",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "Question Management — dense table (narrow)",
    width: 530,
  },
  {
    file: "questions-card",
    vp: "1023x800",
    vpLabel: "1023 × 800",
    label:
      "Question Management — responsive card context (NOT dense-table evidence)",
    width: 490,
  },
];

const MICRO_PAIRS = [
  {
    name: "short-cjk",
    label:
      "Single short Chinese tag — header band + first body row (13px header / 15px body / 12px tag)",
  },
  {
    name: "medium-cjk",
    label:
      "Single medium Chinese tag — header band + first two body rows (native pixels)",
  },
  {
    name: "cluster-3",
    label:
      "Three-tag cluster (Chinese + Chinese + Latin) — header band + first five rows",
  },
  {
    name: "cluster-overflow",
    label:
      "4–6-tag rows with the +N overflow indicator — three dense rows together",
  },
  {
    name: "dense-rows",
    label:
      "All eight evidence rows — repeated tags across rows (visual-noise context)",
  },
];

function listFiles(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
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

const SHEET_NOTE = `Chinese-language exam/LMS admin product; Question Management workbench with a dense
question table and 12px metadata tag chips. Same build, seed, routes, filtered row set, user, browser,
DPR=1, zoom 100%, light theme, HarmonyOS Sans SC. Body/control typography, table-header typography and
status-badge geometry are frozen upstream and identical in both arms; tag size, height, radius, padding,
colors and the +N overflow chip are the product's, unchanged. The single decision dimension is the TAG
BADGE font weight. Images are scaled for overview in the macro sheet only — the raw per-pair PNGs are
authoritative, and the micro sheets are native pixels.`;

// ── Macro sheet (scaled overview; raw PNGs authoritative) ──
{
  const macroFiles = listFiles(MACRO_DIR);
  const sections = MACRO_ROWS.map((row) => {
    const x = macroFiles.find((f) => f === `${row.file}-X-${row.vp}.png`);
    const y = macroFiles.find((f) => f === `${row.file}-Y-${row.vp}.png`);
    if (!x || !y) return "";
    return `<h2>${row.vpLabel}</h2><table>${pairHtml(
      join(MACRO_DIR, x),
      join(MACRO_DIR, y),
      row.label,
      row.width,
    )}</table>`;
  }).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D6 A/B — macro contact sheet (blind)</h1>
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
  const microFiles = listFiles(MICRO_DIR);
  const find = (name) => microFiles.find((f) => f === name);
  const standardRows = [];
  const tightRows = [];
  for (const vp of ["1440x900", "1100x800"]) {
    for (const pair of MICRO_PAIRS) {
      const x = find(`questions-${pair.name}-X-${vp}.png`);
      const y = find(`questions-${pair.name}-Y-${vp}.png`);
      if (x && y) {
        standardRows.push(
          pairHtml(
            join(MICRO_DIR, x),
            join(MICRO_DIR, y),
            `${pair.label} (${vp})`,
            null,
          ),
        );
      }
      for (const letter of ["X", "Y"]) {
        if (!find(`questions-${pair.name}-${letter}-${vp}.png`)) {
          process.stderr.write(`MISSING micro: ${pair.name} ${letter} ${vp}\n`);
        }
      }
    }
    for (const pair of MICRO_PAIRS) {
      const x = find(`questions-tight-${pair.name}-X-${vp}.png`);
      const y = find(`questions-tight-${pair.name}-Y-${vp}.png`);
      if (x && y) {
        tightRows.push(
          pairHtml(
            join(MICRO_DIR, x),
            join(MICRO_DIR, y),
            `${pair.label} — tight badge context (${vp})`,
            null,
          ),
        );
      }
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D6 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled crops stored 1:1 from the browser framebuffer (DPR=1).
  Judge these pairs at native resolution; do not rely on the scaled macro sheet for glyph-level
  judgement. ${SHEET_NOTE}</p>
  <h2>Band context: header band + evidence rows (13px header / 15px body / 12px tags)</h2>
  <table>${standardRows.join("")}</table>
  <h2>Tight context: body text | tag badges | adjacent columns</h2>
  <table>${tightRows.join("")}</table>
  </body></html>`;
  const microOut = join(judgeDir, "micro-contact-sheet.png");
  mkdirSync(dirname(microOut), { recursive: true });
  const htmlPath = `${microOut}.html`;
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1750, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: microOut, fullPage: true });
  await browser.close();
  process.stdout.write(`micro sheet -> ${microOut}\n`);
}

// ── Per-pair micro sheets (§26 readability) ──
{
  const microFiles = listFiles(MICRO_DIR);
  const find = (name) => microFiles.find((f) => f === name);
  mkdirSync(join(judgeDir, "micro"), { recursive: true });
  for (const pair of MICRO_PAIRS) {
    const sections = [];
    for (const vp of ["1440x900", "1100x800"]) {
      const x = find(`questions-${pair.name}-X-${vp}.png`);
      const y = find(`questions-${pair.name}-Y-${vp}.png`);
      if (x && y) {
        sections.push(
          `<h2>${vp} — band context</h2><table>${pairHtml(
            join(MICRO_DIR, x),
            join(MICRO_DIR, y),
            pair.label,
            null,
          )}</table>`,
        );
      }
      const tx = find(`questions-tight-${pair.name}-X-${vp}.png`);
      const ty = find(`questions-tight-${pair.name}-Y-${vp}.png`);
      if (tx && ty) {
        sections.push(
          `<h2>${vp} — tight badge context</h2><table>${pairHtml(
            join(MICRO_DIR, tx),
            join(MICRO_DIR, ty),
            pair.label,
            null,
          )}</table>`,
        );
      }
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
    </style></head><body>
    <h1>D6 A/B — ${esc(pair.label)} (blind, native pixels)</h1>
    <p class="note">Unscaled crops, DPR=1. ${SHEET_NOTE}</p>
    ${sections.join("\n")}
    </body></html>`;
    const out = join(judgeDir, "micro", `${pair.name}-pair.png`);
    const htmlPath = `${out}.html`;
    writeFileSync(htmlPath, html);
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1750, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    process.stdout.write(`per-pair sheet -> ${out}\n`);
  }
}
