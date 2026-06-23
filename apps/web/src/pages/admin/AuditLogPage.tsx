import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
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
import { ScrollText } from "lucide-react";

interface AuditLogItem {
  id: string;
  organizationId: string;
  actorId: string;
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
  { value: "grading.score_entered", label: "评分录入" },
  { value: "grading.finalized", label: "评分完成" },
  { value: "exam.publish_results", label: "公布成绩" },
  { value: "exam.create", label: "创建考试" },
  { value: "exam.publish", label: "发布考试" },
  { value: "attempt.submit", label: "提交答卷" },
  { value: "login.success", label: "登录成功" },
  { value: "user.create", label: "创建用户" },
];

const TARGET_FILTERS = [
  { value: "all", label: "全部目标" },
  { value: "attempt", label: "答卷" },
  { value: "exam", label: "考试" },
  { value: "user", label: "用户" },
  { value: "enrollment", label: "报名" },
  { value: "organization", label: "组织" },
];

export function AuditLogPage() {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter !== "all") params.set("action", actionFilter);
      const result = await api.get<AuditLogResponse>(
        `/api/admin/audit-logs?${params}`,
      );
      setData(result);
    } catch {
      setError("加载审计日志失败");
    } finally {
      setIsLoading(false);
    }
  }, [page, actionFilter, targetFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filteredItems =
    data?.items.filter(
      (item) => targetFilter === "all" || item.targetType === targetFilter,
    ) ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadLogs} />;
  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="审计日志" description="查看系统操作审计记录" />
        <EmptyState
          icon={<ScrollText className="size-8" />}
          title="暂无审计日志"
          description="系统操作将自动记录在此"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="审计日志" description="查看系统操作审计记录" />
      <div className="flex items-center gap-3">
        <Select
          value={actionFilter}
          onValueChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
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
          <SelectTrigger className="w-[150px]">
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
      </div>
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
            {filteredItems.map((item) => (
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
                <TableCell className="font-medium">{item.actorId}</TableCell>
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
          const item = filteredItems.find((i) => i.id === expandedId);
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
      <DataTablePagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPageChange={setPage}
      />
    </div>
  );
}
