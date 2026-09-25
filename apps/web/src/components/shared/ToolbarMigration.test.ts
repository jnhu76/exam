/**
 * UI-TOOLBAR-RESPONSIVE-1 structural gates (issue 458).
 *
 * Pins the toolbar control-sizing migration at the SOURCE level:
 *   - arbitrary page-owned widths on toolbar filter controls are banned
 *     continuously by the exam-ui/no-arbitrary-filter-width lint rule (the
 *     executable owner of that fact — not re-pinned here);
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

  it("keeps search sizing owned by DataToolbar and date sizing by DatePicker", () => {
    const toolbar = read("components/shared/DataToolbar.tsx");
    expect(toolbar).toMatch(/sm:w-72 lg:w-80/);
    const datePicker = read("components/shared/DatePicker.tsx");
    expect(datePicker).toMatch(/w-\[160px\]/);
  });

  it("migrated RecoveryQueue ownerless bare inputs to the shared exact-text filter", () => {
    const source = read("pages/admin/RecoveryQueuePage.tsx");
    expect(source).not.toMatch(/<input\b/);
    // The exact-identifier filters use the shared text-commit owner (no
    // page-local debounce / draftRef / blur-flush plumbing) and the semantic
    // width tier.
    expect(source).toMatch(/<TextFilterInput\b/);
    expect(source).toMatch(/ToolbarFilter size="wide"/);
    expect(source).not.toMatch(
      /draftRef|scheduleDebouncedCommit|FILTER_DEBOUNCE_MS/,
    );
  });

  it("does not pre-build a filter-collapse mechanism", () => {
    const sources = migratedPages.map((p) => read(p)).join("\n");
    expect(sources).not.toMatch(
      /MoreFilters|filterCollapse|showMoreFilters|collapsible filter|filter overflow/,
    );
  });
});
