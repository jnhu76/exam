import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { FileUpload } from "@/components/shared/FileUpload";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { ToolbarFilter } from "@/components/shared/DataToolbar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { getTypeLabelKey } from "@/lib/constants";

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
  const { t } = useTranslation();
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
      setError(t("admin.questionImport.errors.loadCoursesFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

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
   * NOTE: `"是"` here is a CSV answer-parsing alias for boolean true, NOT UI
   * copy — it is part of the import compatibility contract and must not be
   * moved to i18n.
   */
  function parseStandardAnswer(answer: string, type: string): unknown {
    if (type === "true_false") {
      // i18n-copy-allow: data-format — CSV template headers, parser tokens, example rows
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
      setError(t("admin.questionImport.errors.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  /**
   * Downloads a sample CSV template file with example question rows.
   * NOTE: the template header and example cells are CSV import content, NOT
   * UI copy — they define the import column contract the parser understands
   * (see parseCSV/parseStandardAnswer). They must stay in sync with the
   * import parser and are excluded from the hardcoded-copy lint.
   */
  function downloadTemplate() {
    // CSV template header — import column contract (not UI copy).
    const header =
      // i18n-copy-allow: data-format — CSV template headers, parser tokens, example rows
      "题型,题目内容,选项A,选项B,选项C,选项D,标准答案,分值,难度,标签";
    // CSV template example rows (fixture content, not UI copy).
    // i18n-copy-allow: data-format — CSV template headers, parser tokens, example rows
    const example1 = "single_choice,1+1=?,1,2,3,4,B,10,1,基础";
    // i18n-copy-allow: data-format — CSV template headers, parser tokens, example rows
    const example2 = "true_false,地球是圆的,,,,,true,5,1,常识";
    // i18n-copy-allow: data-format — CSV template headers, parser tokens, example rows
    const example3 = "fill_blank,法国首都____,,,,,巴黎,10,2,地理";
    const csv = [header, example1, example2, example3].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = t("admin.questionImport.templateFilename");
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadCourses} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.questionImport.title")} />

      {/* flex-wrap: course select + template/download actions exceed narrow
          viewports as one nowrap row. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label>{t("admin.questionImport.courseLabel")}</Label>
          <Select value={selectedCourse} onValueChange={setSelectedCourse}>
            <ToolbarFilter size="wide">
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.questionImport.coursePlaceholder")}
                />
              </SelectTrigger>
            </ToolbarFilter>
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
          {t("admin.questionImport.downloadTemplate")}
        </Button>

        <FileUpload onText={loadCsv} />
      </div>

      {parsedRows.length > 0 && !importResult && (
        <>
          <DataTableShell
            title={t("admin.questionImport.parsed", {
              count: parsedRows.length,
            })}
          >
            <Table>
              <DataTableColumns
                columns={[
                  { role: "number" },
                  { role: "type" },
                  { role: "long-text" },
                  { role: "score" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="number">
                    {t("admin.questionImport.previewColumns.row")}
                  </DataTableHead>
                  <DataTableHead role="type">
                    {t("admin.questionImport.previewColumns.type")}
                  </DataTableHead>
                  <DataTableHead role="long-text">
                    {t("admin.questionImport.previewColumns.content")}
                  </DataTableHead>
                  <DataTableHead role="score">
                    {t("admin.questionImport.previewColumns.score")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.slice(0, 20).map((row, i) => (
                  <TableRow key={i}>
                    <DataTableCell role="number">{i + 1}</DataTableCell>
                    <DataTableCell role="type">
                      <Badge variant="outline">
                        {(getTypeLabelKey(row.type)
                          ? t(getTypeLabelKey(row.type) as never)
                          : undefined) ?? row.type}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell role="long-text" className="truncate">
                      {row.content}
                    </DataTableCell>
                    <DataTableCell role="score">{row.score}</DataTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
          {parsedRows.length > 20 && (
            <p className="type-secondary">
              {t("admin.questionImport.moreRows", {
                count: parsedRows.length - 20,
              })}
            </p>
          )}
          <Button onClick={() => void handleImport(false)} disabled={importing}>
            {importing
              ? t("admin.questionImport.validating")
              : t("admin.questionImport.validate")}
          </Button>
        </>
      )}

      {importResult && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <AppIcon
                icon={CircleCheck}
                size="inline"
                className="text-success"
              />
              {t("admin.questionImport.result.valid")}：{importResult.valid}
            </span>
            <span className="flex items-center gap-1">
              <AppIcon
                icon={CircleAlert}
                size="inline"
                className="text-warning"
              />
              {t("admin.questionImport.result.warnings")}：
              {importResult.warnings}
            </span>
            <span className="flex items-center gap-1">
              <AppIcon
                icon={CircleX}
                size="inline"
                className="text-destructive"
              />
              {t("admin.questionImport.result.errors")}：{importResult.errors}
            </span>
          </div>

          <DataTableShell
            title={t("admin.questionImport.previewColumns.detail")}
          >
            <Table>
              <DataTableColumns
                columns={[
                  { role: "number" },
                  { role: "status" },
                  { role: "long-text" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="number">
                    {t("admin.questionImport.previewColumns.row")}
                  </DataTableHead>
                  <DataTableHead role="status">
                    {t("admin.questionImport.previewColumns.status")}
                  </DataTableHead>
                  <DataTableHead role="long-text">
                    {t("admin.questionImport.previewColumns.detail")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importResult.details.map((d) => (
                  <TableRow key={d.row}>
                    <DataTableCell role="number">{d.row}</DataTableCell>
                    <DataTableCell role="status">
                      {d.status === "valid" && (
                        <AppIcon
                          icon={CircleCheck}
                          size="inline"
                          className="text-success"
                        />
                      )}
                      {d.status === "warning" && (
                        <AppIcon
                          icon={CircleAlert}
                          size="inline"
                          className="text-warning"
                        />
                      )}
                      {d.status === "error" && (
                        <AppIcon
                          icon={CircleX}
                          size="inline"
                          className="text-destructive"
                        />
                      )}
                    </DataTableCell>
                    <DataTableCell role="long-text" className="type-secondary">
                      {d.message ?? "-"}
                    </DataTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>

          <div className="flex gap-3">
            {!confirmed && importResult.errors === 0 && (
              <Button
                onClick={() => void handleImport(true)}
                disabled={importing}
              >
                {importing
                  ? t("admin.questionImport.importing")
                  : t("admin.questionImport.confirm")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions")}
            >
              {t("admin.questionImport.backToList")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setParsedRows([]);
                setImportResult(null);
                setConfirmed(false);
              }}
            >
              {t("admin.questionImport.continueImport")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
