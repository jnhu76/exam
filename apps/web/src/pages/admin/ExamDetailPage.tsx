import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
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
      setError("加载考试详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

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
      toast.error("加载考生列表失败");
    }
  }, [id]);

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
      toast.error("加载候选人列表失败");
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
      toast.error("加载更多候选人失败");
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
      toast.success("已添加考生");
      setAddDialogOpen(false);
      await loadEnrollments();
      await loadExam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加考生失败");
    } finally {
      setAddingEnrollment(false);
    }
  }

  /** Removes a single enrollment by id and refreshes the exam and enrollment data. */
  async function handleRemoveEnrollment(enrollmentId: string) {
    if (!id) return;
    try {
      await api.delete(`/api/exams/${id}/enrollments/${enrollmentId}`);
      toast.success("已移除考生");
      await loadEnrollments();
      await loadExam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除考生失败");
    }
  }

  /** Publishes the exam, making it available to enrolled candidates. */
  async function handlePublish() {
    if (!id || publishing) return;
    setPublishError(null);
    setPublishing(true);
    try {
      await api.post(`/api/exams/${id}/publish`);
      toast.success("考试发布成功");
      await loadExam();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "发布失败，请稍后重试";
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
      toast.success("考试已关闭");
      await loadExam();
    } catch (err) {
      toast.error("关闭失败，请稍后重试");
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
      toast.success("已撤回发布");
      await loadExam();
    } catch (err) {
      toast.error("撤回发布失败，请稍后重试");
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
      toast.success("成绩已发布");
      await loadExam();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "发布成绩失败，请稍后重试",
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
      toast.success(`已延长 ${extendMinutes} 分钟`);
      setExtendDialogOpen(false);
      await loadExam();
    } catch (err) {
      toast.error("延长失败，请稍后重试");
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
      toast.success("考试已归档");
      await loadExam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "归档失败，请稍后重试");
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
      toast.success("考试已取消");
      await loadExam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消失败，请稍后重试");
    } finally {
      setCanceling(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExam} />;
  if (!exam)
    return <ErrorState message="考试数据加载异常，请重试" onRetry={loadExam} />;

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
                编辑
              </Button>
            )}
            {exam.status === "draft" && (
              <Button
                onClick={() => void handlePublish()}
                disabled={publishing}
              >
                {publishing ? "发布中..." : "发布考试"}
              </Button>
            )}
            {exam.status === "open" && (
              <ConfirmDialog
                trigger={
                  <Button
                    data-testid="exam-detail-close-btn"
                    disabled={closing}
                  >
                    {closing ? "关闭中..." : "关闭考试"}
                  </Button>
                }
                title="确认关闭"
                description={`确定要关闭考试「${exam.title}」吗？关闭后将结束考试，考生无法再开始新的作答。`}
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
                延长时间
              </Button>
            )}
            {exam.status === "open" && (
              <Button
                variant="outline"
                onClick={() => void navigate(`/admin/exams/${id}/proctor`)}
              >
                监考
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
                    {unpublishing ? "撤回中..." : "撤回发布"}
                  </Button>
                }
                title="确认撤回发布"
                description={`确定要撤回考试「${exam.title}」的发布吗？撤回后将回到草稿状态，可以重新编辑。`}
                destructive
                onConfirm={() => void handleUnpublish()}
              />
            )}
            {(exam.status === "published" || exam.status === "closed") && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={archiving}>
                    {archiving ? "归档中..." : "归档"}
                  </Button>
                }
                title="确认归档"
                description={`确定要归档考试「${exam.title}」吗？归档后将从当前考试列表中移出。`}
                destructive
                onConfirm={() => void handleArchive()}
              />
            )}
            {(exam.status === "published" || exam.status === "open") && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={canceling}>
                    {canceling ? "取消中..." : "取消考试"}
                  </Button>
                }
                title="确认取消"
                description={`确定要取消考试「${exam.title}」吗？取消后已发布的考试将作废，此操作不可撤销。`}
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
                      {releasing ? "发布中..." : "发布成绩"}
                    </Button>
                  }
                  title="确认发布成绩"
                  description={`确定要发布考试「${exam.title}」的成绩吗？发布后考生将可以查看成绩。`}
                  onConfirm={() => void handlePublishResults()}
                />
              )}
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/exams")}
            >
              返回列表
            </Button>
          </div>
        }
      />

      {publishError && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {publishError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={exam.status} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              考试时长
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.durationMinutes}分钟</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              及格分
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
              题目数量
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{exam.questionIds.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">考试配置</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <span className="text-muted-foreground">时间模式：</span>
            <span>{exam.timingMode}</span>
            <span className="text-muted-foreground">重考策略：</span>
            <span>{exam.retakePolicy}</span>
            <span className="text-muted-foreground">分数策略：</span>
            <span>{exam.scoreStrategy}</span>
            <span className="text-muted-foreground">最大尝试次数：</span>
            <span>{exam.maxAttempts}</span>
            <span className="text-muted-foreground">开始时间：</span>
            <span>{new Date(exam.openAt).toLocaleString()}</span>
            <span className="text-muted-foreground">结束时间：</span>
            <span>{new Date(exam.closeAt).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="enrollment">
        <TabsList>
          <TabsTrigger value="enrollment">报考</TabsTrigger>
          <TabsTrigger value="scores">成绩</TabsTrigger>
        </TabsList>

        <TabsContent value="enrollment" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  参与人数
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
                  已完成
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
                  已通过
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{exam.stats.passedCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">考生资格</CardTitle>
              <Button size="sm" onClick={handleOpenAddDialog}>
                <Plus data-icon="inline-start" />
                添加考生
              </Button>
            </CardHeader>
            <CardContent>
              {enrollments.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-8" />}
                  title="暂无考生"
                  description="还没有为此考试分配考生。"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>身份信息</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>尝试次数</TableHead>
                      <TableHead>成绩</TableHead>
                      <TableHead className="w-16">操作</TableHead>
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
                                  aria-label="移除考生"
                                >
                                  <Trash2 className="text-destructive" />
                                </Button>
                              }
                              title="确认移除"
                              description={`确定要移除「${enrollment.candidateDisplayName}」吗？`}
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
              <CardTitle className="text-base">成绩管理</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                查看和导出考试成绩数据。
              </p>
              <Button
                variant="outline"
                onClick={() => void navigate(`/admin/exams/${id}/scores`)}
              >
                前往成绩管理
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加考生</DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              暂无可用候选人，请先在候选人管理中创建。
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
              取消
            </Button>
            <Button
              onClick={() => void handleAddEnrollments()}
              disabled={addingEnrollment || selectedCandidateIds.size === 0}
            >
              {addingEnrollment
                ? "添加中..."
                : `添加 (${selectedCandidateIds.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>延长考试时间</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">延长分钟数</Label>
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
              取消
            </Button>
            <Button
              data-testid="extend-confirm-btn"
              disabled={extending || extendMinutes <= 0}
              onClick={() => void handleExtend()}
            >
              {extending ? "延长中..." : `延长 ${extendMinutes} 分钟`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
