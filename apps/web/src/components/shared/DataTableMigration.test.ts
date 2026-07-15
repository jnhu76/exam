import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const tableConsumers = [
  "../../pages/admin/AttemptDetailPage.tsx",
  "../../pages/admin/AuditLogPage.tsx",
  "../../pages/admin/CandidateFieldsPage.tsx",
  "../../pages/admin/CandidatesPage.tsx",
  "../../pages/admin/CoursePage.tsx",
  "../../pages/admin/DashboardPage.tsx",
  "../../pages/admin/ExamCreatePage.tsx",
  "../../pages/admin/ExamDetailPage.tsx",
  "../../pages/admin/ExamEditPage.tsx",
  "../../pages/admin/ExamPage.tsx",
  "../../pages/admin/GradingQueuePage.tsx",
  "../../pages/admin/ImportLogsPage.tsx",
  "../../pages/admin/QuestionImportPage.tsx",
  "../../pages/admin/QuestionPage.tsx",
  "../../pages/admin/ResultsOverviewPage.tsx",
  "../../pages/admin/ScoreListPage.tsx",
  "../../pages/admin/UsersPage.tsx",
  "../../pages/exam/ResultPage.tsx",
] as const;

describe("data table column-contract migration", () => {
  it.each(tableConsumers)(
    "routes every column in %s through semantic roles",
    (path) => {
      const source = readFileSync(join(here, path), "utf8");

      // A consumer routes columns through the semantic role contract in ONE of
      // two ways: (a) directly via <DataTableColumns> + DataTableHead/Cell, or
      // (b) via <DesktopDataTable> whose ColumnDefs carry meta: { role } (the
      // DesktopDataTable renders the contract primitives internally).
      // UI-TOKEN-TABLE-FOUNDATION-1: QuestionPage migrated to pattern (b).
      const usesDirectContract = source.includes("<DataTableColumns");
      const usesDesktopDataTable =
        source.includes("<DesktopDataTable") &&
        /meta:\s*\{\s*role:/.test(source);
      expect(
        usesDirectContract || usesDesktopDataTable,
        `${path} must route columns through the semantic role contract (either <DataTableColumns> or <DesktopDataTable> with meta.role)`,
      ).toBe(true);

      // Raw <TableHead>/<TableCell> bypass the contract in either pattern.
      expect(source).not.toMatch(/<Table(?:Head|Cell)\b/);
    },
  );
});
