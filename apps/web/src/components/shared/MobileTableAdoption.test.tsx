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
import {
  DataTableShell,
  isMobileRepresentationAllowed,
} from "./DataTableShell";
import { DataWorkbench } from "./DataWorkbench";
import { deriveMobileCardFields } from "./MobileRecordList";
import type { DataViewColumnDef } from "./DesktopDataTable";

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
  // ── C2: production-safe archetype enforcement ──

  it.each([
    { archetype: "management-list" as const, hasMobile: true, expected: true },
    {
      archetype: "management-list" as const,
      hasMobile: false,
      expected: false,
    },
    {
      archetype: "detail-comparison" as const,
      hasMobile: true,
      expected: false,
    },
    { archetype: "log-diagnostic" as const, hasMobile: true, expected: false },
    { archetype: "embedded-picker" as const, hasMobile: true, expected: false },
  ])(
    "isMobileRepresentationAllowed($archetype, $hasMobile) → $expected",
    ({ archetype, hasMobile, expected }) => {
      expect(isMobileRepresentationAllowed(archetype, hasMobile)).toBe(
        expected,
      );
    },
  );

  it.each(["detail-comparison", "log-diagnostic"])(
    "the shell fails loud when the mobile slot meets archetype %s (DEV/test)",
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

  it.each(["detail-comparison", "log-diagnostic"] as const)(
    "the workbench fails loud when mobileList meets archetype %s (DEV/test)",
    (archetype) => {
      expect(() =>
        render(
          <DataWorkbench
            archetype={archetype}
            desktopTable={<table />}
            mobileList={<div>x</div>}
          />,
        ),
      ).toThrow(/management-list mechanism/);
    },
  );

  it("DataWorkbench reuses the single eligibility authority (no second predicate)", () => {
    // R1 parity: the workbench consumes isMobileRepresentationAllowed from
    // DataTableShell — the one predicate stays the authority for both shells.
    const workbench = read("./DataWorkbench.tsx");
    expect(workbench).toMatch(/isMobileRepresentationAllowed\(/);
  });

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

  // ── C4: per-column priority audit (issue 457) ──
  // Every decision below is a declaration-local override on the page's column
  // array; the global ROLE_PRIORITY defaults are NOT modified.

  it("keeps unbounded dynamic CandidateFields off the card meta line", () => {
    // The mechanism: a secondary-text field participates in the meta line
    // unless the declaration overrides it to low.
    const card = (priority?: "low") =>
      deriveMobileCardFields([
        {
          id: "username",
          meta: { role: "primary-text" },
          header: "用户名",
          cell: () => "u",
        },
        {
          id: "field-1",
          meta: { role: "secondary-text", priority },
          header: "动态字段",
          cell: () => "v",
        },
      ] as DataViewColumnDef<{ username: string }>[]);
    expect(card().map((f) => f.slot)).toEqual(["primary", "meta"]);
    expect(card("low").map((f) => f.slot)).toEqual(["primary"]);

    // The audited page: the dynamic fields.map declaration carries the
    // priority "low" override (removing it must fail this pin — M-C4).
    const source = read("../../pages/admin/CandidatesPage.tsx");
    const dynamicDecl = source.match(
      /\.\.\.fields\.map\(\(field\) => \(\{[\s\S]*?\}\)\),/,
    );
    expect(dynamicDecl, "dynamic field declaration found").toBeTruthy();
    expect(dynamicDecl![0]).toMatch(/priority: "low"/);
  });

  it("keeps unbounded ScoreList candidateInfo off the card meta line (R3 audit correction)", () => {
    // Deployment-defined candidate fields are unbounded in count/content —
    // joining them into one JSX node does not make the information bounded.
    // The declaration must carry priority "low": mobile omits the field while
    // desktop keeps the full column (responsive information reduction, not
    // data deletion).
    const fields = deriveMobileCardFields([
      {
        id: "candidateName",
        meta: { role: "primary-text" },
        header: "考生",
        cell: () => "n",
      },
      {
        id: "candidateInfo",
        meta: { role: "secondary-text", priority: "low" },
        header: "考生信息",
        cell: () => "i",
      },
      {
        id: "submittedAt",
        meta: { role: "date" },
        header: "提交时间",
        cell: () => "d",
      },
    ] as DataViewColumnDef<{ candidateName: string }>[]);
    // candidateName (primary), submittedAt (meta) participate; the low
    // candidateInfo column is absent from the derived card fields.
    expect(fields.map((f) => f.id)).toEqual(["candidateName", "submittedAt"]);

    // The audited page: candidateInfo carries the priority "low" override
    // (removing it must fail this pin — M-F4).
    const source = read("../../pages/admin/ScoreListPage.tsx");
    expect(source).toMatch(/id: "candidateInfo",[\s\S]{0,400}priority: "low"/);
  });

  it.each([
    { file: "../../pages/admin/UsersPage", what: "account role" },
    { file: "../../pages/admin/InvitationsCard", what: "invited role" },
  ])("$what joins the card meta line (type defaults low)", ({ file }) => {
    const source = read(`${file}.tsx`);
    expect(source).toMatch(/id: "role",[\s\S]{0,200}priority: "normal"/);
  });

  it("keeps QuestionPage card parity: score is labeled meta, type+content lead", () => {
    const source = read("../../pages/admin/QuestionPage.tsx");
    // score (role "score" defaults high → header cluster) must stay a labeled
    // meta line, matching the pre-derivation hand-mapped card.
    expect(source).toMatch(/id: "score",[\s\S]{0,200}priority: "normal"/);
    // type badge and content keep leading the card.
    expect(source).toMatch(/id: "type",[\s\S]{0,200}priority: "high"/);
    expect(source).toMatch(/id: "content",[\s\S]{0,200}priority: "high"/);
  });

  // ── C3: single responsive policy owner ──

  it("ResponsiveRepresentation is the sole owner of the lg:hidden / hidden lg:block viewport switch", () => {
    const owner = read("./ResponsiveRepresentation.tsx");
    expect(owner).toMatch(/lg:hidden/);
    expect(owner).toMatch(/hidden min-w-0 lg:block/);

    // DataTableShell and DataWorkbench must NOT independently encode the
    // responsive viewport policy — they consume ResponsiveRepresentation.
    const shell = read("./DataTableShell.tsx");
    const workbench = read("./DataWorkbench.tsx");
    // Shell may reference lg:hidden in the ResponsiveRepresentation import
    // usage, but must not define its own lg:hidden class.
    expect(shell).not.toMatch(/className="[^"]*lg:hidden/);
    expect(shell).not.toMatch(/className="[^"]*hidden lg:block/);
    // Workbench same.
    expect(workbench).not.toMatch(/className="[^"]*lg:hidden/);
    expect(workbench).not.toMatch(/className="[^"]*hidden lg:block/);
  });

  it("DataTableShell and DataWorkbench both consume ResponsiveRepresentation", () => {
    const shell = read("./DataTableShell.tsx");
    const workbench = read("./DataWorkbench.tsx");
    expect(shell).toContain("ResponsiveRepresentation");
    expect(workbench).toContain("ResponsiveRepresentation");
  });

  it("keeps the viewport switch CSS-only (no JS breakpoint drives representation)", () => {
    const owner = read("./ResponsiveRepresentation.tsx");
    const shell = read("./DataTableShell.tsx");
    const workbench = read("./DataWorkbench.tsx");
    const list = read("./MobileRecordList.tsx");
    for (const source of [owner, shell, workbench, list]) {
      expect(source).not.toMatch(
        /matchMedia|useMediaQuery|innerWidth|addEventListener\("resize"/,
      );
    }
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
