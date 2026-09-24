import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import type { DataTableColumnRole } from "@/components/shared/DataTableContract";
import {
  CELL_CHROME_PX,
  CJK_ADVANCE_EM,
  FLOOR_SLACK_PX,
  HEADER_TIER_PX,
  tokenGrid,
} from "@/table/roleCalibration";

/**
 * Header-label capacity — the SECOND content channel of a governed column
 * (issue 601 Phase F convergence).
 *
 * A column's geometry used to be derived from its VALUE vocabulary alone, so a
 * role whose values are short could carry a header that did not fit: measured
 * on /admin/exams @1440, the `number` column allocated 84px while its
 * `参与人数` header needs 88px and rendered as `参与人…`. A header is a
 * different content class from a value — different i18n namespace, rendered at
 * the governed 14px header tier, and it grows whenever copy or locale changes —
 * so it is declared here as its own bounded vocabulary and folded into the
 * role's PREFERRED geometry (`basis`).
 *
 * Why basis and not floor: a header cell renders under its column's declared
 * overflow policy, and every atomic role's policy is `nowrap`, which clips
 * with an ellipsis. Clipping is a legal compressed representation, so header
 * demand is a PREFERRED-geometry requirement: at `basis` and above no header
 * ellipsizes, while a container between Σfloor and Σbasis compresses the whole
 * table — headers included — instead of forcing the table to scroll.
 *
 * The runtime geometry reads MAX_HEADER_GLYPHS, a declared per-role bound; the
 * fixture below (the production vocabulary, resolved through i18n in every
 * supported locale) is the gate that proves the declared bound still covers
 * the real copy. That split matters: resolving copy at module load would race
 * i18next's deferred initialization, and a copy change must red a test rather
 * than silently resize a table at runtime.
 */

/** Width of `glyphs` full-width glyphs at the header tier, rounded up. */
export function headerGlyphRun(glyphs: number): number {
  return Math.ceil(glyphs * HEADER_TIER_PX * CJK_ADVANCE_EM);
}

/**
 * The declared header bound per role: the number of full-width glyphs a
 * governed header label may occupy. The widest production label in the whole
 * vocabulary is `页面不可见` (5 glyphs, the exam-monitoring counters); the next
 * tier is 4 glyphs, which covers eleven of the fifteen roles.
 */
export const MAX_HEADER_GLYPHS: Record<DataTableColumnRole, number> = {
  "primary-text": 4,
  "secondary-text": 4,
  "long-text": 4,
  description: 2,
  status: 4,
  date: 4,
  "date-range": 4,
  duration: 4,
  number: 5,
  score: 3,
  "short-id": 4,
  type: 4,
  "action-label": 2,
  "tag-list": 2,
  actions: 2,
};

/**
 * The governed header vocabulary per role: the `t()` paths used by a governed
 * header cell (DataTableHead, or a DesktopDataTable column's `header`). An
 * empty resolved label (an intentionally blank actions header) contributes
 * nothing.
 *
 * NOT listed: the /admin/candidates dynamic `CandidateField.label` header —
 * its text is deployment data (the institution's own field labels), not
 * product copy, so no fixture can bound it. It renders through the
 * secondary-text channel, whose basis covers the widest product label.
 */
