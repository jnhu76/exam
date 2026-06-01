import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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
import { BookOpen, FileUp, Pencil, Plus, Trash2 } from "lucide-react";

interface QuestionRow {
  id: string;
  courseId: string;
  type: string;
  content: string;
  score: number;
  difficulty: number;
  tags: string[];
}

interface CourseRow {
  id: string;
  name: string;
  code: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const typeLabels: Record<string, string> = {
  single_choice: "单选",
  multiple_choice: "多选",
  fill_blank: "填空",
  true_false: "判断",
};

const typeVariant: Record<string, "default" | "secondary" | "outline"> = {
  single_choice: "default",
  multiple_choice: "secondary",
  fill_blank: "outline",
  true_false: "outline",
};

export function QuestionPage() {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCourse, setFilterCourse] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("all");
  const [filterTags, setFilterTags] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [qData, cData] = await Promise.all([
        api.get<PaginatedResponse<QuestionRow>>(
          `/api/questions?page=${page}&pageSize=20${
            filterCourse === "all" ? "" : `&courseId=${filterCourse}`
          }${filterType === "all" ? "" : `&type=${filterType}`}${
            filterDifficulty === "all" ? "" : `&difficulty=${filterDifficulty}`
          }${filterTags.trim() ? `&tags=${encodeURIComponent(filterTags)}` : ""}`,
        ),
        api.get<PaginatedResponse<CourseRow>>("/api/courses"),
      ]);
      setQuestions(qData.items);
      setTotalPages(qData.totalPages);
      setCourses(cData.items);
    } catch {
      setError("加载题目列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [filterCourse, filterDifficulty, filterTags, filterType, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleDelete(id: string) {
    await api.delete(`/api/questions/${id}`);
    await loadData();
  }

  const filtered = questions.filter((q) => {
    if (search && !q.content.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const courseMap = new Map(courses.map((c) => [c.id, c.name]));

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="题目管理"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void navigate("/admin/questions/import")}
            >
              <FileUp className="size-4" />
              导入题目
            </Button>
            <Button onClick={() => void navigate("/admin/questions/new")}>
              <Plus className="size-4" />
              新增题目
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3">
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

        <Input
          className="w-[200px]"
          placeholder="搜索题目内容..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="暂无题目"
          description="还没有创建任何题目，点击上方按钮创建。"
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
                    <Badge variant={typeVariant[q.type] ?? "default"}>
                      {typeLabels[q.type] ?? q.type}
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
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          void navigate(`/admin/questions/${q.id}/edit`)
                        }
                        aria-label="编辑题目"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="icon">
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        }
                        title="确认删除"
                        description="确定要删除这道题目吗？"
                        destructive
                        onConfirm={() => void handleDelete(q.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-3 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </Button>
            <span>
              第 {page} / {totalPages || 1} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
