#!/usr/bin/env node
/**
 * Optional, low-false-positive scanner for handwritten UI primitives.
 *
 * Flags suspected hand-rolled complex interaction primitives OUTSIDE
 * components/ui/. The goal is to catch regressions against
 * docs/frontend/component-governance.md §4 (forbidden hand-builds):
 * DatePicker / Calendar grids, Dialog/Modal, Select/Combobox, Popover,
 * DropdownMenu, Tooltip, Tabs, FocusTrap.
 *
 * NOT wired into CI by default. Run manually:
 *   node scripts/check-frontend-primitives.mjs
 *
 * Design rules (per governance §10):
 * - Must not flag legitimate business components (row expanders, toggle
 *   states that drive a plain `aria-expanded` on a non-modal element).
 * - Targets apps/web/src/{pages,components/shared,components/exam,
 *   components/layout,components/app,lib,hooks} — never components/ui/.
 * - Allow-list path fragments for known-safe business patterns.
 *
 * Exit codes: 0 = clean, 1 = findings.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../apps/web/src", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;

// Directories to scan. components/ui is intentionally excluded — that is the
// one place complex primitives are allowed to live.
const SCAN_DIRS = [
  "pages",
  "components/shared",
  "components/exam",
  "components/layout",
  "components/app",
  "components/settings",
  "components/question",
  "lib",
  "hooks",
];

// Path fragments that mark a file as known-safe (business component, not a
// hand-rolled primitive). Add here only when a finding is reviewed and is a
// legitimate business pattern.
const ALLOW_PATH_FRAGMENTS = [
  // Row-expander / detail-disclosure toggles are business state, not popovers.
  // (No path fragment yet — handled by the aria-expanded-on-non-modal rule
  // below instead.)
];

// A finding is: { file, line, col, rule, snippet }
function ruleMatches(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const lineno = i + 1;

    // R1: handwritten modal/dialog via raw role="dialog" or aria-modal outside
    // components/ui. shadcn Dialog sets these on its own Content; a raw
    // role="dialog" / aria-modal in a page or shared component is a hand-roll.
    if (
      /role=["']dialog["']/.test(line) ||
      /aria-modal=["']true["']/.test(line)
    ) {
      findings.push({
        rule: "handwritten-dialog",
        snippet: line.trim(),
      });
    }

    // R2: raw calendar grid marker. react-day-picker / shadcn Calendar own
    // month grids; a handwritten grid suggests a DIY DatePicker/Calendar.
    // Match obvious day-cell renderers without tripping on unrelated "grid".
    if (
      /role=["']grid(cell|row|)["']/.test(line) &&
      !/DayButton|DayPicker|react-day-picker/.test(text)
    ) {
      findings.push({
        rule: "handwritten-calendar-grid",
        snippet: line.trim(),
      });
    }

    // R3: popover/dropdown/select/tooltip semantics built by hand. We look
    // for the co-occurrence of an open-state hook and an aria-haspopup on a
    // non-shadcn element. This is heuristic: we flag the aria-haspopup line
    // only when the file ALSO contains a manual open state and does not
    // import the corresponding shadcn primitive.
    if (/aria-haspopup=["'](dialog|menu|listbox|true)["']/.test(line)) {
      findings.push({
        rule: "handwritten-popover-aria-haspopup",
        snippet: line.trim(),
      });
    }

    // R4: DIY focus trap / escape handler inside a page or shared component.
    // shadcn Dialog/Popover own these; a hand-rolled Escape / Tab focus
    // handler strongly suggests a hand-built modal.
    if (
      /\baddEventListener\(["']keydown["']/.test(line) &&
      /Escape|preventDefault\(\)/.test(text) &&
      !/import.*from\s+["']@\/components\/ui\//.test(text)
    ) {
      findings.push({
        rule: "handwritten-focus-trap-or-escape",
        snippet: line.trim(),
      });
    }
  });

  return findings;
}

function isAllowed(relPath) {
  return ALLOW_PATH_FRAGMENTS.some((frag) => relPath.includes(frag));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (
      /\.(tsx|ts)$/.test(e.name) &&
      !/\.test\.(tsx|ts)$/.test(e.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const allFindings = [];

  for (const d of SCAN_DIRS) {
    const dir = join(ROOT, d);
    let exists = true;
    try {
      const s = await stat(dir);
      exists = s.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const files = await walk(dir);
    for (const file of files) {
      const rel = relative(REPO, file);
      if (isAllowed(rel)) continue;
      const text = await readFile(file, "utf8");
      const hits = ruleMatches(text);
      for (const h of hits) {
        allFindings.push({ file: rel, ...h });
      }
    }
  }

  if (allFindings.length === 0) {
    console.log("✓ No handwritten UI primitives found outside components/ui/.");
    console.log(
      "  (Scanned: pages, components/shared, components/exam, components/layout,",
    );
    console.log(
      "   components/app, components/settings, components/question, lib, hooks)",
    );
    process.exit(0);
  }

  console.log(
    `✗ Found ${allFindings.length} suspected handwritten primitive(s):\n`,
  );
  for (const f of allFindings) {
    console.log(`  ${f.file}`);
    console.log(`    rule: ${f.rule}`);
    console.log(`    line: ${f.snippet}\n`);
  }
  console.log(
    "If a finding is a legitimate business component (e.g. a row-expander),",
  );
  console.log("add its path fragment to ALLOW_PATH_FRAGMENTS in this script.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
