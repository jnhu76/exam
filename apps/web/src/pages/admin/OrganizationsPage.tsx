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

interface OrgRow {
  id: string;
  name: string;
  displayName: string;
  slug: string;
}

export function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<OrgRow[]>("/api/organizations");
      setOrgs(data);
    } catch {
      setError("加载机构列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadOrgs} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="机构管理"
        actions={
          <Button onClick={() => {}} data-testid="create-org-btn">
            新增机构
          </Button>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>显示名</TableHead>
            <TableHead>标识</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((org) => (
            <TableRow key={org.id}>
              <TableCell>{org.name}</TableCell>
              <TableCell>{org.displayName}</TableCell>
              <TableCell>{org.slug}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