export const ROLE_HEADER_KEYS: Record<DataTableColumnRole, readonly string[]> =
  {
    "primary-text": [
      "admin.exams.columns.title",
      "admin.scoreList.columns.candidateName",
      "admin.users.columns.username",
      "admin.users.columns.name",
      "admin.recoveryQueue.columns.candidate",
      "admin.users.invitations.columns.email",
      "admin.courses.columns.name",
      "admin.examMonitoring.columns.candidate",
      "admin.examDetail.enrollment.columns.identity",
      "admin.examDetail.enrollment.columns.name",
      "admin.candidateFields.columns.label",
      "admin.examProfilePages.columns.name",
      "admin.audit.columns.actor",
      "admin.proctorWorkspace.columns.title",
      "admin.resultsOverview.columns.title",
      "admin.dashboard.recent.columns.title",
      "admin.grading.columns.candidate",
    ],
    "secondary-text": [
      "admin.attemptDetail.result.columns.candidateAnswer",
      "admin.attemptDetail.result.columns.standardAnswer",
      "candidateResult.table.yourAnswer",
      "candidateResult.table.correctAnswer",
      "admin.scoreList.columns.candidateInfo",
      "admin.recoveryQueue.columns.linked",
      "admin.recoveryQueue.columns.proctors",
      "admin.questions.columns.course",
      "admin.grading.columns.exam",
    ],
    "long-text": [
      "admin.questionImport.previewColumns.content",
      "admin.questionImport.previewColumns.detail",
      "admin.attemptDetail.result.columns.content",
      "admin.examWizard.questions.tableHeaders.content",
      "admin.examEdit.tableHeaders.content",
      "candidateResult.table.questionContent",
      "admin.recoveryQueue.columns.exam",
      "admin.proctorRecovery.columns.exam",
      "admin.questions.columns.content",
      "admin.examProfilePages.columns.summary",
    ],
    description: ["admin.courses.columns.description"],
    status: [
      "admin.exams.columns.status",
      "admin.scoreList.columns.status",
      "admin.users.columns.status",
      "admin.recoveryQueue.columns.incident",
      "admin.recoveryQueue.columns.attempt",
      "admin.proctorWorkspace.columns.status",
      "admin.importLogs.columns.status",
      "admin.examMonitoring.columns.status",
      "admin.dashboard.recent.columns.status",
      "admin.examDetail.enrollment.columns.status",
      "admin.grading.columns.status",
      "admin.resultsOverview.columns.status",
      "admin.proctorRecovery.columns.incident",
      "admin.proctorRecovery.columns.attempt",
      "admin.users.invitations.columns.status",
      "admin.questionImport.previewColumns.status",
      "admin.candidates.columns.status",
    ],
    date: [
      "admin.audit.columns.time",
      "admin.importLogs.columns.time",
      "admin.scoreList.columns.submittedAt",
      "admin.recoveryQueue.columns.createdAt",
      "admin.proctorWorkspace.columns.openAt",
      "admin.proctorWorkspace.columns.closeAt",
      "admin.users.invitations.columns.expiresAt",
      "admin.resultsOverview.columns.time",
      "admin.grading.columns.submittedAt",
      "admin.examProfilePages.columns.updatedAt",
      "admin.proctorRecovery.columns.createdAt",
    ],
    "date-range": ["admin.exams.columns.timeWindow"],
    duration: [
      "admin.exams.columns.duration",
      "admin.examMonitoring.columns.lastHeartbeat",
      "admin.examMonitoring.columns.lastSave",
    ],
    number: [
      "admin.questionImport.previewColumns.row",
      "admin.attemptDetail.result.columns.number",
      "candidateResult.table.questionNumber",
      "admin.importLogs.columns.total",
      "admin.importLogs.columns.created",
      "admin.importLogs.columns.updated",
      "admin.importLogs.columns.errors",
      "admin.exams.columns.questionCount",
      "admin.exams.columns.participants",
      "admin.questions.columns.difficulty",
      "admin.resultsOverview.columns.gradedCount",
      "admin.examMonitoring.columns.visibilityLost",
      "admin.examMonitoring.columns.browserOffline",
      "admin.examMonitoring.columns.saveFailed",
      "admin.examMonitoring.columns.submitFailed",
      "admin.dashboard.recent.columns.participantCount",
      "admin.examDetail.enrollment.columns.attemptCount",
      "admin.candidateFields.columns.sortOrder",
      "admin.grading.columns.pendingCount",
    ],
    score: [
      "admin.questionImport.previewColumns.score",
      "admin.attemptDetail.result.columns.score",
      "admin.attemptDetail.result.columns.maxScore",
      "admin.examWizard.questions.tableHeaders.score",
      "admin.examEdit.tableHeaders.score",
      "candidateResult.table.score",
      "admin.exams.columns.passingScore",
      "admin.scoreList.columns.score",
      "admin.questions.columns.score",
      "admin.examDetail.enrollment.columns.score",
    ],
    "short-id": [
      "admin.audit.columns.target",
      "admin.audit.columns.detail",
      "admin.courses.columns.code",
      "admin.candidateFields.columns.fieldName",
    ],
    type: [
      "admin.questionImport.previewColumns.type",
      "admin.attemptDetail.result.columns.type",
      "admin.importLogs.columns.type",
      "admin.examWizard.questions.tableHeaders.type",
      "admin.examEdit.tableHeaders.type",
      "candidateResult.table.questionType",
      "admin.users.columns.role",
      "admin.recoveryQueue.columns.severity",
      "admin.proctorRecovery.columns.severity",
      "admin.questions.columns.type",
      "admin.examMonitoring.columns.online",
      "admin.examMonitoring.columns.warningLevel",
      "admin.candidateFields.columns.type",
      "admin.candidateFields.columns.required",
      "admin.candidateFields.columns.unique",
      "admin.users.invitations.columns.role",
    ],
    "action-label": ["admin.audit.columns.action"],
    "tag-list": ["admin.questions.columns.tags"],
    actions: [
      "admin.examWizard.questions.tableHeaders.actions",
      "admin.examEdit.tableHeaders.actions",
      "admin.exams.columns.actions",
      "admin.scoreList.columns.actions",
      "admin.users.columns.actions",
      "admin.proctorWorkspace.columns.actions",
      "admin.questions.columns.actions",
      "admin.users.invitations.columns.actions",
      "admin.resultsOverview.columns.actions",
      "admin.candidates.columns.actions",
      "admin.examMonitoring.columns.actions",
      "admin.dashboard.recent.columns.actions",
      "admin.examDetail.enrollment.columns.actions",
      "admin.candidateFields.columns.actions",
      "admin.examProfilePages.columns.actions",
      "admin.courses.columns.actions",
      "admin.examWizard.questions.dialogActions.add",
      "admin.examEdit.dialogActions.add",
    ],
  };

