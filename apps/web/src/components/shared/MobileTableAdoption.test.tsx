/**
 * UI-TABLE-MOBILE-1 structural guards (issue 457).
 *
 * Pins the mobile card representation at the SOURCE level:
 *   - the mobile slot is a management-list mechanism only: log-diagnostic and
 *     detail-comparison consumers keep horizontal scroll below lg (negative
 *     proofs), and the shell itself fails loud on the illegal combination;
 *   - the adopted management-list pages render BOTH representations from one
 *     DataViewColumnDef column array — the derived MobileRecordList consumes
 *     the same `columns` variable the desktop table does (no page-local
 *     mobile field maps);
 *   - the viewport switch is CSS-only: the mobile region is `lg:hidden` and
 *     the desktop region `hidden lg:block` in the shell/workbench — no JS
 *     breakpoint, no matchMedia, no viewport-width-driven representation
 *     swap (container measurement for tier negotiation stays legal);
 *   - MobileRecordCard stays the single card authority (QuestionPage's
 *     private hand-built card region is gone — converged onto the derived
 *     list).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTableShell } from "./DataTableShell";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), "utf8");
}

/** Management-list pages that adopted the derived mobile representation. */
const adoptedPages = [
  "../../pages/admin/CandidateFieldsPage",
  "../../pages/admin/CandidatesPage",
  "../../pages/admin/CoursePage",
  "../../pages/admin/DashboardPage",
  "../../pages/admin/ExamPage",
  "../../pages/admin/ExamProfilePage",
  "../../pages/admin/GradingQueuePage",
  "../../pages/admin/InvitationsCard",
  "../../pages/admin/ProctorWorkspacePage",
  "../../pages/admin/ResultsOverviewPage",
  "../../pages/admin/ScoreListPage",
  "../../pages/admin/UsersPage",
] as const;

/** Non-management-list archetypes: mobile cards are forbidden (scroll stays). */
const scrollOnlyConsumers = [
  {
    file: "../../pages/admin/AttemptDetailPage",
    archetype: "detail-comparison",
  },
  { file: "../../pages/admin/AuditLogPage", archetype: "log-diagnostic" },
  { file: "../../pages/admin/ImportLogsPage", archetype: "log-diagnostic" },
  { file: "../../pages/admin/RecoveryQueuePage", archetype: "log-diagnostic" },
  { file: "../../pages/exam/ResultPage", archetype: "detail-comparison" },
] as const;

describe("mobile card representation structural guards (issue 457)", () => {
  it.each(["detail-comparison", "log-diagnostic"])(
    "the shell fails loud when the mobile slot meets archetype %s",
    (archetype) => {
      expect(() =>
        render(
          // @ts-expect-error -- deliberately illegal prop combination (mobile
          // is not typed for non-management-list archetypes by contract)
          <DataTableShell archetype={archetype} mobile={<div>x</div>}>
            <table />
          </DataTableShell>,
        ),
      ).toThrow(/management-list mechanism/);
    },
  );

  it.each(scrollOnlyConsumers)(
    "$file keeps horizontal scroll below lg (no mobile card slot)",
    ({ file, archetype }) => {
      const source = read(`${file}.tsx`);
      expect(source).toContain(`archetype="${archetype}"`);
      expect(source).not.toMatch(/\bmobile=\{/);
      expect(source).not.toContain("MobileRecordList");
    },
  );

  it.each(adoptedPages)(
    "%s derives both representations from one column array",
    (file) => {
      const source = read(`${file}.tsx`);
      // Both representations exist...
      expect(source).toMatch(/<DesktopDataTable/);
      expect(source).toMatch(/<MobileRecordList/);
      // ...and consume the SAME column declarations (single source; a
      // page-local mobile field map would pass a different expression).
      expect(source).toMatch(/columns=\{columns\}/);
      expect(source).toMatch(/rows=\{/);
    },
  );

  it("converges the QuestionPage workbench mobile region onto the derived list", () => {
    const source = read("../../pages/admin/QuestionPage.tsx");
    expect(source).toMatch(/mobileList=\{/);
    expect(source).toMatch(
      /<MobileRecordList[\s\S]*columns=\{columns\}[\s\S]*rows=\{questions\}/,
    );
    // The private hand-built card region (hand-wired Buttons + ConfirmDialog
    // inside MobileRecordCard slots) is gone.
    expect(source).not.toMatch(/actions=\{[\s\S]*<Button[\s\S]*ConfirmDialog/);
  });

  it("keeps the viewport switch CSS-only (no JS breakpoint drives representation)", () => {
    const shell = read("./DataTableShell.tsx");
    const workbench = read("./DataWorkbench.tsx");
    const list = read("./MobileRecordList.tsx");
    for (const source of [shell, workbench, list]) {
      expect(source).not.toMatch(
        /matchMedia|useMediaQuery|innerWidth|addEventListener\("resize"/,
      );
    }
    // The CSS switch classes themselves.
    expect(shell).toMatch(/lg:hidden/);
    expect(shell).toMatch(/hidden min-w-0 lg:block/);
    expect(workbench).toMatch(/lg:hidden/);
    expect(workbench).toMatch(/hidden lg:block/);
  });

  it("keeps MobileRecordCard the single card authority (no second card component)", () => {
    const card = read("./MobileRecordCard.tsx");
    expect(card).toMatch(/data-slot="mobile-record-card"/);
    // The derived list composes cards; it does not re-implement card markup.
    const list = read("./MobileRecordList.tsx");
    expect(list).toMatch(/<MobileRecordCard/);
    expect(list).not.toContain("surface-content");
  });
});
