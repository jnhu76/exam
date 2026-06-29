import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookOpen,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { getTypeLabel, TYPE_VARIANT } from "@/lib/constants";

/** Row shape returned by the questions list API. */
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

/** Minimal course representation used to populate the course filter. */
/** A course record used for course name lookup in the question table. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** Generic paginated API response wrapper. */
/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Admin page for browsing, filtering, and managing the question bank. */
/**
 * Admin question management page with server-side filtering by course, type,
 * difficulty, and tags, plus client-side search and pagination.
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

  /** Fetches courses once on mount for the filter dropdown. */
  const loadCourses = useCallback(async () => {
    try {
      const cData = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(cData.items);
    } catch {
      // courses are optional context — table can still render
    }
  }, []);

  /** Fetches questions with the current filter and pagination parameters. */
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

  /** Deletes a question by id and refreshes the table. */
  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/questions/${id}`);
      await loadQuestions();
    } catch {
      toast.error(t("admin.questions.toast.deleteFailed"));
    }
  }

  /** Client-side content search applied to the current page of results. */
  const filtered = questions.filter((q) => {
    if (search && !q.content.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  /** Maps course ids to names for display in the table. */
  const courseMap = new Map(courses.map((c) => [c.id, c.name]));

  /** Resets all filter, search, and pagination state to defaults. */
  function clearFilters() {
    setFilterCourse("all");
    setFilterType("all");
    setFilterDifficulty("all");
    setFilterTags("");
    setSearch("");
    setPage(1);
  }

  /** Whether any filter or search criterion is currently active. */
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
              <FileUp data-icon="inline-start" />
              {t("admin.questions.importBtn")}
            </Button>
            <Button onClick={() => void navigate("/admin/questions/new")}>
              <Plus data-icon="inline-start" />
              {t("admin.questions.createBtn")}
            </Button>
          </div>
        }
      />

      <ListToolbar
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
                <LoaderCircle className="size-4 animate-spin" />
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
                <RotateCcw data-icon="inline-start" />
                {t("admin.questions.clearFilter")}
              </Button>
            )}
          </>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title={
            hasActiveFilter
              ? t("admin.questions.noMatch")
              : t("admin.questions.empty")
          }
          description={
            hasActiveFilter
              ? t("admin.questions.noMatchDescription")
              : t("admin.questions.emptyDescription")
          }
          action={
            hasActiveFilter ? (
              <Button variant="outline" onClick={clearFilters}>
                {t("admin.questions.clearFilter")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">
                  {t("admin.questions.columns.type")}
                </TableHead>
                <TableHead>{t("admin.questions.columns.content")}</TableHead>
                <TableHead>{t("admin.questions.columns.course")}</TableHead>
                <TableHead className="w-16">
                  {t("admin.questions.columns.score")}
                </TableHead>
                <TableHead className="w-16">
                  {t("admin.questions.columns.difficulty")}
                </TableHead>
                <TableHead>{t("admin.questions.columns.tags")}</TableHead>
                <TableHead className="w-24">
                  {t("admin.questions.columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Badge variant={TYPE_VARIANT[q.type] ?? "default"}>
                      {getTypeLabel(q.type, t) ?? q.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {q.content}
                  </TableCell>
                  <TableCell>{courseMap.get(q.courseId) ?? "-"}</TableCell>
                  <TableCell>{q.score}</TableCell>
                  <TableCell>{q.difficulty}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {q.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          void navigate(`/admin/questions/${q.id}/edit`)
                        }
                        aria-label={t("admin.questions.editLabel")}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("admin.questions.deleteLabel")}
                          >
                            <Trash2 className="text-destructive" />
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