/**
 * The registry enumerates header keys DYNAMICALLY, so it must bypass the
 * per-key `t()` typing the way the locale files themselves are untyped data
 * (same pattern as actionLabelFixture).
 */
type DynamicT = (key: string, options?: Record<string, unknown>) => unknown;

export interface HeaderLabelFixtureRow {
  role: DataTableColumnRole;
  locale: string;
  key: string;
  label: string;
  glyphs: number;
  estimatedWidthPx: number;
}

/**
 * The header-label verification universe: every registered key resolved in
 * every supported locale. Labels resolve through `t(key, { lng: locale })`, so
 * a missing catalog entry surfaces as the key path — the gate rejects that
 * rather than measuring it.
 */
export function headerLabelFixture(): HeaderLabelFixtureRow[] {
  const rows: HeaderLabelFixtureRow[] = [];
  const t = i18n.t.bind(i18n) as DynamicT;
  for (const locale of SUPPORTED_LOCALES) {
    for (const [role, keys] of Object.entries(ROLE_HEADER_KEYS) as [
      DataTableColumnRole,
      readonly string[],
    ][]) {
      for (const key of keys) {
        const resolved = t(key, { lng: locale });
        const label = typeof resolved === "string" ? resolved : "";
        rows.push({
          role,
          locale,
          key,
          label,
          glyphs: [...label].length,
          estimatedWidthPx: headerGlyphRun([...label].length),
        });
      }
    }
  }
  return rows;
}

/** The widest registered header label for one role, in px (upper bound). */
export function maxHeaderLabelWidth(role: DataTableColumnRole): number {
  return Math.max(
    0,
    ...headerLabelFixture()
      .filter((row) => row.role === role)
      .map((row) => row.estimatedWidthPx),
  );
}

/**
 * The role's declared header capacity: cell chrome + the declared glyph bound
 * + one grid step of slack, on the token grid. This is the smallest column
 * width at which the role's supported header vocabulary renders without
 * ellipsizing.
 */
export function headerCapacityPx(role: DataTableColumnRole): number {
  return tokenGrid(
    CELL_CHROME_PX + headerGlyphRun(MAX_HEADER_GLYPHS[role]) + FLOOR_SLACK_PX,
  );
}
