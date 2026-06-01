import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";

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

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
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
    setDialogOpen(true);
  }

  function openEdit(course: CourseRow) {
    setEditingCourse(course);
    setFormName(course.name);
    setFormCode(course.code);
    setFormDescription(course.description);
    setDialogOpen(true);
  }

  async function handleSave() {
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
      await loadCourses();
    } catch {
      // error handled by api client
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await api.delete(`/api/courses/${id}`);
    await loadCourses();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadCourses} />;

  return (
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

      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="暂无课程"
          description="还没有创建任何课程，点击上方按钮创建。"
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
            {courses.map((course) => (
              <TableRow key={course.id}>
                <TableCell className="font-medium">{course.name}</TableCell>
                <TableCell>{course.code}</TableCell>
                <TableCell className="max-w-[300px] truncate">
                  {course.description}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(course)}
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
            <DialogTitle>{editingCourse ? "编辑课程" : "新增课程"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="course-name">课程名称</Label>
              <Input
                id="course-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="请输入课程名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-code">课程代码</Label>
              <Input
                id="course-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="请输入课程代码"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-desc">描述</Label>
              <Input
                id="course-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="请输入课程描述"
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
  );
}
