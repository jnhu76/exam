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

      expect(source).toContain("<DataTableColumns");
      expect(source).not.toMatch(/<Table(?:Head|Cell)\b/);
    },
  );
});
