import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { ExamDTO } from "@exam/contracts";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { routes } from "@/lib/routes";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { RowActions } from "@/components/shared/RowActions";
import { StatsCard } from "@/components/shared/StatsCard";
import { PageSection } from "@/components/shared/PageSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Trash2 } from "lucide-react";
import {
  EnrollmentPicker,
  type CandidateItem,
} from "@/components/exam/EnrollmentPicker";
import { useAuth } from "@/hooks/useAuth";
import {
  canArchiveExam,
  canCancelExam,
  canCloseExam,
  canExtendExam,
  canManageEnrollments,
  canPublishExam,
  canPublishResults,
  canSeeProctor,
  canUnpublishExam,
  canUpdateExam,
} from "@/lib/capabilities";

/** Full exam detail: the canonical exam entity plus aggregated stats and
 * participant summaries. Extends the shared contract type so nullable timing
 * fields (durationMinutes/closeAt for deadline/untimed) cannot drift. */
interface ExamDetail extends ExamDTO {
  stats: {
    participantCount: number;
    completedCount: number;
    passedCount: number;
  };
  participants: Array<{
    candidateId: string;
    name: string;
    fields: Record<string, unknown>;
    status: string;
    score: number | null;
    passed: boolean | null;
  }>;
}

/** An enrollment record linking a candidate to an exam with status and scores. */
/** An enrollment record linking a candidate to an exam with attempt and score data. */
interface EnrollmentItem {
  id: string;
  examId: string;
  candidateId: string;
  candidateDisplayName: string;
  candidateIdentity?: string;
  status: string;
  attemptCount: number;
  finalScore: number | null;
  finalPassed: boolean | null;
}

/**
 * Admin exam detail page showing configuration, stats cards,
 * enrollment management with add/remove, and a scores tab.
 */
/**
 * Admin page for viewing and managing a single exam's details.
 * Displays exam configuration, statistics, enrollment management (add/remove candidates),
 * and provides publish, close, and archive lifecycle actions.
 */
