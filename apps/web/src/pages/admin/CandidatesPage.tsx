import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CandidateRow {
  id: string;
  userId: string;
  fields: Record<string, unknown>;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data =
        await api.get<PaginatedResponse<CandidateRow>>("/api/candidates");
      setCandidates(data.items);
    } catch {
      setError("加载考生列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadCandidates} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="考生管理"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => {}}>新增考生</Button>
            <Button variant="outline" onClick={() => {}}>
              导入
            </Button>
          </div>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>用户ID</TableHead>
            <TableHead>字段数据</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">
                {c.id.slice(0, 8)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {c.userId.slice(0, 8)}
              </TableCell>
              <TableCell>
                {Object.entries(c.fields)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
