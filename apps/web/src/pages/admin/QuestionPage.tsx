import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { DataViewSearch } from "@/components/shared/DataViewSearch";
import { RowActions } from "@/components/shared/RowActions";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import {
  DataWorkbench,
  DataWorkbenchToolbar,
  DataWorkbenchFooter,
} from "@/components/shared/DataWorkbench";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { MobileRecordCard } from "@/components/shared/MobileRecordCard";
import { AppIcon } from "@/components/shared/AppIcon";
import { TagFilterSelect } from "@/components/shared/TagFilterSelect";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/TagBadge";
import { getTypeLabel, TYPE_VARIANT } from "@/lib/constants";
import {
  FileUp,
  LoaderCircle,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

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

const PAGE_SIZE = 20;

/**
 * Admin question management page with server-side search, filtering by course,
 * type, difficulty, and tags, plus pagination.
 *
 * UI-TABLE-KOI-COMPACT-1: the toolbar, table, and pagination are unified into
 * a single continuous DataWorkbench shell (toolbar → header → body → footer
 * are regions of one surface, not three separated cards). DesktopDataTable is
 * the TanStack headless engine with a role-based column contract; MobileRecordCard
 * renders below lg. Search is SERVER-SIDE over the full dataset (debounced);
 * the workbench shell stays mounted across loading/empty/error transitions —
 * only the table body swaps, so there is no layout jitter.
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
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [tagVocabulary, setTagVocabulary] = useState<string[]>([]);
  // Search is split into two states to prevent stale/overlapping responses:
  //   - searchInput: the live text in the field (updated every keystroke)
  //   - committedSearch: the term actually sent to the server (updated only by
  //     the debounced onSearch commit from DataViewSearch). loadQuestions
  //     depends on committedSearch, so typing does NOT fire a request per
  //     keystroke — only the debounced commit does. (CodeRabbit R3.)
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadCourses = useCallback(async () => {
    try {
      const cData = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(cData.items);
    } catch {
      // courses are optional context — table can still render
    }
  }, []);

  const loadTagVocabulary = useCallback(async () => {
    try {
      const data = await api.get<{ tags: string[] }>("/api/questions/tags");
      setTagVocabulary(data.tags);
    } catch {
      // vocabulary is optional context — the filter still renders (empty)
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    setIsTableLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (filterCourse !== "all") params.set("courseId", filterCourse);
      if (filterType !== "all") params.set("type", filterType);
      if (filterDifficulty !== "all")
        params.set("difficulty", filterDifficulty);
      if (filterTags.length > 0) params.set("tags", filterTags.join(","));
      if (committedSearch.trim()) params.set("search", committedSearch.trim());
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
  }, [
    filterCourse,
    filterDifficulty,
    filterTags,
    filterType,
    page,
    committedSearch,
    t,
  ]);

  useEffect(() => {
    let canceledFlag = false;
    async function init() {
      await Promise.all([loadCourses(), loadTagVocabulary()]);
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
      // A deleted question may have been the last user of a tag — refresh
      // the vocabulary so the filter never offers stale options.
      await Promise.all([loadQuestions(), loadTagVocabulary()]);
    } catch {
      toast.error(t("admin.questions.toast.deleteFailed"));
    }
  }

  const courseMap = useMemo(
    () => new Map(courses.map((c) => [c.id, c.name])),
    [courses],
  );

  function clearFilters() {
    setFilterCourse("all");
    setFilterType("all");
    setFilterDifficulty("all");
    setFilterTags([]);
    setSearchInput("");
    setCommittedSearch("");
    setPage(1);
  }

  const hasActiveFilter =
    filterCourse !== "all" ||
    filterType !== "all" ||
    filterDifficulty !== "all" ||
    filterTags.length > 0 ||
    committedSearch.trim() !== "";

  // Immediate input change: update ONLY the displayed value. No server query —
  // loadQuestions does not depend on searchInput, so typing never fires a
  // request. (CodeRabbit R3.)
  function handleSearchChange(term: string) {
    setSearchInput(term);
  }

  // Debounced commit: update the server-query term and reset to page 1. This is
  // the only path that changes committedSearch, so only settled typing triggers
  // a query — preventing stale overlapping responses.
  function handleSearchCommit(term: string) {
    setPage(1);
    setCommittedSearch(term);
  }

  if (isInitialLoading) return <LoadingState />;
  if (error && questions.length === 0 && !isTableLoading)
    return <ErrorState message={error} onRetry={loadQuestions} />;

  const columns: DataViewColumnDef<QuestionRow>[] = [
    {
      id: "type",
      meta: { role: "type" },
      header: t("admin.questions.columns.type" as never),
      cell: ({ row }) => (
        <Badge variant={TYPE_VARIANT[row.original.type] ?? "default"}>
          {getTypeLabel(row.original.type, t) ?? row.original.type}
        </Badge>
      ),
    },
    {
      id: "content",
      meta: { role: "long-text" },
      header: t("admin.questions.columns.content" as never),
      cell: ({ row }) => (
        <span
          className="workbench-cell-text"
          title={row.original.content}
          aria-label={row.original.content}
        >
          {row.original.content}
        </span>
      ),
    },
    {
      id: "course",
      meta: { role: "secondary-text" },
      header: t("admin.questions.columns.course" as never),
      cell: ({ row }) => courseMap.get(row.original.courseId) ?? "-",
    },
    {
      id: "score",
      meta: { role: "score" },
      header: t("admin.questions.columns.score" as never),
      cell: ({ row }) => row.original.score,
    },
    {
      id: "difficulty",
      meta: { role: "number" },
      header: t("admin.questions.columns.difficulty" as never),
      cell: ({ row }) => row.original.difficulty,
    },
    {
      id: "tags",
      meta: { role: "tag-list" },
      header: t("admin.questions.columns.tags" as never),
      cell: ({ row }) => {
        const tags = row.original.tags;
        const maxVisible = 3;
        const visible = tags.slice(0, maxVisible);
        const overflow = tags.length - visible.length;
        return (
          <div
            className="flex flex-wrap gap-1"
            title={tags.length > 0 ? tags.join(", ") : undefined}
          >
            {visible.map((tag) => (
              <TagBadge key={tag}>{tag}</TagBadge>
            ))}
            {overflow > 0 && (
              <span
                data-slot="tag-overflow"
                aria-label={t("common.moreTags", { count: overflow })}
              >
                +{overflow}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.questions.columns.actions" as never),
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              void navigate(`/admin/questions/${row.original.id}/edit`)
            }
            aria-label={t("admin.questions.editLabel" as never)}
          >
            <AppIcon icon={Pencil} size="inline" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("admin.questions.deleteLabel" as never)}
                data-row-action-tone="destructive"
              >
                <AppIcon icon={Trash2} size="inline" />
              </Button>
            }
            title={t("admin.questions.confirmDelete" as never)}
            description={t("admin.questions.confirmDeleteDescription" as never)}
            destructive
            onConfirm={() => void handleDelete(row.original.id)}
          />
        </RowActions>
      ),
    },
  ];

  const isEmpty = !isTableLoading && questions.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.questions.title" as never)}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions/import")}
            >
              <AppIcon icon={FileUp} size="inline" />
              {t("admin.questions.importBtn" as never)}
            </Button>
            <Button onClick={() => void navigate("/admin/questions/new")}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.questions.createBtn" as never)}
            </Button>
          </div>
        }
      />

      <DataWorkbench
        toolbar={
          <DataWorkbenchToolbar>
            <ListToolbar
              appearance="quiet"
              aria-label={t("admin.questions.filterToolbar" as never)}
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
                      <SelectValue
                        placeholder={t("admin.questions.filterCourse" as never)}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("admin.questions.filterAllCourses" as never)}
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
                    <SelectTrigger
                      aria-label={t("admin.questions.filterType" as never)}
                      className="w-auto lg:w-[150px]"
                    >
                      <SelectValue
                        placeholder={t("admin.questions.filterType" as never)}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("admin.questions.filterAllTypes" as never)}
                      </SelectItem>
                      <SelectItem value="single_choice">
                        {t(
                          "admin.questions.questionTypes.single_choice" as never,
                        )}
                      </SelectItem>
                      <SelectItem value="multiple_choice">
                        {t(
                          "admin.questions.questionTypes.multiple_choice" as never,
                        )}
                      </SelectItem>
                      <SelectItem value="fill_blank">
                        {t("admin.questions.questionTypes.fill_blank" as never)}
                      </SelectItem>
                      <SelectItem value="true_false">
                        {t("admin.questions.questionTypes.true_false" as never)}
                      </SelectItem>
                      <SelectItem value="text_response">
                        {t(
                          "admin.questions.questionTypes.text_response" as never,
                        )}
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
                        placeholder={t(
                          "admin.questions.filterDifficulty" as never,
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("admin.questions.filterAllDifficulties" as never)}
                      </SelectItem>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {t("admin.questions.difficultyLabel" as never, {
                            value,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <TagFilterSelect
                    tags={tagVocabulary}
                    selected={filterTags}
                    onChange={(next) => {
                      setFilterTags(next);
                      setPage(1);
                    }}
                    aria-label={t("admin.questions.tagFilterLabel" as never)}
                  />
                </>
              }
              search={
                <DataViewSearch
                  aria-label={t("admin.questions.searchLabel" as never)}
                  placeholder={t("admin.questions.searchPlaceholder" as never)}
                  value={searchInput}
                  onChange={handleSearchChange}
                  onSearch={handleSearchCommit}
                  loading={isTableLoading}
                />
              }
              actions={
                <>
                  {/* Loading indicator: always rendered so its show/hide does
                      not reflow the actions cluster (which would shift the
                      search box position in the toolbar). Visibility toggles. */}
                  <span
                    className={`inline-flex min-w-[5.5rem] items-center gap-2 text-sm text-muted-foreground ${
                      isTableLoading ? "visible" : "invisible"
                    }`}
                    aria-live="polite"
                    aria-hidden={!isTableLoading}
                  >
                    <AppIcon
                      icon={LoaderCircle}
                      size="inline"
                      className="animate-spin"
                    />
                    {t("common.loading" as never)}
                  </span>
                  {hasActiveFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      aria-label={t("admin.common.clearFilter" as never)}
                    >
                      <AppIcon icon={RotateCcw} size="inline" />
                      {t("admin.questions.clearFilter" as never)}
                    </Button>
                  )}
                </>
              }
            />
          </DataWorkbenchToolbar>
        }
        footer={
          <DataWorkbenchFooter>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </DataWorkbenchFooter>
        }
        desktopTable={
          <DesktopDataTable
            columns={columns}
            data={questions}
            rowCount={total}
            page={page}
            pageSize={PAGE_SIZE}
            getRowId={(q) => q.id}
            loading={isTableLoading}
            empty={isEmpty}
            error={!isTableLoading ? error : null}
            emptyTitle={
              hasActiveFilter
                ? t("admin.questions.noMatch" as never)
                : t("admin.questions.empty" as never)
            }
            emptyDescription={
              hasActiveFilter
                ? t("admin.questions.noMatchDescription" as never)
                : t("admin.questions.emptyDescription" as never)
            }
          />
        }
        mobileList={
          <MobileRecordList
            loading={isTableLoading}
            empty={isEmpty}
            error={!isTableLoading ? error : null}
            errorNode={
              <MobileRecordCard
                primary={t("common.loading.loadFailed" as never)}
                meta={error ?? undefined}
              />
            }
            emptyNode={
              <MobileRecordCard
                primary={
                  hasActiveFilter
                    ? t("admin.questions.noMatch" as never)
                    : t("admin.questions.empty" as never)
                }
                meta={
                  hasActiveFilter
                    ? t("admin.questions.noMatchDescription" as never)
                    : t("admin.questions.emptyDescription" as never)
                }
              />
            }
          >
            {questions.map((q) => (
              <MobileRecordCard
                key={q.id}
                header={
                  <Badge variant={TYPE_VARIANT[q.type] ?? "default"}>
                    {getTypeLabel(q.type, t) ?? q.type}
                  </Badge>
                }
                primary={q.content}
                meta={
                  <>
                    <span>{courseMap.get(q.courseId) ?? "-"}</span>
                    <span>
                      {t("admin.questions.columns.score" as never)}: {q.score}
                    </span>
                    <span>
                      {t("admin.questions.columns.difficulty" as never)}:{" "}
                      {q.difficulty}
                    </span>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("admin.questions.editLabel" as never)}
                      onClick={() =>
                        void navigate(`/admin/questions/${q.id}/edit`)
                      }
                    >
                      <AppIcon icon={Pencil} size="inline" />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("admin.questions.deleteLabel" as never)}
                          data-row-action-tone="destructive"
                        >
                          <AppIcon icon={MoreVertical} size="inline" />
                        </Button>
                      }
                      title={t("admin.questions.confirmDelete" as never)}
                      description={t(
                        "admin.questions.confirmDeleteDescription" as never,
                      )}
                      destructive
                      onConfirm={() => void handleDelete(q.id)}
                    />
                  </>
                }
              />
            ))}
          </MobileRecordList>
        }
      />
    </div>
  );
}
