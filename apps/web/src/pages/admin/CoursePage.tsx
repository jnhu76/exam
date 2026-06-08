import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";

interface CourseRow {
  id: string;
  name: string;
  code: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function CoursePage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseRow | null>(null);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const loadCourses = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (opts?.showLoading !== false) setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(data.items);
    } catch {
      setError("加载课程列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  function openCreate() {
    setEditingCourse(null);
    setFormName("");
    setFormCode("");
    setFormDescription("");
    setFieldErrors({});
    setDialogOpen(true);
  }

  function openEdit(course: CourseRow) {
    setEditingCourse(course);
    setFormName(course.name);
    setFormCode(course.code);
    setFormDescription(course.description);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!formName.trim()) errors.name = "请输入课程名称";
    if (!formCode.trim()) errors.code = "请输入课程代码";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editingCourse) {
        await api.patch(`/api/courses/${editingCourse.id}`, {
          name: formName,
          code: formCode,
          description: formDescription,
        });
      } else {
        await api.post("/api/courses", {
          name: formName,
          code: formCode,
          description: formDescription,
        });
      }
      setDialogOpen(false);
      toast.success(editingCourse ? "课程已更新" : "课程已创建");
      await loadCourses({ showLoading: false });
    } catch {
      toast.error("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/courses/${id}`);
      toast.success("课程已删除");
      await loadCourses({ showLoading: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败，请稍后重试");
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadCourses} />;

  const trimmed = search.trim().toLowerCase();
  const filteredCourses = trimmed
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(trimmed) ||
          c.code.toLowerCase().includes(trimmed) ||
          (c.description ?? "").toLowerCase().includes(trimmed),
      )
    : courses;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title="课程管理"
          actions={
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              新增课程
            </Button>
          }
        />

        {courses.length > 0 && (
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索课程名称、代码或描述..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {courses.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-8" />}
            title="暂无课程"
            description="还没有创建任何课程，点击上方按钮创建。"
          />
        ) : filteredCourses.length === 0 ? (
          <EmptyState
            icon={<Search className="size-8" />}
            title="未找到匹配的课程"
            description={`没有符合「${search}」的课程`}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>课程名称</TableHead>
                <TableHead>课程代码</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCourses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">{course.name}</TableCell>
                  <TableCell>{course.code}</TableCell>
                  <TableCell className="max-w-[360px]">
                    {course.description ? (
                      course.description.length > 60 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block cursor-help truncate">
                              {course.description}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md whitespace-pre-wrap break-words">
                            {course.description}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="line-clamp-2 whitespace-pre-wrap break-words">
                          {course.description}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(course)}
                        aria-label="编辑课程"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="删除课程"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        }
                        title="确认删除"
                        description={`确定要删除课程「${course.name}」吗？`}
                        destructive
                        onConfirm={() => void handleDelete(course.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingCourse ? "编辑课程" : "新增课程"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="course-name">课程名称</Label>
                <Input
                  id="course-name"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (fieldErrors.name)
                      setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  placeholder="请输入课程名称"
                />
                <FieldError>{fieldErrors.name}</FieldError>
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-code">课程代码</Label>
                <Input
                  id="course-code"
                  value={formCode}
                  onChange={(e) => {
                    setFormCode(e.target.value);
                    if (fieldErrors.code)
                      setFieldErrors((prev) => ({ ...prev, code: "" }));
                  }}
                  placeholder="请输入课程代码"
                />
                <FieldError>{fieldErrors.code}</FieldError>
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-desc">描述</Label>
                <Textarea
                  id="course-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="请输入课程描述"
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
