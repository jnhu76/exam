import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
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
import { TYPE_LABELS, TYPE_VARIANT } from "@/lib/constants";

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
      setError("加载题目列表失败");
    } finally {
      setIsTableLoading(false);
    }
  }, [filterCourse, filterDifficulty, filterTags, filterType, page]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadCourses();
      if (!cancelled) setIsInitialLoading(false);
    }
    void init();
    return () => {
      cancelled = true;
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
      toast.error("删除题目失败，请重试");
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
        title="题目管理"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions/import")}
            >
              <FileUp data-icon="inline-start" />
              导入题目
            </Button>
            <Button onClick={() => void navigate("/admin/questions/new")}>
              <Plus data-icon="inline-start" />
              新增题目
            </Button>
          </div>
        }
      />

      <ListToolbar
        aria-label="题目筛选工具栏"
        filters={
          <>
            <Select
              value={filterCourse}
              onValueChange={(value) => {
                setFilterCourse(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="按课程筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部课程</SelectItem>
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
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="按题型筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部题型</SelectItem>
                <SelectItem value="single_choice">单选题</SelectItem>
                <SelectItem value="multiple_choice">多选题</SelectItem>
                <SelectItem value="fill_blank">填空题</SelectItem>
                <SelectItem value="true_false">判断题</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterDifficulty}
              onValueChange={(value) => {
                setFilterDifficulty(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="按难度筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部难度</SelectItem>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    难度 {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="w-[180px]"
              placeholder="标签，逗号分隔"
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
            aria-label="搜索当前页题目"
            placeholder="搜索当前页题目内容..."
            value={search}
            onChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel="清除题目搜索"
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
                加载中…
              </span>
            )}
            {hasActiveFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                aria-label="清空筛选"
              >
                <RotateCcw data-icon="inline-start" />
                清空筛选
              </Button>
            )}
          </>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title={hasActiveFilter ? "未找到匹配的题目" : "暂无题目"}
          description={
            hasActiveFilter
              ? "当前筛选或当前页搜索没有匹配题目。"
              : "还没有创建任何题目，点击上方按钮创建。"
          }
          action={
            hasActiveFilter ? (
              <Button variant="outline" onClick={clearFilters}>
                清空筛选
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">题型</TableHead>
                <TableHead>题目内容</TableHead>
                <TableHead>所属课程</TableHead>
                <TableHead className="w-16">分值</TableHead>
                <TableHead className="w-16">难度</TableHead>
                <TableHead>标签</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Badge variant={TYPE_VARIANT[q.type] ?? "default"}>
                      {TYPE_LABELS[q.type] ?? q.type}
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
                        aria-label="编辑题目"
                      >
                        <Pencil />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="删除题目"
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        }
                        title="确认删除"
                        description="确定要删除这道题目吗？"
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
