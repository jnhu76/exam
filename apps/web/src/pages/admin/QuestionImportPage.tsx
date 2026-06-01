import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, XCircle, Upload } from "lucide-react";

interface CourseRow {
  id: string;
  name: string;
  code: string;
}

interface ImportRow {
  type: string;
  content: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  standardAnswer: unknown;
  score: number;
  difficulty?: number;
  tags?: string;
}

interface ImportResult {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  details: Array<{
    row: number;
    status: "valid" | "warning" | "error";
    message?: string;
  }>;
}

const typeLabels: Record<string, string> = {
  single_choice: "单选",
  multiple_choice: "多选",
  fill_blank: "填空",
  true_false: "判断",
};

export function QuestionImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<{ items: CourseRow[] }>("/api/courses");
      setCourses(data.items);
      if (data.items.length > 0) {
        const first = data.items[0];
        if (first) setSelectedCourse(first.id);
      }
    } catch {
      setError("加载课程列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);
      setParsedRows(rows);
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  function parseCSV(text: string): ImportRow[] {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];

    const rows: ImportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCSVLine(line);
      if (cols.length < 4) continue;

      rows.push({
        type: cols[0] ?? "",
        content: cols[1] ?? "",
        optionA: cols[2] || undefined,
        optionB: cols[3] || undefined,
        optionC: cols[4] || undefined,
        optionD: cols[5] || undefined,
        standardAnswer: parseStandardAnswer(cols[6] ?? "", cols[0] ?? ""),
        score: Number(cols[7]) || 10,
        difficulty: cols[8] ? Number(cols[8]) : undefined,
        tags: cols[9] || undefined,
      });
    }
    return rows;
  }

  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function parseStandardAnswer(answer: string, type: string): unknown {
    if (type === "true_false") {
      return answer.toLowerCase() === "true" || answer === "是";
    }
    if (type === "multiple_choice") {
      return answer.split(/[,，]/).map((s) => s.trim());
    }
    return answer;
  }

  async function handleImport() {
    if (!selectedCourse || parsedRows.length === 0) return;
    setImporting(true);
    try {
      const result = await api.post<ImportResult>("/api/questions/import", {
        courseId: selectedCourse,
        rows: parsedRows,
      });
      setImportResult(result);
    } catch {
      setError("导入失败");
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const header =
      "题型,题目内容,选项A,选项B,选项C,选项D,标准答案,分值,难度,标签";
    const example1 = "single_choice,1+1=?,1,2,3,4,2,10,1,基础";
    const example2 = "true_false,地球是圆的,,,,,true,5,1,常识";
    const example3 = "fill_blank,法国首都____,,,,,巴黎,10,2,地理";
    const csv = [header, example1, example2, example3].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "题目导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadCourses} />;

  return (
    <div className="space-y-6">
      <PageHeader title="导入题目" />

      <div className="flex items-end gap-4">
        <div className="space-y-2">
          <Label>目标课程</Label>
          <Select value={selectedCourse} onValueChange={setSelectedCourse}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="选择课程" />
            </SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" onClick={downloadTemplate}>
          下载模板
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="size-4" />
          选择文件
        </Button>
      </div>

      {parsedRows.length > 0 && !importResult && (
        <>
          <div className="text-sm text-muted-foreground">
            已解析 {parsedRows.length} 条数据
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">行号</TableHead>
                <TableHead className="w-16">题型</TableHead>
                <TableHead>题目内容</TableHead>
                <TableHead className="w-16">分值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedRows.slice(0, 20).map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {typeLabels[row.type] ?? row.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[400px] truncate">
                    {row.content}
                  </TableCell>
                  <TableCell>{row.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {parsedRows.length > 20 && (
            <p className="text-sm text-muted-foreground">
              ...还有 {parsedRows.length - 20} 条数据
            </p>
          )}
          <Button onClick={() => void handleImport()} disabled={importing}>
            {importing ? "导入中..." : "确认导入"}
          </Button>
        </>
      )}

      {importResult && (
        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-4 text-green-500" />
              有效：{importResult.valid}
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="size-4 text-yellow-500" />
              警告：{importResult.warnings}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="size-4 text-red-500" />
              错误：{importResult.errors}
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">行号</TableHead>
                <TableHead className="w-16">状态</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importResult.details.map((d) => (
                <TableRow key={d.row}>
                  <TableCell>{d.row}</TableCell>
                  <TableCell>
                    {d.status === "valid" && (
                      <CheckCircle2 className="size-4 text-green-500" />
                    )}
                    {d.status === "warning" && (
                      <AlertCircle className="size-4 text-yellow-500" />
                    )}
                    {d.status === "error" && (
                      <XCircle className="size-4 text-red-500" />
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.message ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions")}
            >
              返回题目列表
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setParsedRows([]);
                setImportResult(null);
              }}
            >
              继续导入
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
