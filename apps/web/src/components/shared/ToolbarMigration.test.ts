/**
 * UI-TOOLBAR-RESPONSIVE-1 structural gates (issue 458).
 *
 * Pins the toolbar control-sizing migration at the SOURCE level:
 *   - migrated pages no longer carry arbitrary px/rem widths on toolbar
 *     filter controls (the exam-ui/no-arbitrary-filter-width lint rule is the
 *     runtime gate; this test pins the migration itself);
 *   - the semantic vocabulary stays exactly narrow/wide (no third tier);
 *   - search sizing still belongs to DataToolbar, date sizing to DatePicker;
 *   - RecoveryQueue's ownerless bare <input> filters moved to the shared
 *     Input control;
 *   - no filter-collapse mechanism is pre-built.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "../..");

function read(relative: string): string {
  return readFileSync(join(webRoot, relative), "utf8");
}

const migratedPages = [
  "pages/admin/QuestionPage.tsx",
  "pages/admin/RecoveryQueuePage.tsx",
  "pages/admin/ProctorWorkspacePage.tsx",
  "pages/admin/AuditLogPage.tsx",
  "pages/admin/ImportLogsPage.tsx",
  "pages/admin/QuestionImportPage.tsx",
] as const;

describe("toolbar control sizing migration (issue 458)", () => {
  it("declares the semantic vocabulary as exactly narrow/wide", () => {
    const toolbar = read("components/shared/DataToolbar.tsx");
    expect(toolbar).toMatch(/ToolbarFilterSize = "narrow" \| "wide"/);
    expect(toolbar).toMatch(/w-full sm:w-\[9rem\]/);
    expect(toolbar).toMatch(/w-full sm:w-\[11\.25rem\]/);
    // No third tier sneaks in as a value or a page-facing escape hatch.
    expect(toolbar).not.toMatch(/"medium"|"xl"|"custom"|"compact"/);
  });

  it.each(migratedPages)("removes arbitrary filter widths from %s", (path) => {
    const source = read(path);
    // Filter controls must not carry page-owned arbitrary widths (the lint
    // rule enforces this continuously; this pins the migration outcome).
    expect(source).not.toMatch(/<SelectTrigger\b[^>]*\bw-\[[0-9.]+(px|rem)\]/);
    expect(source).not.toMatch(/<input\b[^>]*\bw-\[[0-9.]+(px|rem)\]/);
  });

  it("keeps search sizing owned by DataToolbar and date sizing by DatePicker", () => {
    const toolbar = read("components/shared/DataToolbar.tsx");
    expect(toolbar).toMatch(/sm:w-72 lg:w-80/);
    const datePicker = read("components/shared/DatePicker.tsx");
    expect(datePicker).toMatch(/w-\[160px\]/);
  });

  it("migrated RecoveryQueue ownerless bare inputs to the shared Input control", () => {
    const source = read("pages/admin/RecoveryQueuePage.tsx");
    expect(source).not.toMatch(/<input\b/);
    expect(source).toMatch(/<Input\b/);
    expect(source).toMatch(/ToolbarFilter size="wide"/);
  });

  it("does not pre-build a filter-collapse mechanism", () => {
    const sources = migratedPages.map((p) => read(p)).join("\n");
    expect(sources).not.toMatch(
      /MoreFilters|filterCollapse|showMoreFilters|collapsible filter|filter overflow/,
    );
  });
});
