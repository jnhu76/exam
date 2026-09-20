/**
 * D3 blind contact-sheet builder for EXAM-582 Stage B (D3).
 *
 * Reads a d3-ab capture directory (.tmp/ui-patrol/d3-ab/<run>/) and renders
 * reviewer-facing sheets:
 *   - macro sheet: full-viewport pairs for every judged surface per viewport
 *     (scaled overview; the raw PNGs remain the authoritative artifacts);
 *   - micro sheet: native-pixel crops (form bands, dialog wholes, footer
 *     bands, state contexts), unscaled — authoritative for corner judgement;
 *   - per-pair micro sheets: one file per evidence grouping (exam form,
 *     course form, dialog forms, destructive confirm, states, toolbar
 *     context) stacking its native crops.
 *
 * Labels carry ONLY "Variant X" / "Variant Y" — never radius values, never
 * "more/less rounded", never "current/candidate". The X↔radius mapping lives
 * exclusively in
 * docs/research/exam-582-d3-visual-ab-1/validity/variant-map.json, which is
 * NOT part of the judge bundle.
 *
 * Usage:
 *   node scripts/d3-contact-sheet-582.mjs <captureRoot> <outJudgeDir>
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [captureRoot, judgeDir] = process.argv.slice(2);
if (!captureRoot || !judgeDir) {
  process.stderr.write(
    "usage: d3-contact-sheet-582.mjs <captureRoot> <outJudgeDir>\n",
  );
  process.exit(2);
}

const MACRO_DIR = join(captureRoot, "artifacts", "D3", "macro");
const MICRO_DIR = join(captureRoot, "artifacts", "D3", "micro");

const MACRO_ROWS = [
  {
    file: "exam-create",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Exam wizard — dense admin form (primary)",
    width: 700,
  },
  {
    file: "course-dialog",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Course dialog — input + textarea form",
    width: 700,
  },
  {
    file: "users-dialog",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "User dialog — input + select form",
    width: 700,
  },
  {
    file: "exam-detail-confirm",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Exam detail — destructive confirmation",
    width: 700,
  },
  {
    file: "course",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Course workbench — toolbar + table context",
    width: 700,
  },
  {
    file: "users",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "User workbench — table + badges context",
    width: 700,
  },
  {
    file: "exam-detail",
    vp: "1440x900",
    vpLabel: "1440 × 900",
    label: "Exam detail — page context",
    width: 700,
  },
  {
    file: "exam-create",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "Exam wizard — dense admin form (narrow)",
    width: 530,
  },
  {
    file: "course-dialog",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "Course dialog — input + textarea form (narrow)",
    width: 530,
  },
  {
    file: "users-dialog",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "User dialog — input + select form (narrow)",
    width: 530,
  },
  {
    file: "exam-detail-confirm",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "Exam detail — destructive confirmation (narrow)",
    width: 530,
  },
  {
    file: "course",
    vp: "1100x800",
    vpLabel: "1100 × 800",
    label: "Course workbench — toolbar + table context (narrow)",
    width: 530,
  },
];

/** Per-pair groupings (§14 control pairs + §22 states). Each entry lists the
 * native crops that belong together; files are
 * `<surface>-<crop>-<X|Y>-<vp>.png`. */
