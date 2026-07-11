import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/** Full exam detail including stats and participant list. */
/** Full exam detail including configuration, statistics, and participant summaries. */
interface ExamDetail {
  id: string;
  title: string;
  description: string;
  courseId: string;
  status: string;
  timingMode: string;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  controlFlags: Record<string, unknown>;
  retakePolicy: string;
  scoreStrategy: string;
  maxAttempts: number;
  resultPublicationMode: "immediate" | "after_grading" | "manual";
  resultsPublishedAt: string | null;
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.addFailed"),
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
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.removeFailed"),
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
      const msg =
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.publishFailed");
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
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.publishResultsFailed"),
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
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.archiveFailed"),
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
        err instanceof Error
          ? err.message
          : t("admin.examDetail.errors.cancelFailed"),
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
            {exam.status === "draft" && (
              <Button
                variant="outline"
                onClick={() => void navigate(routes.admin.examEdit(id!))}
              >
                {t("admin.examDetail.actions.edit")}
              </Button>
            )}
            {exam.status === "draft" && (
              <Button
                onClick={() => void handlePublish()}
                disabled={publishing}
              >
                {publishing
                  ? t("admin.examDetail.actions.publishing")
                  : t("admin.examDetail.actions.publish")}
              </Button>
            )}
            {exam.status === "open" && (
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
            {exam.status === "open" && (
              <Button
                data-testid="exam-detail-extend-btn"
                variant="outline"
                onClick={() => setExtendDialogOpen(true)}
              >
                {t("admin.examDetail.actions.extend")}
              </Button>
            )}
            {exam.status === "open" && (
              <Button
                variant="outline"
                onClick={() => void navigate(`/admin/exams/${id}/proctor`)}
              >
                {t("admin.examDetail.actions.proctor")}
              </Button>
            )}
            {exam.status === "published" && (
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
            {(exam.status === "published" || exam.status === "closed") && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={archiving}>
                    {archiving
                      ? t("admin.examDetail.actions.archiving")
                      : t("admin.examDetail.actions.archive")}
                  </Button>
                }
                title={t("admin.examDetail.confirm.archiveTitle")}
                description={t("admin.examDetail.confirm.archiveDescription", {
                  title: exam.title,
                })}
                destructive
                onConfirm={() => void handleArchive()}
              />
            )}
            {(exam.status === "published" || exam.status === "open") && (
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
            {exam.resultPublicationMode === "manual" &&
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
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("admin.examDetail.stats.status")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={exam.status} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("admin.examDetail.stats.duration")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {t("admin.examDetail.stats.durationValue", {
                minutes: exam.durationMinutes,
              })}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("admin.examDetail.stats.passingScore")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {exam.passingScore}/{exam.totalScore}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("admin.examDetail.stats.questionCount")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.questionIds.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.examDetail.config.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.timingMode")}
            </span>
            <span>{exam.timingMode}</span>
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.retakePolicy")}
            </span>
            <span>{exam.retakePolicy}</span>
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.scoreStrategy")}
            </span>
            <span>{exam.scoreStrategy}</span>
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.maxAttempts")}
            </span>
            <span>{exam.maxAttempts}</span>
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.startTime")}
            </span>
            <span>{new Date(exam.openAt).toLocaleString()}</span>
            <span className="text-muted-foreground">
              {t("admin.examDetail.config.endTime")}
            </span>
            <span>{new Date(exam.closeAt).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

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
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {t("admin.examDetail.stats.participantCount")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {exam.stats.participantCount}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {t("admin.examDetail.stats.completedCount")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {exam.stats.completedCount}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {t("admin.examDetail.stats.passedCount")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{exam.stats.passedCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {t("admin.examDetail.enrollment.title")}
              </CardTitle>
              <Button size="sm" onClick={handleOpenAddDialog}>
                <Plus data-icon="inline-start" />
                {t("admin.examDetail.enrollment.addCandidate")}
              </Button>
            </CardHeader>
            <CardContent>
              {enrollments.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-8" />}
                  title={t("admin.examDetail.enrollment.emptyTitle")}
                  description={t(
                    "admin.examDetail.enrollment.emptyDescription",
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("admin.examDetail.enrollment.columns.identity")}
                      </TableHead>
                      <TableHead>
                        {t("admin.examDetail.enrollment.columns.name")}
                      </TableHead>
                      <TableHead>
                        {t("admin.examDetail.enrollment.columns.status")}
                      </TableHead>
                      <TableHead>
                        {t("admin.examDetail.enrollment.columns.attemptCount")}
                      </TableHead>
                      <TableHead>
                        {t("admin.examDetail.enrollment.columns.score")}
                      </TableHead>
                      <TableHead className="w-16">
                        {t("admin.examDetail.enrollment.columns.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell>
                          {enrollment.candidateIdentity ??
                            enrollment.candidateId.slice(0, 8)}
                        </TableCell>
                        <TableCell>{enrollment.candidateDisplayName}</TableCell>
                        <TableCell>
                          <StatusBadge status={enrollment.status} />
                        </TableCell>
                        <TableCell>{enrollment.attemptCount}</TableCell>
                        <TableCell>{enrollment.finalScore ?? "-"}</TableCell>
                        <TableCell>
                          {enrollment.status === "assigned" && (
                            <ConfirmDialog
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t(
                                    "admin.examDetail.confirm.removeCandidate",
                                  )}
                                >
                                  <Trash2 className="text-destructive" />
                                </Button>
                              }
                              title={t("admin.examDetail.confirm.removeTitle")}
                              description={t(
                                "admin.examDetail.confirm.removeDescription",
                                { name: enrollment.candidateDisplayName },
                              )}
                              destructive
                              onConfirm={() =>
                                void handleRemoveEnrollment(enrollment.id)
                              }
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scores">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                {t("admin.examDetail.scoresTab.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {t("admin.examDetail.scoresTab.description")}
              </p>
              <Button
                variant="outline"
                onClick={() => void navigate(`/admin/exams/${id}/scores`)}
              >
                {t("admin.examDetail.scoresTab.goToScores")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.examDetail.addDialog.title")}</DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
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
