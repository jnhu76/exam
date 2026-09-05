/**
 * Row-action capacity structural tests (#445 P3 §3/§4).
 *
 * Pins the typed declaration API and the count-triggered representation
 * contract at the SOURCE level (mirrors the visual-finish.test.ts style):
 *   - the actionsDensity model (prop, CSS tiers, page guesses) is gone;
 *   - every RowActions consumer uses the typed `actions` declaration API;
 *   - every admin-table action cell renders through RowActions (the
 *     embedded-picker text exception is explicit below);
 *   - PageHeader / DataToolbar / DialogFooter stay within the ≤2 inline
 *     button budget (structural only — no overflow-menu mechanism is
 *     pre-built for them, Gate G).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const tableCss = readFileSync(join(here, "recipes.css"), "utf8");

const SCAN_ROOTS = [
  join(webRoot, "pages"),
  join(webRoot, "components"),
  join(webRoot, "features"),
];

function listTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "lint") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listTsxFiles(path, out);
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(path);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((root) => listTsxFiles(root));

const BUTTON_RE =
  /<(Button|AlertDialogAction|AlertDialogCancel|DialogClose)\b/g;

function countButtons(block: string): number {
  return (block.match(BUTTON_RE) || []).length;
}

/** Opening tag of a JSX element starting at `start`, ending at the first `>`
 * at brace depth 0 (element `>` inside prop values sit at depth > 0). */
function extractOpeningTag(text: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Documented budget census (#453). Static source counts overcount status
 * branches that never render simultaneously; these files are the audited
 * pre-existing exceptions (max simultaneous buttons stays within the budget
 * on the admin pages; the exam-runtime submit dialog is outside the admin
 * vocabulary). The budget tests are decay-guards: a file OUTSIDE this
 * census that exceeds two inline buttons fails. Disposition of the
 * exceptions themselves belongs to UI-GOVERNANCE-1.
 */
const BUDGET_ALLOWLIST = {
  // exam-runtime submit dialog: conditional flush-retry / force-submit
  // recovery actions on top of the two standard actions.
  "pages/exam/TakeExamPage.tsx": "exam-runtime submit dialog (4 conditional)",
  // PageHeader actions rendered in mutually exclusive status branches
  // (draft: edit+publish / open: close / closed: publish-results…); static
  // count sums branches that never render together.
  "pages/admin/ExamDetailPage.tsx": "status-conditional PageHeader branches",
  "pages/admin/ProctorDashboardPage.tsx":
    "status-conditional PageHeader branches",
  "pages/admin/RecoveryExamDetailPage.tsx":
    "status-conditional PageHeader branches",
};

describe("row-action capacity contract", () => {
  it("removes the actionsDensity model everywhere", () => {
    const offenders = files.filter((path) =>
      /actionsDensity|data-actions-density/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
    expect(tableCss).not.toContain("data-actions-density");
  });

  it("binds the actions column to the contract width (6rem fine / 7.5rem coarse)", () => {
    expect(tableCss).toMatch(
      /\[data-column-role="actions"\]\s*\{[^}]*width:\s*6rem/,
    );
    expect(tableCss).toMatch(
      /@media \(pointer: coarse\)\s*\{[\s\S]*?\[data-column-role="actions"\]\s*\{[^}]*width:\s*7\.5rem/,
    );
  });

  it("uses the typed declaration API at every RowActions call site", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const tag of text.matchAll(/<RowActions\b[^>]*>/gs)) {
        if (!/\bactions=/.test(tag[0])) {
          offenders.push(relative(webRoot, path));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders admin-table action cells through RowActions (embedded-picker exception)", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const cell of text.matchAll(
        /<DataTableCell role="actions">((?:(?!<\/DataTableCell>)[\s\S])*)<\/DataTableCell>/g,
      )) {
        const body = cell[1] ?? "";
        const throughRowActions = body.includes("<RowActions");
        // The exam wizard/edit question pickers keep a text add action in
        // their dialog tables: auto layout, outside the admin shell (#445
        // P3 §4.4 documented exception).
        const pickerException = body.includes("dialogActions.add");
        if (!throughRowActions && !pickerException) {
          offenders.push(relative(webRoot, path));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps DialogFooter within the two-inline-button budget", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const footer of text.matchAll(
        /<DialogFooter\b[^>]*>((?:(?!<\/DialogFooter>)[\s\S])*)<\/DialogFooter>/g,
      )) {
        if (countButtons(footer[1] ?? "") > 2) {
          offenders.push(relative(webRoot, path));
        }
      }
    }
    expect(offenders.filter((o) => !(o in BUDGET_ALLOWLIST))).toEqual([]);
  });

  it("keeps DataToolbar within the two-inline-button budget", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      const chunks = text.split("</DataToolbar>").slice(0, -1);
      for (const chunk of chunks) {
        const start = chunk.lastIndexOf("<DataToolbar");
        if (start === -1) continue;
        if (countButtons(chunk.slice(start)) > 2) {
          offenders.push(relative(webRoot, path));
        }
      }
    }
    expect(offenders.filter((o) => !(o in BUDGET_ALLOWLIST))).toEqual([]);
  });

  it("keeps PageHeader actions within the two-inline-button budget", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/<PageHeader\b/g)) {
        // Extract the opening tag depth-aware: JSX prop values contain
        // elements whose `>` must not terminate the tag.
        const tag = extractOpeningTag(text, match.index ?? -1);
        if (!tag) continue;
        const actionsProp = /actions=\{/.exec(tag);
        if (!actionsProp) continue;
        const open = actionsProp.index + actionsProp[0].length - 1;
        let depth = 0;
        let end = open;
        for (; end < tag.length; end++) {
          if (tag[end] === "{") depth++;
          else if (tag[end] === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        const body = tag.slice(open, end + 1);
        if (countButtons(body) > 2) offenders.push(relative(webRoot, path));
      }
    }
    expect(offenders.filter((o) => !(o in BUDGET_ALLOWLIST))).toEqual([]);
  });
});
