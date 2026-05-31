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

interface CandidateFieldRow {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
  unique: boolean;
  sortOrder: number;
}

export function CandidateFieldsPage() {
  const [fields, setFields] = useState<CandidateFieldRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFields = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<CandidateFieldRow[]>("/api/candidate-fields");
      setFields(data);
    } catch {
      setError("加载字段配置失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFields();
  }, [loadFields]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadFields} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="考生字段配置"
        actions={<Button onClick={() => {}}>添加字段</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>字段名</TableHead>
            <TableHead>标签</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>必填</TableHead>
            <TableHead>唯一</TableHead>
            <TableHead>排序</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => (
            <TableRow key={field.id}>
              <TableCell>{field.name}</TableCell>
              <TableCell>{field.label}</TableCell>
              <TableCell>{field.fieldType}</TableCell>
              <TableCell>{field.required ? "是" : "否"}</TableCell>
              <TableCell>{field.unique ? "是" : "否"}</TableCell>
              <TableCell>{field.sortOrder}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