export function ExamDetailPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Localized value labels for the 考试配置 block. Raw enum values (e.g.
  // "timed_window", "unlimited") must never reach the admin UI; unknown
  // values fall back to the raw value so a future enum addition degrades
  // gracefully instead of rendering an i18n key.
  const policyLabels = useMemo(
    () => ({
      timingMode: {
        timed_window: t("admin.forms.exam.timingModeValue.timed_window"),
        deadline: t("admin.forms.exam.timingModeValue.deadline"),
        untimed: t("admin.forms.exam.timingModeValue.untimed"),
      } as Record<string, string>,
      retakePolicy: {
        unlimited: t("admin.examProfilePages.enumLabels.retakePolicyUnlimited"),
        max_attempts: t(
          "admin.examProfilePages.enumLabels.retakePolicyMaxAttempts",
        ),
        pass_then_stop: t(
          "admin.examProfilePages.enumLabels.retakePolicyPassThenStop",
        ),
      } as Record<string, string>,
      scoreStrategy: {
        highest: t("admin.examProfilePages.enumLabels.scoreStrategyHighest"),
        latest: t("admin.examProfilePages.enumLabels.scoreStrategyLatest"),
        first: t("admin.examProfilePages.enumLabels.scoreStrategyFirst"),
      } as Record<string, string>,
    }),
    [t],
  );
  const labelFor =
    (map: Record<string, string>) =>
    (value: string): string =>
      map[value] ?? value;
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(15);
  const [enrollments, setEnrollments] = useState<EnrollmentItem[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [loadingMoreCandidates, setLoadingMoreCandidates] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    new Set(),
  );
  const [addingEnrollment, setAddingEnrollment] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const mayUpdateExam = user ? canUpdateExam(user) : false;
  const mayPublishExam = user ? canPublishExam(user) : false;
  const mayCloseExam = user ? canCloseExam(user) : false;
  const mayPublishResults = user ? canPublishResults(user) : false;
  const mayManageEnrollments = user ? canManageEnrollments(user) : false;
  const mayUnpublishExam = user ? canUnpublishExam(user) : false;
  const mayCancelExam = user ? canCancelExam(user) : false;
  const mayArchiveExam = user ? canArchiveExam(user) : false;
  const mayExtendExam = user ? canExtendExam(user) : false;
  const maySeeProctor = user ? canSeeProctor(user) : false;

  /** Fetches the full exam detail from the API. */
  const loadExam = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<ExamDetail>(`/api/exams/${id}`);
      setExam(data);
    } catch {
      setError(t("admin.examDetail.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  /** Fetches the enrollment list for this exam. */
  const loadEnrollments = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<EnrollmentItem[]>(
        `/api/exams/${id}/enrollments`,
      );
      setEnrollments(data);
    } catch {
      toast.error(t("admin.examDetail.errors.loadEnrollmentsFailed"));
    }
  }, [id, t]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  /** Opens the add-candidate dialog and loads the first page of available candidates. */
  async function handleOpenAddDialog() {
    setAddDialogOpen(true);
    setCandidatePage(1);
    try {
      const data = await api.get<{
        items: CandidateItem[];
        total: number;
      }>("/api/candidates?page=1&pageSize=50");
      setCandidates(data.items);
      setCandidateTotal(data.total);
      setSelectedCandidateIds(new Set());
    } catch {
      toast.error(t("admin.examDetail.errors.loadCandidatesFailed"));
    }
  }

  /** Loads the next page of candidates for infinite-scroll in the enrollment picker. */
  async function handleLoadMoreCandidates() {
    const nextPage = candidatePage + 1;
    setLoadingMoreCandidates(true);
    try {
      const data = await api.get<{
        items: CandidateItem[];
        total: number;
      }>(`/api/candidates?page=${nextPage}&pageSize=50`);
      setCandidates((prev) => [...prev, ...data.items]);
      setCandidateTotal(data.total);
      setCandidatePage(nextPage);
    } catch {
      toast.error(t("admin.examDetail.errors.loadMoreFailed"));
    } finally {
      setLoadingMoreCandidates(false);
    }
  }

  /** Submits the selected candidates as new enrollments for this exam. */
  async function handleAddEnrollments() {
    if (!id || selectedCandidateIds.size === 0) return;
    setAddingEnrollment(true);
    try {
      await api.post(`/api/exams/${id}/enrollments`, {
        candidateIds: Array.from(selectedCandidateIds),
      });
      toast.success(t("admin.examDetail.toast.added"));
      setAddDialogOpen(false);
      await loadEnrollments();
      await loadExam();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.examDetail.errors.addFailed")),
      );
    } finally {
      setAddingEnrollment(false);
    }
  }

  /** Removes a single enrollment by id and refreshes the exam and enrollment data. */
  async function handleRemoveEnrollment(enrollmentId: string) {
    if (!id) return;
    try {
      await api.delete(`/api/exams/${id}/enrollments/${enrollmentId}`);
      toast.success(t("admin.examDetail.toast.removed"));
      await loadEnrollments();
      await loadExam();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.examDetail.errors.removeFailed")),
      );
    }
  }

  /** Publishes the exam, making it available to enrolled candidates. */
  async function handlePublish() {
    if (!id || publishing) return;
    setPublishError(null);
    setPublishing(true);
    try {
      await api.post(`/api/exams/${id}/publish`);
      toast.success(t("admin.examDetail.toast.published"));
      await loadExam();
    } catch (err) {
      const msg = getApiErrorMessage(
        err,
        t,
        t("admin.examDetail.errors.publishFailed"),
      );
      setPublishError(msg);
      toast.error(msg);
    } finally {
      setPublishing(false);
    }
  }

  /** Closes the exam (open -> closed). ADR-005 Slice 1. */
  async function handleClose() {
    if (!id || closing) return;
    setClosing(true);
    try {
      await api.post(`/api/exams/${id}/close`, {});
      toast.success(t("admin.examDetail.toast.closed"));
      await loadExam();
    } catch {
      toast.error(t("admin.examDetail.errors.closeFailed"));
    } finally {
      setClosing(false);
    }
  }

  /** Unpublishes the exam (published -> draft). ADR-005 Slice 2 §3.2. */
  async function handleUnpublish() {
    if (!id || unpublishing) return;
    setUnpublishing(true);
    try {
      await api.post(`/api/exams/${id}/unpublish`);
      toast.success(t("admin.examDetail.toast.unpublished"));
      await loadExam();
    } catch {
      toast.error(t("admin.examDetail.errors.unpublishFailed"));
    } finally {
      setUnpublishing(false);
    }
  }

  /** Publishes exam results (manual mode) so candidates can see their scores. */
  async function handlePublishResults() {
    if (!id || releasing) return;
    setReleasing(true);
    try {
      await api.post(`/api/exams/${id}/publish-results`);
      toast.success(t("admin.examDetail.toast.resultsPublished"));
      await loadExam();
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          t,
          t("admin.examDetail.errors.publishResultsFailed"),
        ),
      );
    } finally {
      setReleasing(false);
    }
  }

  /** Extends the open exam's closeAt (open -> open). ADR-005 Slice 2 §3.4. */
  async function handleExtend() {
    if (!id || extending) return;
    setExtending(true);
    try {
      await api.post(`/api/exams/${id}/extend`, { extendMinutes });
      toast.success(
        t("admin.examDetail.toast.extended", { minutes: extendMinutes }),
      );
      setExtendDialogOpen(false);
      await loadExam();
    } catch {
      toast.error(t("admin.examDetail.errors.extendFailed"));
    } finally {
      setExtending(false);
    }
  }

  /** Archives the exam, removing it from the active exam list. */
  async function handleArchive() {
    if (!id || archiving) return;
    setArchiving(true);
    try {
      await api.post(`/api/exams/${id}/archive`);
      toast.success(t("admin.examDetail.toast.archived"));
      await loadExam();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.examDetail.errors.archiveFailed")),
      );
    } finally {
      setArchiving(false);
    }
  }

  /** Cancels the exam (published/open → canceled). Documented Phase 2 op (ADR-005). */
  async function handleCancel() {
    if (!id || canceling) return;
    setCanceling(true);
    try {
      await api.post(`/api/exams/${id}/cancel`);
      toast.success(t("admin.examDetail.toast.canceled"));
      await loadExam();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.examDetail.errors.cancelFailed")),
      );
    } finally {
      setCanceling(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExam} />;
  if (!exam)
    return (
      <ErrorState
        message={t("admin.examDetail.errors.dataLoadFailed")}
        onRetry={loadExam}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={exam.title}
        actions={
          <div className="flex gap-2">
            {exam.status === "draft" && mayUpdateExam && (
              <Button
                variant="outline"
                onClick={() => void navigate(routes.admin.examEdit(id!))}
              >
                {t("admin.examDetail.actions.edit")}
              </Button>
            )}
            {exam.status === "draft" && mayPublishExam && (
              <Button
                onClick={() => void handlePublish()}
                disabled={publishing}
              >
                {publishing
                  ? t("admin.examDetail.actions.publishing")
                  : t("admin.examDetail.actions.publish")}
              </Button>
            )}
            {exam.status === "open" && mayCloseExam && (
              <ConfirmDialog
                trigger={
                  <Button
                    data-testid="exam-detail-close-btn"
                    disabled={closing}
                  >
                    {closing
                      ? t("admin.examDetail.actions.closing")
                      : t("admin.examDetail.actions.close")}
                  </Button>
                }
                title={t("admin.examDetail.confirm.closeTitle")}
                description={t("admin.examDetail.confirm.closeDescription", {
                  title: exam.title,
                })}
                destructive
                onConfirm={() => void handleClose()}
              />
            )}
            {exam.status === "open" && mayExtendExam && (
              <Button
                data-testid="exam-detail-extend-btn"
                variant="outline"
                onClick={() => setExtendDialogOpen(true)}
              >
                {t("admin.examDetail.actions.extend")}
              </Button>
            )}
            {exam.status === "open" && maySeeProctor && (
              <Button
                variant="outline"
                onClick={() => void navigate(`/admin/exams/${id}/proctor`)}
              >
                {t("admin.examDetail.actions.proctor")}
              </Button>
            )}
            {exam.status === "published" && mayUnpublishExam && (
              <ConfirmDialog
                trigger={
                  <Button
                    data-testid="exam-detail-unpublish-btn"
                    variant="outline"
                    disabled={unpublishing}
                  >
                    {unpublishing
                      ? t("admin.examDetail.actions.unpublishing")
                      : t("admin.examDetail.actions.unpublish")}
                  </Button>
                }
                title={t("admin.examDetail.confirm.unpublishTitle")}
                description={t(
                  "admin.examDetail.confirm.unpublishDescription",
                  { title: exam.title },
                )}
                destructive
                onConfirm={() => void handleUnpublish()}
              />
            )}
            {mayArchiveExam &&
              (exam.status === "published" || exam.status === "closed") && (
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" disabled={archiving}>
                      {archiving
                        ? t("admin.examDetail.actions.archiving")
                        : t("admin.examDetail.actions.archive")}
                    </Button>
                  }
                  title={t("admin.examDetail.confirm.archiveTitle")}
                  description={t(
                    "admin.examDetail.confirm.archiveDescription",
                    {
                      title: exam.title,
                    },
                  )}
                  destructive
                  onConfirm={() => void handleArchive()}
                />
              )}
            {mayCancelExam &&
              (exam.status === "published" || exam.status === "open") && (
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" disabled={canceling}>
                      {canceling
                        ? t("admin.examDetail.actions.canceling")
                        : t("admin.examDetail.actions.cancel")}
                    </Button>
                  }
                  title={t("admin.examDetail.confirm.cancelTitle")}
                  description={t("admin.examDetail.confirm.cancelDescription", {
                    title: exam.title,
                  })}
                  destructive
                  onConfirm={() => void handleCancel()}
                />
              )}
            {mayPublishResults &&
              exam.resultPublicationMode === "manual" &&
              !exam.resultsPublishedAt &&
              (exam.status === "published" ||
                exam.status === "open" ||
                exam.status === "closed") && (
                <ConfirmDialog
                  trigger={
                    <Button
                      data-testid="exam-detail-publish-results-btn"
                      disabled={releasing}
                    >
                      {releasing
                        ? t("admin.examDetail.actions.publishResultsLoading")
                        : t("admin.examDetail.actions.publishResults")}
                    </Button>
                  }
                  title={t("admin.examDetail.confirm.publishResultsTitle")}
                  description={t(
                    "admin.examDetail.confirm.publishResultsDescription",
                    { title: exam.title },
                  )}
                  onConfirm={() => void handlePublishResults()}
                />
              )}
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/exams")}
            >
              {t("admin.examDetail.actions.backToList")}
            </Button>
          </div>
        }
      />

      {publishError && <InlineErrorBanner>{publishError}</InlineErrorBanner>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label={t("admin.examDetail.stats.status")}
          value={<StatusBadge status={exam.status} />}
        />
        <StatsCard
          label={t("admin.examDetail.stats.duration")}
          value={
            /* Projection keys on the canonical timingMode — null duration is
             * real for deadline/untimed and must never render as a fabricated
             * duration (same narrowing as StartExamPage). */
            exam.timingMode === "untimed"
              ? t("admin.examDetail.stats.noDuration")
              : exam.timingMode === "deadline"
                ? t("admin.examDetail.stats.deadlineMode")
                : exam.durationMinutes !== null
                  ? t("admin.examDetail.stats.durationValue", {
                      minutes: exam.durationMinutes,
                    })
                  : t("admin.examDetail.stats.deadlineMode")
          }
        />
        <StatsCard
          label={t("admin.examDetail.stats.passingScore")}
          value={`${exam.passingScore}/${exam.totalScore}`}
        />
        <StatsCard
          label={t("admin.examDetail.stats.questionCount")}
          value={exam.questionIds.length}
        />
      </div>

      <PageSection title={t("admin.examDetail.config.title")}>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="type-secondary">
            {t("admin.examDetail.config.timingMode")}
          </span>
          <span>{labelFor(policyLabels.timingMode)(exam.timingMode)}</span>
          <span className="type-secondary">
            {t("admin.examDetail.config.retakePolicy")}
          </span>
          <span>{labelFor(policyLabels.retakePolicy)(exam.retakePolicy)}</span>
          <span className="type-secondary">
            {t("admin.examDetail.config.scoreStrategy")}
          </span>
          <span>
            {labelFor(policyLabels.scoreStrategy)(exam.scoreStrategy)}
          </span>
          <span className="type-secondary">
            {t("admin.examDetail.config.maxAttempts")}
          </span>
          <span>{exam.maxAttempts}</span>
          <span className="type-secondary">
            {t("admin.examDetail.config.startTime")}
          </span>
          <span>{formatDateTime(exam.openAt)}</span>
          <span className="type-secondary">
            {t("admin.examDetail.config.endTime")}
          </span>
          {/* closeAt is null for untimed exams; formatting null would render
           * an epoch timestamp. "—" matches the RecoveryExamDetailPage
           * missing-timestamp convention. */}
          <span>
            {exam.closeAt === null ? "—" : formatDateTime(exam.closeAt)}
          </span>
        </div>
      </PageSection>

      <Tabs defaultValue="enrollment">
        <TabsList>
          <TabsTrigger value="enrollment">
            {t("admin.examDetail.tabs.enrollment")}
          </TabsTrigger>
          <TabsTrigger value="scores">
            {t("admin.examDetail.tabs.scores")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="enrollment" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatsCard
              label={t("admin.examDetail.stats.participantCount")}
              value={exam.stats.participantCount}
            />
            <StatsCard
              label={t("admin.examDetail.stats.completedCount")}
              value={exam.stats.completedCount}
            />
            <StatsCard
              label={t("admin.examDetail.stats.passedCount")}
              value={exam.stats.passedCount}
            />
          </div>

          <PageSection
            title={t("admin.examDetail.enrollment.title")}
            actions={
              mayManageEnrollments && (
                <Button size="sm" onClick={handleOpenAddDialog}>
                  <AppIcon icon={Plus} size="inline" />
                  {t("admin.examDetail.enrollment.addCandidate")}
                </Button>
              )
            }
          >
            {enrollments.length === 0 ? (
              <EmptyState
                icon={<AppIcon icon={Users} size="state" />}
                title={t("admin.examDetail.enrollment.emptyTitle")}
                description={t("admin.examDetail.enrollment.emptyDescription")}
              />
            ) : (
              <DataTableShell contentClassName="p-0">
                <Table>
                  <DataTableColumns
                    columns={[
                      { role: "short-id" },
                      { role: "primary-text" },
                      { role: "status" },
                      { role: "number" },
                      { role: "score" },
                      { role: "actions" },
                    ]}
                  />
                  <TableHeader>
                    <TableRow>
                      <DataTableHead role="short-id">
                        {t("admin.examDetail.enrollment.columns.identity")}
                      </DataTableHead>
                      <DataTableHead role="primary-text">
                        {t("admin.examDetail.enrollment.columns.name")}
                      </DataTableHead>
                      <DataTableHead role="status">
                        {t("admin.examDetail.enrollment.columns.status")}
                      </DataTableHead>
                      <DataTableHead role="number">
                        {t("admin.examDetail.enrollment.columns.attemptCount")}
                      </DataTableHead>
                      <DataTableHead role="score">
                        {t("admin.examDetail.enrollment.columns.score")}
                      </DataTableHead>
                      <DataTableHead role="actions">
                        {t("admin.examDetail.enrollment.columns.actions")}
                      </DataTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <DataTableCell role="short-id">
                          {/* Prefer the configured CandidateField-derived
                           * identity; never fall back to a truncated internal
                           * candidateId (unfriendly + leaks an impl detail).
                           * "-" matches the missing-value convention used by
                           * finalScore etc. in this table. */}
                          {enrollment.candidateIdentity ?? "-"}
                        </DataTableCell>
                        <DataTableCell role="primary-text">
                          {enrollment.candidateDisplayName}
                        </DataTableCell>
                        <DataTableCell role="status">
                          <StatusBadge status={enrollment.status} />
                        </DataTableCell>
                        <DataTableCell role="number">
                          {enrollment.attemptCount}
                        </DataTableCell>
                        <DataTableCell role="score">
                          {enrollment.finalScore ?? "-"}
                        </DataTableCell>
                        <DataTableCell role="actions">
                          <RowActions
                            row={enrollment}
                            actions={
                              mayManageEnrollments &&
                              enrollment.status === "assigned"
                                ? [
                                    {
                                      id: "remove-candidate",
                                      label: t(
                                        "admin.examDetail.confirm.removeCandidate",
                                      ),
                                      icon: Trash2,
                                      tone: "destructive",
                                      confirm: {
                                        title: t(
                                          "admin.examDetail.confirm.removeTitle",
                                        ),
                                        description: t(
                                          "admin.examDetail.confirm.removeDescription",
                                          {
                                            name: enrollment.candidateDisplayName,
                                          },
                                        ),
                                        destructive: true,
                                      },
                                      onSelect: () =>
                                        void handleRemoveEnrollment(
                                          enrollment.id,
                                        ),
                                    },
                                  ]
                                : []
                            }
                          />
                        </DataTableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTableShell>
            )}
          </PageSection>
        </TabsContent>

        <TabsContent value="scores">
          <PageSection title={t("admin.examDetail.scoresTab.title")}>
            <p className="type-secondary mb-4">
              {t("admin.examDetail.scoresTab.description")}
            </p>
            <Button
              variant="outline"
              onClick={() => void navigate(`/admin/exams/${id}/scores`)}
            >
              {t("admin.examDetail.scoresTab.goToScores")}
            </Button>
          </PageSection>
        </TabsContent>
      </Tabs>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.examDetail.addDialog.title")}</DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="type-secondary py-4 text-center">
              {t("admin.examDetail.addDialog.emptyCandidates")}
            </p>
          ) : (
            <EnrollmentPicker
              candidates={candidates}
              enrolledCandidateIds={
                new Set(enrollments.map((e) => e.candidateId))
              }
              selectedIds={selectedCandidateIds}
              onSelectionChange={setSelectedCandidateIds}
              hasMore={candidates.length < candidateTotal}
              onLoadMore={() => void handleLoadMoreCandidates()}
              isLoadingMore={loadingMoreCandidates}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              {t("admin.examDetail.addDialog.cancel")}
            </Button>
            <Button
              onClick={() => void handleAddEnrollments()}
              disabled={addingEnrollment || selectedCandidateIds.size === 0}
            >
              {addingEnrollment
                ? t("admin.examDetail.addDialog.adding")
                : t("admin.examDetail.addDialog.add", {
                    count: selectedCandidateIds.size,
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.examDetail.extendDialog.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">
              {t("admin.examDetail.extendDialog.minutesLabel")}
            </Label>
            <Input
              id="extend-minutes"
              type="number"
              min={1}
              value={extendMinutes}
              onChange={(e) =>
                setExtendMinutes(Number.parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtendDialogOpen(false)}
            >
              {t("admin.examDetail.extendDialog.cancel")}
            </Button>
            <Button
              data-testid="extend-confirm-btn"
              disabled={extending || extendMinutes <= 0}
              onClick={() => void handleExtend()}
            >
              {extending
                ? t("admin.examDetail.extendDialog.confirming")
                : t("admin.examDetail.extendDialog.confirm", {
                    minutes: extendMinutes,
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
