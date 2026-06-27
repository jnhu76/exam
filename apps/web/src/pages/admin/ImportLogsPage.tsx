import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import {
  AdminShell,
  AdminShellHeader,
  AdminSearchPanel,
  AdminTableShell,
  AdminPageCard,
} from "@/components/admin";
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
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Upload } from "lucide-react";
import type { ImportJobLog, ImportLogListResponse } from "@exam/contracts";

type ImportLogResponse = ImportLogListResponse;

const TYPE_FILTERS = [
  { value: "all", label: "全部类型" },
  { value: "candidate", label: "考生导入" },
  { value: "question", label: "题目导入" },
];

const TYPE_LABELS: Record<string, string> = {
  candidate: "考生导入",
  question: "题目导入",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "完成", variant: "default" },
  partial: { label: "部分成功", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
};

export function ImportLogsPage() {
  const [data, setData] = useState<ImportLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  const hasActiveFilter = typeFilter !== "all";

  const clearFilters = useCallback(() => {
    setTypeFilter("all");
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
      if (typeFilter !== "all") params.set("type", typeFilter);
      const result = await api.get<ImportLogResponse>(
        `/api/admin/import-logs?${params}`,
      );
      setData(result);
    } catch {
      setError("加载导入日志失败");
    } finally {
      setIsLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const items = data?.items ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadLogs} />;
  if (!data || data.items.length === 0) {
    return (
      <AdminShell>
        <AdminShellHeader
          title="导入日志"
          description="查看考生和题目导入的历史记录"
        />
        <EmptyState
          icon={<Upload className="size-8" />}
          title="暂无导入日志"
          description="导入操作后将自动记录在此"
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <AdminShellHeader
        title="导入日志"
        description="查看考生和题目导入的历史记录"
      />
      <AdminSearchPanel>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]" aria-label="全部类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <RotateCcw data-icon="inline-start" />
            清空筛选
          </Button>
        )}
      </AdminSearchPanel>
      <AdminTableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>总数</TableHead>
              <TableHead>新增</TableHead>
              <TableHead>更新</TableHead>
              <TableHead>错误</TableHead>
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
                <TableCell>{TYPE_LABELS[item.type] ?? item.type}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_CONFIG[item.status]?.variant}>
                    {STATUS_CONFIG[item.status]?.label ?? item.status}
                  </Badge>
                </TableCell>
                <TableCell>{item.total}</TableCell>
                <TableCell>{item.createdCount}</TableCell>
                <TableCell>{item.updatedCount}</TableCell>
                <TableCell>{item.errors}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminTableShell>
      {expandedId &&
        (() => {
          const item = items.find((i) => i.id === expandedId);
          if (!item) return null;
          return (
            <AdminPageCard>
              {item.errorsDetail && item.errorsDetail.length > 0 && (
                <>
                  <h3 className="mb-2 text-sm font-medium">错误详情</h3>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(item.errorsDetail, null, 2)}
                  </pre>
                </>
              )}
              {Object.keys(item.metadata).length > 0 && (
                <>
                  <h3 className="mb-2 mt-3 text-sm font-medium">元数据</h3>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(item.metadata, null, 2)}
                  </pre>
                </>
              )}
            </AdminPageCard>
          );
        })()}
      <DataTablePagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPageChange={setPage}
      />
    </AdminShell>
  );
}
