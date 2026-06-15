import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
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
      <div className="flex flex-col gap-6">
        <PageHeader
          title="课程管理"
          actions={
            <Button onClick={openCreate}>
              <Plus data-icon="inline-start" />
              新增课程
            </Button>
          }
        />

        {courses.length > 0 && (
          <SearchInput
            aria-label="搜索课程"
            placeholder="搜索课程名称、代码或描述..."
            value={search}
            onChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel="清除课程搜索"
            containerClassName="max-w-md"
          />
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
            description={`没有符合「${search}」的课程。`}
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                清除搜索
              </Button>
            }
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
                      <TruncatedCell text={course.description} />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(course)}
                        aria-label="编辑课程"
                      >
                        <Pencil />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="删除课程"
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        }
                        title="确认删除"
                        description={`确定要删除课程「${course.name}」吗？`}
                        destructive
                        onConfirm={() => void handleDelete(course.id)}
                      />
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {editingCourse ? "编辑课程" : "新增课程"}
              </DialogTitle>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
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
              </Field>
              <Field>
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
              </Field>
              <Field>
                <Label htmlFor="course-desc">描述</Label>
                <Textarea
                  id="course-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="请输入课程描述"
                  rows={4}
                />
              </Field>
            </FieldGroup>
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

function TruncatedCell({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (ref.current) {
      setTruncated(ref.current.scrollHeight > ref.current.clientHeight);
    }
  }, [text]);

  const span = (
    <span
      ref={ref}
      className="block cursor-default line-clamp-2 whitespace-pre-wrap break-words"
    >
      {text}
    </span>
  );

  if (!truncated) return span;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap break-words">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