const MICRO_GROUPS = [
  {
    name: "exam-form",
    label:
      "Exam wizard form — input + select fields band, then the outline-cancel + primary-next footer row",
    crops: [
      ["exam-create", "form-band", ["1440x900", "1100x800"]],
      ["exam-create", "footer-band", ["1440x900", "1100x800"]],
    ],
  },
  {
    name: "course-form",
    label:
      "Course dialog form — name + code inputs, then textarea directly above the cancel/save footer",
    crops: [
      ["course", "fields-band", ["1440x900", "1100x800"]],
      ["course", "textarea-footer-band", ["1440x900", "1100x800"]],
    ],
  },
  {
    name: "dialog-forms",
    label:
      "Dialog forms — whole course dialog (input + textarea), whole user dialog (inputs + select), user dialog select + footer band",
    crops: [
      ["course-dialog", "whole", ["1440x900", "1100x800"]],
      ["users-dialog", "whole", ["1440x900", "1100x800"]],
      ["users", "select-footer-band", ["1440x900", "1100x800"]],
    ],
  },
  {
    name: "destructive",
    label:
      "Destructive confirmation — whole confirm dialog, then the destructive + cancel footer row",
    crops: [
      ["exam-detail-confirm", "whole", ["1440x900", "1100x800"]],
      ["exam-detail-confirm", "footer-band", ["1440x900", "1100x800"]],
    ],
  },
  {
    name: "states",
    label:
      "Interaction states — focused input (wizard), focused input (dialog), invalid input, product-disabled stepper step, disabled save button, focused select trigger",
    crops: [
      ["exam-create", "focus-input", ["1440x900", "1100x800"]],
      ["course", "focus-input", ["1440x900", "1100x800"]],
      ["course", "invalid-input", ["1440x900", "1100x800"]],
      ["exam-create", "disabled-stepper", ["1440x900", "1100x800"]],
      ["course", "disabled-button", ["1440x900", "1100x800"]],
      ["users", "focus-select", ["1440x900", "1100x800"]],
    ],
  },
  {
    name: "toolbar-context",
    label:
      "Quiet toolbar (context only, NOT primary evidence) — standalone search input inside the toolbar band",
    crops: [["course", "toolbar-band", ["1440x900", "1100x800"]]],
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

const SHEET_NOTE = `Chinese-language exam/LMS admin product; admin forms, dialogs and a destructive
confirmation. Same build, seed, routes, form data, user, browser, DPR=1, zoom 100%, light theme,
HarmonyOS Sans SC. Body/control typography (15px), table-header typography (13px/20px/500), status-badge
geometry (22px), tag weight (500) and dialog/sheet surface geometry are frozen upstream and identical in
both arms; control height, padding, border, background, font, icons, focus treatment, disabled treatment
and layout are the product's, unchanged. The single decision dimension is the PRIMARY CONTROL FAMILY
cornerRadius (inputs, selects, textareas and standalone buttons judged as ONE family). Images are scaled
for overview in the macro sheet only — the raw per-pair PNGs are authoritative, and the micro sheets are
native pixels.`;

async function renderSheet(outPath, html, viewportWidth) {
  const htmlPath = `${outPath}.html`;
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  process.stdout.write(`sheet -> ${outPath}\n`);
}

// ── Macro sheet (scaled overview; raw PNGs authoritative) ──
{
  const macroFiles = listFiles(MACRO_DIR);
  const sections = MACRO_ROWS.map((row) => {
    const x = macroFiles.find((f) => f === `${row.file}-X-${row.vp}.png`);
    const y = macroFiles.find((f) => f === `${row.file}-Y-${row.vp}.png`);
    if (!x || !y) {
      process.stderr.write(`MISSING macro: ${row.file} ${row.vp}\n`);
      return "";
    }
    return `<h2>${row.vpLabel}</h2><table>${pairHtml(
      join(MACRO_DIR, x),
      join(MACRO_DIR, y),
      row.label,
      row.width,
    )}</table>`;
  }).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D3 A/B — macro contact sheet (blind)</h1>
  <p class="note">${SHEET_NOTE}</p>
  ${sections}
  </body></html>`;
  const macroOut = join(judgeDir, "macro-contact-sheet.png");
  mkdirSync(dirname(macroOut), { recursive: true });
  await renderSheet(macroOut, html, 1500);
}

// ── Micro sheet (native pixels, unscaled — authoritative for corners) ──
{
  const microFiles = listFiles(MICRO_DIR);
  const find = (surface, crop, letter, vp) =>
    microFiles.find((f) => f === `${surface}-${crop}-${letter}-${vp}.png`);
  const rows = [];
  for (const group of MICRO_GROUPS) {
    for (const [surface, crop, vps] of group.crops) {
      for (const vp of vps) {
        const x = find(surface, crop, "X", vp);
        const y = find(surface, crop, "Y", vp);
        if (x && y) {
          rows.push(
            pairHtml(
              join(MICRO_DIR, x),
              join(MICRO_DIR, y),
              `${group.label} (${vp})`,
              null,
            ),
          );
        } else {
          process.stderr.write(`MISSING micro: ${surface}-${crop} ${vp}\n`);
        }
      }
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
  </style></head><body>
  <h1>D3 A/B — micro contact sheet (blind, native pixels)</h1>
  <p class="note">Unscaled crops stored 1:1 from the browser framebuffer (DPR=1).
  Judge these pairs at native resolution; do not rely on the scaled macro sheet for corner-level
  judgement. ${SHEET_NOTE}</p>
  <table>${rows.join("")}</table>
  </body></html>`;
  const microOut = join(judgeDir, "micro-contact-sheet.png");
  mkdirSync(dirname(microOut), { recursive: true });
  await renderSheet(microOut, html, 1750);
}

// ── Per-group micro sheets (readability) ──
{
  const microFiles = listFiles(MICRO_DIR);
  const find = (surface, crop, letter, vp) =>
    microFiles.find((f) => f === `${surface}-${crop}-${letter}-${vp}.png`);
  mkdirSync(join(judgeDir, "micro"), { recursive: true });
  for (const group of MICRO_GROUPS) {
    const sections = [];
    for (const [surface, crop, vps] of group.crops) {
      for (const vp of vps) {
        const x = find(surface, crop, "X", vp);
        const y = find(surface, crop, "Y", vp);
        if (x && y) {
          sections.push(
            pairHtml(join(MICRO_DIR, x), join(MICRO_DIR, y), `${vp}`, null),
          );
        }
      }
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${sheetCss}
    </style></head><body>
    <h1>D3 A/B — ${esc(group.label)} (blind, native pixels)</h1>
    <p class="note">Unscaled crops, DPR=1. ${SHEET_NOTE}</p>
    <table>${sections.join("\n")}</table>
    </body></html>`;
    const out = join(judgeDir, "micro", `${group.name}-pair.png`);
    await renderSheet(out, html, 1750);
  }
}
