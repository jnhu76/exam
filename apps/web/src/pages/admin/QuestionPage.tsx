import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
  DataTableSpanCell,
} from "@/components/shared/DataTableContract";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/TagBadge";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  BookOpen,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { getTypeLabel, TYPE_VARIANT } from "@/lib/constants";

/** A question record for the admin question list table. */
interface QuestionRow {
  id: string;
  courseId: string;
  type: string;
  content: string;
  score: number;
  difficulty: number;
  tags: string[];
}

/** A course record used for course name lookup in the question table. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Admin question management page with server-side filtering by course, type,
 * difficulty, and tags, plus client-side search and pagination.
 *
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Structured filter toolbar, admin table,
 * numeric alignment, clear action column.
 */
export function QuestionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCourse, setFilterCourse] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("all");
  const [filterTags, setFilterTags] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const loadCourses = useCallback(async () => {
    try {
      const cData = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(cData.items);
    } catch {
      // courses are optional context — table can still render
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    setIsTableLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (filterCourse !== "all") params.set("courseId", filterCourse);
      if (filterType !== "all") params.set("type", filterType);
      if (filterDifficulty !== "all")
        params.set("difficulty", filterDifficulty);
      if (filterTags.trim()) params.set("tags", filterTags.trim());
      const qData = await api.get<PaginatedResponse<QuestionRow>>(
        `/api/questions?${params.toString()}`,
      );
      setQuestions(qData.items);
      setTotal(qData.total);
    } catch {
      setError(t("admin.common.loadFailed"));
    } finally {
      setIsTableLoading(false);
    }
  }, [filterCourse, filterDifficulty, filterTags, filterType, page]);

  useEffect(() => {
    let canceledFlag = false;
    async function init() {
      await loadCourses();
      if (!canceledFlag) setIsInitialLoading(false);
    }
    void init();
    return () => {
      canceledFlag = true;
    };
    // initial mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialLoading) return;
    void loadQuestions();
  }, [loadQuestions, isInitialLoading]);

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/questions/${id}`);
      await loadQuestions();
    } catch {
      toast.error(t("admin.questions.toast.deleteFailed"));
    }
  }

  const filtered = questions.filter((q) => {
    if (search && !q.content.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const courseMap = new Map(courses.map((c) => [c.id, c.name]));

  function clearFilters() {
    setFilterCourse("all");
    setFilterType("all");
    setFilterDifficulty("all");
    setFilterTags("");
    setSearch("");
    setPage(1);
  }

  const hasActiveFilter =
    filterCourse !== "all" ||
    filterType !== "all" ||
    filterDifficulty !== "all" ||
    filterTags.trim() !== "" ||
    search.trim() !== "";

  if (isInitialLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadQuestions} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.questions.title")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions/import")}
            >
              <AppIcon icon={FileUp} size="inline" />
              {t("admin.questions.importBtn")}
            </Button>
            <Button onClick={() => void navigate("/admin/questions/new")}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.questions.createBtn")}
            </Button>
          </div>
        }
      />

      <ListToolbar
        appearance="quiet"
        aria-label={t("admin.questions.filterToolbar")}
        filters={
          <>
            <Select
              value={filterCourse}
              onValueChange={(value) => {
                setFilterCourse(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-auto lg:w-[180px]">
                <SelectValue placeholder={t("admin.questions.filterCourse")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.questions.filterAllCourses")}
                </SelectItem>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterType}
              onValueChange={(value) => {
                setFilterType(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-auto lg:w-[150px]">
                <SelectValue placeholder={t("admin.questions.filterType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.questions.filterAllTypes")}
                </SelectItem>
                <SelectItem value="single_choice">
                  {t("admin.questions.questionTypes.single_choice")}
                </SelectItem>
                <SelectItem value="multiple_choice">
                  {t("admin.questions.questionTypes.multiple_choice")}
                </SelectItem>
                <SelectItem value="fill_blank">
                  {t("admin.questions.questionTypes.fill_blank")}
                </SelectItem>
                <SelectItem value="true_false">
                  {t("admin.questions.questionTypes.true_false")}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterDifficulty}
              onValueChange={(value) => {
                setFilterDifficulty(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-auto lg:w-[140px]">
                <SelectValue
                  placeholder={t("admin.questions.filterDifficulty")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.questions.filterAllDifficulties")}
                </SelectItem>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("admin.questions.difficultyLabel", { value })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="w-auto lg:w-[180px]"
              placeholder={t("admin.questions.tagPlaceholder")}
              value={filterTags}
              onChange={(e) => {
                setFilterTags(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
        search={
          <SearchInput
            aria-label={t("admin.questions.searchLabel")}
            placeholder={t("admin.questions.searchPlaceholder")}
            value={search}
            onChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel={t("admin.common.clearSearch")}
          />
        }
        actions={
          <>
            {isTableLoading && (
              <span
                className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                aria-live="polite"
              >
                <AppIcon
                  icon={LoaderCircle}
                  size="inline"
                  className="animate-spin"
                />
                {t("admin.common.loading")}
              </span>
            )}
            {hasActiveFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                aria-label={t("admin.common.clearFilter")}
              >
                <AppIcon icon={RotateCcw} size="inline" />
                {t("admin.questions.clearFilter")}
              </Button>
            )}
          </>
        }
      />

      {/*
        Shell + pagination render UNCONDITIONALLY. Previously the shell and
        the standalone EmptyState swapped in/out on filter changes, which
        threw the whole block's height between ~8rem (empty card) and the
        full table height — visible as a "the table jumps when I change a
        filter" jitter. Keeping the shell (with its header + column widths)
        always mounted stabilizes the layout; only the body content swaps.
      */}
      <DataTableShell>
        <Table>
          <DataTableColumns
            columns={[
              { role: "type" },
              { role: "long-text" },
              { role: "secondary-text" },
              { role: "score" },
              { role: "number" },
              { role: "tag-list" },
              { role: "actions" },
            ]}
          />
          <TableHeader>
            <TableRow>
              <DataTableHead role="type">
                {t("admin.questions.columns.type")}
              </DataTableHead>
              <DataTableHead role="long-text">
                {t("admin.questions.columns.content")}
              </DataTableHead>
              <DataTableHead role="secondary-text">
                {t("admin.questions.columns.course")}
              </DataTableHead>
              <DataTableHead role="score">
                {t("admin.questions.columns.score")}
              </DataTableHead>
              <DataTableHead role="number">
                {t("admin.questions.columns.difficulty")}
              </DataTableHead>
              <DataTableHead role="tag-list">
                {t("admin.questions.columns.tags")}
              </DataTableHead>
              <DataTableHead role="actions">
                {t("admin.questions.columns.actions")}
              </DataTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isTableLoading ? (
              <TableRow aria-hidden="true">
                <DataTableSpanCell colSpan={7} className="h-32 p-0">
                  {/*
                    Body skeleton: no text here. The toolbar already shows a
                    live loading indicator (aria-live polite + spinner +
                    label), so duplicating the "loading" string here would
                    both repeat it and add a second live region. This row
                    only holds height so the shell does not collapse while
                    the request is in flight (the original jitter cause).
                  */}
                </DataTableSpanCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <DataTableSpanCell colSpan={7} className="h-32">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="text-muted-foreground" aria-hidden="true">
                      <AppIcon icon={BookOpen} size="state" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {hasActiveFilter
                          ? t("admin.questions.noMatch")
                          : t("admin.questions.empty")}
                      </p>
                      <p className="text-sm text-text-muted">
                        {hasActiveFilter
                          ? t("admin.questions.noMatchDescription")
                          : t("admin.questions.emptyDescription")}
                      </p>
                    </div>
                    {hasActiveFilter ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearFilters}
                      >
                        {t("admin.questions.clearFilter")}
                      </Button>
                    ) : null}
                  </div>
                </DataTableSpanCell>
              </TableRow>
            ) : (
              filtered.map((q) => (
                <TableRow key={q.id}>
                  <DataTableCell role="type">
                    <Badge variant={TYPE_VARIANT[q.type] ?? "default"}>
                      {getTypeLabel(q.type, t) ?? q.type}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell role="long-text" className="truncate">
                    {q.content}
                  </DataTableCell>
                  <DataTableCell role="secondary-text">
                    {courseMap.get(q.courseId) ?? "-"}
                  </DataTableCell>
                  <DataTableCell role="score">{q.score}</DataTableCell>
                  <DataTableCell role="number">{q.difficulty}</DataTableCell>
                  <DataTableCell role="tag-list">
                    <div className="flex flex-wrap gap-1">
                      {q.tags.map((tag) => (
                        <TagBadge key={tag}>{tag}</TagBadge>
                      ))}
                    </div>
                  </DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          void navigate(`/admin/questions/${q.id}/edit`)
                        }
                        aria-label={t("admin.questions.editLabel")}
                      >
                        <AppIcon icon={Pencil} size="inline" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("admin.questions.deleteLabel")}
                            data-row-action-tone="destructive"
                          >
                            <AppIcon icon={Trash2} size="inline" />
                          </Button>
                        }
                        title={t("admin.questions.confirmDelete")}
                        description={t(
                          "admin.questions.confirmDeleteDescription",
                        )}
                        destructive
                        onConfirm={() => void handleDelete(q.id)}
                      />
                    </RowActions>
                  </DataTableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableShell>
      <DataTablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
