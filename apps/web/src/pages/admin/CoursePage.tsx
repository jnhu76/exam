import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { AppIcon } from "@/components/shared/AppIcon";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { ListToolbar } from "@/components/shared/ListToolbar";
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

/** A course record with name, code, and description. */
/** A single course record returned from the API. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** Generic paginated API response wrapper. */
/** Paginated API response with metadata. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Admin course management page with search, create, edit, and delete operations. */
/**
 * Admin page for managing courses.
 * Supports listing, searching, creating, editing, and deleting courses
 * with inline form validation and toast feedback.
 */
export function CoursePage() {
  const { t } = useTranslation();
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

  /** Fetches the course list from the API, optionally showing a loading indicator. */
  const loadCourses = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (opts?.showLoading !== false) setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(data.items);
    } catch {
      setError(t("admin.courses.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  /** Resets the form and opens the dialog for creating a new course. */
  function openCreate() {
    setEditingCourse(null);
    setFormName("");
    setFormCode("");
    setFormDescription("");
    setFieldErrors({});
    setDialogOpen(true);
  }

  /** Populates the form with the given course's data and opens the edit dialog. */
  function openEdit(course: CourseRow) {
    setEditingCourse(course);
    setFormName(course.name);
    setFormCode(course.code);
    setFormDescription(course.description);
    setFieldErrors({});
    setDialogOpen(true);
  }

  /** Validates the course form fields and returns true if valid. */
  function validate() {
    const errors: Record<string, string> = {};
    if (!formName.trim())
      errors.name = t("admin.courses.validation.nameRequired");
    if (!formCode.trim())
      errors.code = t("admin.courses.validation.codeRequired");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /** Validates and persists the course via create or update API, then reloads the list. */
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
      toast.success(
        editingCourse
          ? t("admin.courses.toast.updated")
          : t("admin.courses.toast.created"),
      );
      await loadCourses({ showLoading: false });
    } catch {
      toast.error(t("admin.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /** Deletes the course with the given id and reloads the list. */
  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/courses/${id}`);
      toast.success(t("admin.courses.toast.deleted"));
      await loadCourses({ showLoading: false });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.common.deleteFailed"),
      );
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
          title={t("admin.courses.title")}
          actions={
            <Button onClick={openCreate}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.courses.createBtn")}
            </Button>
          }
        />

        {courses.length > 0 && (
          <ListToolbar
            search={
              <SearchInput
                aria-label={t("admin.courses.searchLabel")}
                placeholder={t("admin.courses.searchPlaceholder")}
                value={search}
                onChange={setSearch}
                onClear={() => setSearch("")}
                clearLabel={t("admin.courses.clearSearchLabel")}
                containerClassName="max-w-md"
              />
            }
            summary={t("admin.courses.count", {
              count: filteredCourses.length,
            })}
          />
        )}

        {courses.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={BookOpen} size="state" />}
            title={t("admin.courses.empty")}
            description={t("admin.courses.emptyDescription")}
          />
        ) : filteredCourses.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={Search} size="state" />}
            title={t("admin.courses.noMatch")}
            description={t("admin.courses.noMatchDescription", { q: search })}
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                {t("admin.common.clearSearch")}
              </Button>
            }
          />
        ) : (
          <DataTableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.courses.columns.name")}</TableHead>
                  <TableHead>{t("admin.courses.columns.code")}</TableHead>
                  <TableHead>
                    {t("admin.courses.columns.description")}
                  </TableHead>
                  <TableHead className="w-24">
                    {t("admin.courses.columns.actions")}
                  </TableHead>
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
                          aria-label={t("admin.courses.editLabel")}
                        >
                          <AppIcon icon={Pencil} size="inline" />
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("admin.courses.deleteLabel")}
                            >
                              <AppIcon icon={Trash2} size="inline" />
                            </Button>
                          }
                          title={t("admin.common.confirm")}
                          description={t("admin.courses.enableDisable", {
                            action: t("admin.common.delete"),
                            name: course.name,
                          })}
                          destructive
                          onConfirm={() => void handleDelete(course.id)}
                        />
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {editingCourse
                  ? t("admin.courses.dialog.edit")
                  : t("admin.courses.dialog.create")}
              </DialogTitle>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <Label htmlFor="course-name">
                  {t("admin.courses.dialog.name")}
                </Label>
                <Input
                  id="course-name"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (fieldErrors.name)
                      setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  placeholder={t("admin.courses.dialog.namePlaceholder")}
                />
                <FieldError>{fieldErrors.name}</FieldError>
              </Field>
              <Field>
                <Label htmlFor="course-code">
                  {t("admin.courses.dialog.code")}
                </Label>
                <Input
                  id="course-code"
                  value={formCode}
                  onChange={(e) => {
                    setFormCode(e.target.value);
                    if (fieldErrors.code)
                      setFieldErrors((prev) => ({ ...prev, code: "" }));
                  }}
                  placeholder={t("admin.courses.dialog.codePlaceholder")}
                />
                <FieldError>{fieldErrors.code}</FieldError>
              </Field>
              <Field>
                <Label htmlFor="course-desc">
                  {t("admin.courses.columns.description")}
                </Label>
                <Textarea
                  id="course-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t("admin.courses.columns.description")}
                  rows={4}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t("admin.common.cancel")}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? t("admin.common.saving") : t("admin.common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/** Displays text with line clamping and a tooltip when content is truncated. */
/** Renders text truncated to two lines with a tooltip when content overflows. */
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
