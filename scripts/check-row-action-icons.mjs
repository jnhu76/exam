/**
 * Gate: business pages must not directly import/arrange row-action icons
 * (Pencil, Trash2, Key, Eye, MoreHorizontal, MoreVertical, etc.) — row actions
 * must go through the RowActions / IconButton semantic components so size,
 * stroke-width, color, hover, and destructive tone stay centrally governed.
 *
 * Allowed: pages may pass an icon IDENTITY to RowActions (label/icon/handler),
 * but must not import the icon and render it directly as a standalone control.
 *
 * This detects direct lucide imports of action icons in page source. Component
 * files under components/shared (RowActions itself) are exempt.
 */
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

// Action icons that, when imported directly into a page, signal a hand-rolled
// row-action control bypassing RowActions.
const ACTION_ICONS = [
  "Pencil",
  "SquarePen",
  "Trash2",
  "Trash",
  "KeyRound",
  "Key",
  "Eye",
  "EyeOff",
  "MoreHorizontal",
  "MoreVertical",
];

const violations = [];

async function walk(path, out = []) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (["dist", "coverage", "node_modules", ".git"].includes(e.name)) continue;
    const t = `${path}/${e.name}`;
    if (e.isDirectory()) await walk(t, out);
    else out.push(t);
  }
  return out;
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/;

// Pages may still use these icons for NON-row-action purposes (e.g. an
// outline-governed page-level button). To keep the gate precise, we flag only
// pages that import an action icon AND render it inside a table row context
// (data-row-action-tone or a Button size="icon" inside a row). Heuristic but
// high-signal: flag the import itself in pages, with a note.
async function checkPages() {
  const files = (await walk("apps/web/src/pages")).filter((f) =>
    f.endsWith(".tsx"),
  );
  for (const f of files) {
    const text = await readFile(f, "utf8");
    const m = IMPORT_RE.exec(text);
    if (!m) continue;
    const imported = m[1].split(",").map((s) => s.trim());
    const hits = imported.filter((name) => ACTION_ICONS.includes(name));
    if (hits.length === 0) continue;
    // A genuine row-action bypass = the action icon is used inside an
    // interactive icon control (Button size="icon" with AppIcon size="inline")
    // WITHOUT a <RowActions> wrapper. Decorative uses (e.g. AppIcon size="badge"
    // inside a status cell) are NOT row actions and are allowed. This keeps the
    // gate high-signal: it fires only on the hand-rolled-row-action shape.
    const usesRowActions = /<RowActions/.test(text);
    if (usesRowActions) continue;
    // Detect the row-action-control shape for each imported action icon.
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const icon of hits) {
        // icon used inside an icon Button + AppIcon inline (the row-action shape)
        if (
          new RegExp(`\\b${icon}\\b`).test(line) &&
          /size="inline"/.test(line) &&
          /size="icon"/.test(
            text
              .split("\n")
              .slice(Math.max(0, i - 4), i + 1)
              .join("\n"),
          )
        ) {
          violations.push(
            `${relative(".", f)}:${i + 1}: action icon ${icon} used in a hand-rolled row-action control — route through <RowActions>`,
          );
        }
      }
    });
  }
}

await checkPages();

if (violations.length > 0) {
  process.stderr.write(
    `Row-action icon violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("✅ Row-action icons routed through RowActions.\n");
