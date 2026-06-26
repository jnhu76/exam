import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import { DatePicker } from "@/components/shared/DatePicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScrollText, X } from "lucide-react";

interface AuditLogItem {
  id: string;
  organizationId: string;
  actorId: string;
  actorName?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ACTION_FILTERS = [
  { value: "all", label: "全部操作" },
  // 考试
  { value: "exam.create", label: "创建考试" },
  { value: "exam.update", label: "更新考试" },
  { value: "exam.publish", label: "发布考试" },
  { value: "exam.open", label: "开放考试" },
  { value: "exam.close", label: "关闭考试" },
  { value: "exam.closed", label: "关闭考试（自动）" },
  { value: "exam.unpublish", label: "撤销发布" },
  { value: "exam.extend", label: "延长时间" },
  { value: "exam.cancel", label: "取消考试" },
  { value: "exam.archive", label: "归档考试" },
  { value: "exam.publish_results", label: "公布成绩" },
  { value: "exam.delete", label: "删除考试" },
  // 答题
  { value: "attempt.start", label: "开始答题" },
  { value: "attempt.restore", label: "恢复答题" },
  { value: "attempt.saveAnswer", label: "保存答案" },
  { value: "attempt.submit", label: "提交答卷" },
  { value: "attempt.autoSubmit", label: "自动提交" },
  { value: "attempt.disrupted", label: "答题中断" },
  { value: "attempt.misconductFlagged", label: "标记违纪" },
  { value: "attempt.forceSubmit", label: "强制提交" },
  { value: "attempt.extendTime", label: "延时" },
  { value: "attempt.exported", label: "导出答卷" },
  // 评分
  { value: "grading.score_entered", label: "评分录入" },
  { value: "grading.finalized", label: "评分完成" },
  // 考生
  { value: "candidate.create", label: "创建考生" },
  { value: "candidate.update", label: "更新考生" },
  { value: "candidate.import", label: "导入考生" },
  { value: "candidate.password_reset", label: "考生重置密码" },
  // 考生字段
  { value: "candidate_field.create", label: "创建考生字段" },
  { value: "candidate_field.update", label: "更新考生字段" },
  { value: "candidate_field.delete", label: "删除考生字段" },
  // 题目
  { value: "question.create", label: "创建题目" },
  { value: "question.update", label: "更新题目" },
  { value: "question.delete", label: "删除题目" },
  { value: "question.import", label: "导入题目" },
  // 课程
  { value: "course.create", label: "创建课程" },
  { value: "course.update", label: "更新课程" },
  { value: "course.delete", label: "删除课程" },
  // 报名
  { value: "enrollment.add", label: "添加报名" },
  { value: "enrollment.remove", label: "移除报名" },
  // 用户
  { value: "user.create", label: "创建用户" },
  { value: "user.update", label: "更新用户" },
  { value: "user.delete", label: "删除用户" },
  // 认证
  { value: "login.success", label: "登录成功" },
  { value: "login.failure", label: "登录失败" },
  { value: "logout", label: "登出" },
  // 其他
  { value: "export_scores", label: "导出成绩" },
  { value: "branding.update", label: "更新品牌" },
  { value: "admin.bootstrap", label: "管理员引导" },
  { value: "admin.password_reset.local", label: "本地重置密码" },
];

const TARGET_FILTERS = [
  { value: "all", label: "全部目标" },
  { value: "attempt", label: "答卷" },
  { value: "exam", label: "考试" },
  { value: "user", label: "用户" },
  { value: "enrollment", label: "报名" },
  { value: "organization", label: "组织" },
];

/** ISO datetime for the start (00:00:00.000) of the given date, local time. */
function startOfDayISO(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO datetime for the end (23:59:59.999) of the given date, local time. */
function endOfDayISO(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function AuditLogPage() {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  const handleDateChange = useCallback(
    (newDate: Date | undefined, isStartDate: boolean) => {
      if (isStartDate && newDate && toDate && newDate > toDate) {
        setFromDate(toDate);
        setToDate(newDate);
      } else if (!isStartDate && newDate && fromDate && newDate < fromDate) {
        setToDate(fromDate);
        setFromDate(newDate);
      } else if (isStartDate) {
        setFromDate(newDate);
      } else {
        setToDate(newDate);
      }
      setPage(1);
    },
    [fromDate, toDate],
  );

  const hasActiveFilter =
    actionFilter !== "all" ||
    targetFilter !== "all" ||
    fromDate !== undefined ||
    toDate !== undefined;

  const clearFilters = useCallback(() => {
    setActionFilter("all");
    setTargetFilter("all");
    setFromDate(undefined);
    setToDate(undefined);
    setPage(1);
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (targetFilter !== "all") params.set("targetType", targetFilter);
      // Date bounds: inclusive on the server. `from` is the start-of-day of the
      // picked date; `to` is pushed to end-of-day so the same day is included.
      if (fromDate) params.set("from", startOfDayISO(fromDate));
      if (toDate) params.set("to", endOfDayISO(toDate));
      const result = await api.get<AuditLogResponse>(
        `/api/admin/audit-logs?${params}`,
      );
      setData(result);
    } catch {
      setError("加载审计日志失败");
    } finally {
      setIsLoading(false);
    }
  }, [page, actionFilter, targetFilter, fromDate, toDate]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const items = data?.items ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadLogs} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="审计日志" description="查看系统操作审计记录" />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={actionFilter}
          onValueChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]" aria-label="全部操作">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={targetFilter}
          onValueChange={(v) => {
            setTargetFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]" aria-label="全部目标">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DatePicker
          aria-label="开始日期"
          placeholder="开始日期"
          value={fromDate}
          onChange={(d) => handleDateChange(d, true)}
        />
        <DatePicker
          aria-label="结束日期"
          placeholder="结束日期"
          value={toDate}
          onChange={(d) => handleDateChange(d, false)}
        />
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            <X className="mr-1 size-4" />
            清空筛选
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-8" />}
          title="暂无审计日志"
          description="系统操作将自动记录在此"
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作者</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>目标类型</TableHead>
                  <TableHead>目标 ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === item.id ? null : item.id)
                    }
                  >
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.actorName ?? item.actorId}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground">
                        {item.action}
                      </span>
                    </TableCell>
                    <TableCell>{item.targetType}</TableCell>
                    <TableCell className="max-w-[120px] truncate text-sm text-muted-foreground">
                      {item.targetId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {expandedId &&
            (() => {
              const item = items.find((i) => i.id === expandedId);
              if (!item) return null;
              return (
                <div className="rounded-md border p-4">
                  <h3 className="mb-2 text-sm font-medium">元数据</h3>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(item.metadata, null, 2)}
                  </pre>
                  {item.ipAddress && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      IP: {item.ipAddress}
                    </p>
                  )}
                </div>
              );
            })()}
          {data && (
            <DataTablePagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
