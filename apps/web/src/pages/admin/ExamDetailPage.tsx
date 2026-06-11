import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { STATUS_LABELS } from "@/lib/constants";

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

export function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
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

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExam} />;
  if (!exam) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={exam.title}
        actions={
          <div className="flex gap-2">
            {exam.status === "draft" && (
              <Button
                onClick={() => void handlePublish()}
                disabled={publishing}
              >
                {publishing ? "发布中..." : "发布考试"}
              </Button>
            )}
            {(exam.status === "published" || exam.status === "closed") && (
              <Button
                variant="outline"
                onClick={() => void handleArchive()}
                disabled={archiving}
              >
                {archiving ? "归档中..." : "归档"}
              </Button>
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
            <Badge>{STATUS_LABELS[exam.status] ?? exam.status}</Badge>
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
          <TabsTrigger value="audit">操作日志</TabsTrigger>
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
                        <TableCell>{enrollment.status}</TableCell>
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

        <TabsContent value="audit">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">操作日志</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={<Users className="size-8" />}
                title="功能开发中"
                description="操作日志功能将在后续版本中提供。"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
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
    </div>
  );
}
