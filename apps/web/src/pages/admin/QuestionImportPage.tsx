import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FileUpload } from "@/components/shared/FileUpload";
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
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { TYPE_LABELS } from "@/lib/constants";

/** Minimal course representation used to populate the course selector. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** A single parsed row from the uploaded CSV file. */
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

/** Summary and per-row details returned by the import validation endpoint. */
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

/** Admin page for bulk-importing questions from a CSV file into a selected course. */
export function QuestionImportPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  /** Fetches the course list and selects the first course by default. */
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

  /** Parses raw CSV text into structured import rows and resets prior results. */
  function loadCsv(text: string) {
    setParsedRows(parseCSV(text));
    setImportResult(null);
    setConfirmed(false);
  }

  /**
   * Parses a CSV string into an array of {@link ImportRow} objects.
   * Expects a header row followed by data rows with at least 4 columns.
   */
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

  /**
   * Splits a single CSV line into columns, handling quoted fields and
   * escaped double-quotes per RFC 4180.
   */
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

  /**
   * Converts a raw answer string into the appropriate typed value based on
   * the question type (boolean for true/false, array for multiple-choice).
   */
  function parseStandardAnswer(answer: string, type: string): unknown {
    if (type === "true_false") {
      return answer.toLowerCase() === "true" || answer === "是";
    }
    if (type === "multiple_choice") {
      return answer.split(/[,，]/).map((s) => s.trim());
    }
    return answer;
  }

  /**
   * Submits the parsed rows to the import endpoint for validation or
   * confirmed insertion, and stores the result.
   */
  async function handleImport(confirm: boolean) {
    if (!selectedCourse || parsedRows.length === 0) return;
    setImporting(true);
    try {
      const result = await api.post<ImportResult>("/api/questions/import", {
        courseId: selectedCourse,
        rows: parsedRows,
        confirm,
      });
      setImportResult(result);
      setConfirmed(confirm);
    } catch {
      setError("导入失败");
    } finally {
      setImporting(false);
    }
  }

  /** Downloads a sample CSV template file with example question rows. */
  function downloadTemplate() {
    const header =
      "题型,题目内容,选项A,选项B,选项C,选项D,标准答案,分值,难度,标签";
    const example1 = "single_choice,1+1=?,1,2,3,4,B,10,1,基础";
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
    <div className="flex flex-col gap-6">
      <PageHeader title="导入题目" />

      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-2">
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

        <FileUpload onText={loadCsv} />
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
                      {TYPE_LABELS[row.type] ?? row.type}
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
          <Button onClick={() => void handleImport(false)} disabled={importing}>
            {importing ? "校验中..." : "校验导入数据"}
          </Button>
        </>
      )}

      {importResult && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-4 text-success" />
              有效：{importResult.valid}
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="size-4 text-warning" />
              警告：{importResult.warnings}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="size-4 text-destructive" />
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
                      <CheckCircle2 className="size-4 text-success" />
                    )}
                    {d.status === "warning" && (
                      <AlertCircle className="size-4 text-warning" />
                    )}
                    {d.status === "error" && (
                      <XCircle className="size-4 text-destructive" />
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
            {!confirmed && importResult.errors === 0 && (
              <Button
                onClick={() => void handleImport(true)}
                disabled={importing}
              >
                {importing ? "导入中..." : "确认导入"}
              </Button>
            )}
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
                setConfirmed(false);
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
