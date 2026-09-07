import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { AppIcon } from "@/components/shared/AppIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { RowActions } from "@/components/shared/RowActions";
import { DataTableOverflowText } from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";

/** Configuration of a single candidate identity or metadata field. */
/** Candidate field configuration with metadata for display and ordering. */
interface Field {
  id: string;
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
  sortOrder: number;
}

const FIELD_TYPE_KEYS = ["text", "number", "select"] as const;

/**
 * Admin page for managing candidate identity and metadata fields.
 * Supports creating, editing, reordering (drag or arrow buttons), deleting fields,
 * and downloading a CSV import template that reflects the current field configuration.
 */
/**
 * Admin page for configuring candidate identity fields (e.g., examinee ID, department).
 * Supports create, edit, reorder via drag-and-drop, and CSV template download.
 */
export function CandidateFieldsPage() {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Field[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<Field["fieldType"]>("text");
  const [required, setRequired] = useState(false);
  const [unique, setUnique] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  /** Fetches all candidate fields from the API and sorts them by sortOrder. */
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setFields(
        (await api.get<Field[]>("/api/candidate-fields")).sort(
          (a, b) => a.sortOrder - b.sortOrder,
        ),
      );
      setError(null);
    } catch {
      setError(t("admin.candidateFields.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  /** Opens or closes the add/edit dialog and clears mutation errors on close. */
  function setDialogOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setMutationError(null);
  }
  /** Populates the dialog form with the given field's data (or defaults for a new field) and opens it. */
  function dialog(field?: Field) {
    setEditing(field ?? null);
    setName(field?.name ?? "");
    setLabel(field?.label ?? "");
    setFieldType(field?.fieldType ?? "text");
    setRequired(field?.required ?? false);
    setUnique(field?.unique ?? false);
    setMutationError(null);
    setOpen(true);
  }
  /** Validates and persists the field via create or update API, then reloads the list. */
  async function save() {
    if (saving || !name.trim() || !label.trim()) return;
    setSaving(true);
    setMutationError(null);
    try {
      if (editing) {
        await api.patch(`/api/candidate-fields/${editing.id}`, {
          label,
          required,
          unique,
          sortOrder: editing.sortOrder,
        });
      } else {
        await api.post("/api/candidate-fields", {
          name,
          label,
          fieldType,
          required,
          unique,
          sortOrder: fields.length,
        });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setMutationError(
        getApiErrorMessage(err, t, t("admin.candidateFields.toast.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  }
  /** Deletes the field with the given id and reloads the list. */
  async function remove(id: string) {
    try {
      setMutationError(null);
      await api.delete(`/api/candidate-fields/${id}`);
      await load();
    } catch (err) {
      setMutationError(
        getApiErrorMessage(
          err,
          t,
          t("admin.candidateFields.toast.deleteFailed"),
        ),
      );
    }
  }
  /** Swaps the sort order of a field with its neighbor at the given offset (-1 or +1). */
  async function move(field: Field, offset: number) {
    const index = fields.findIndex((item) => item.id === field.id);
    const other = fields[index + offset];
    if (!other) return;
    try {
      setMutationError(null);
      await Promise.all([
        api.patch(`/api/candidate-fields/${field.id}`, {
          sortOrder: other.sortOrder,
        }),
        api.patch(`/api/candidate-fields/${other.id}`, {
          sortOrder: field.sortOrder,
        }),
      ]);
      await load();
    } catch (err) {
      setMutationError(
        getApiErrorMessage(err, t, t("admin.candidateFields.toast.sortFailed")),
      );
    }
  }
  /** Handles drag-and-drop reorder by swapping sort orders between source and target fields. */
  async function drop(target: Field) {
    const source = fields.find((field) => field.id === draggingId);
    setDraggingId(null);
    if (!source || source.id === target.id) return;
    try {
      setMutationError(null);
      await Promise.all([
        api.patch(`/api/candidate-fields/${source.id}`, {
          sortOrder: target.sortOrder,
        }),
        api.patch(`/api/candidate-fields/${target.id}`, {
          sortOrder: source.sortOrder,
        }),
      ]);
      await load();
    } catch (err) {
      setMutationError(
        getApiErrorMessage(err, t, t("admin.candidateFields.toast.sortFailed")),
      );
    }
  }
  /** Downloads a CSV import template whose headers match the current field configuration. */
  async function download() {
    const { headers } = await api.get<{ headers: string[] }>(
      "/api/candidate-fields/template",
    );
    const blob = new Blob(["\uFEFF" + headers.join(",") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = t("admin.candidateFields.templateFilename");
    anchor.click();
    URL.revokeObjectURL(url);
  }
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array. Desktop keeps drag-to-reorder rows;
  // cards reorder through the move actions in the actions slot.
  const columns: DataViewColumnDef<Field>[] = [
    {
      id: "name",
      meta: { role: "short-id" },
      header: t("admin.candidateFields.columns.fieldName"),
      cell: ({ row }) => (
        <DataTableOverflowText
          mode="truncate-middle"
          value={row.original.name}
        />
      ),
    },
    {
      id: "label",
      meta: { role: "primary-text" },
      header: t("admin.candidateFields.columns.label"),
      cell: ({ row }) => row.original.label,
    },
    {
      id: "fieldType",
      meta: { role: "type" },
      header: t("admin.candidateFields.columns.type"),
      cell: ({ row }) =>
        t(
          `admin.candidateFields.typeLabels.${row.original.fieldType}` as never,
        ),
    },
    {
      id: "required",
      meta: { role: "type" },
      header: t("admin.candidateFields.columns.required"),
      cell: ({ row }) =>
        t(
          `admin.candidateFields.requiredLabels.${row.original.required}` as never,
        ),
    },
    {
      id: "unique",
      meta: { role: "type" },
      header: t("admin.candidateFields.columns.unique"),
      cell: ({ row }) =>
        t(
          `admin.candidateFields.requiredLabels.${row.original.unique}` as never,
        ),
    },
    {
      id: "sortOrder",
      meta: { role: "number" },
      header: t("admin.candidateFields.columns.sortOrder"),
      cell: ({ row }) => row.original.sortOrder,
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.candidateFields.columns.actions"),
      cell: ({ row }) => {
        const index = fields.indexOf(row.original);
        const field = row.original;
        return (
          <RowActions
            row={field}
            actions={[
              {
                id: "edit",
                label: t("admin.candidateFields.editLabel"),
                icon: Pencil,
                onSelect: () => dialog(field),
              },
              {
                id: "move-up",
                label: t("admin.candidateFields.moveUp"),
                icon: ArrowUp,
                disabled: index === 0,
                onSelect: () => void move(field, -1),
              },
              {
                id: "move-down",
                label: t("admin.candidateFields.moveDown"),
                icon: ArrowDown,
                disabled: index === fields.length - 1,
                onSelect: () => void move(field, 1),
              },
              {
                id: "delete",
                label: t("admin.candidateFields.deleteLabel"),
                icon: Trash2,
                tone: "destructive",
                confirm: {
                  title: t("admin.candidateFields.confirmDelete"),
                  description: t(
                    "admin.candidateFields.confirmDeleteDescription",
                    {
                      label: field.label,
                    },
                  ),
                  destructive: true,
                },
                onSelect: () => void remove(field.id),
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.candidateFields.title")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void download()}>
              <AppIcon icon={Download} size="inline" />
              {t("admin.candidateFields.downloadTemplate")}
            </Button>
            <Button onClick={() => dialog()}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.candidateFields.addField")}
            </Button>
          </div>
        }
      />
      {mutationError && <InlineErrorBanner>{mutationError}</InlineErrorBanner>}
      {fields.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Tags} size="state" />}
          title={t("admin.candidateFields.empty")}
          description={t("admin.candidateFields.emptyDescription")}
        />
      ) : (
        <DataTableShell
          mobile={
            <MobileRecordList
              columns={columns}
              rows={fields}
              getRowId={(f) => f.id}
            />
          }
        >
          <DesktopDataTable
            columns={columns}
            data={fields}
            getRowId={(f) => f.id}
            rowProps={(field) => ({
              draggable: true,
              onDragStart: () => setDraggingId(field.id),
              onDragEnd: () => setDraggingId(null),
              onDragOver: (event) => event.preventDefault(),
              onDrop: () => void drop(field),
            })}
          />
        </DataTableShell>
      )}
      <Dialog open={open} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("admin.candidateFields.dialog.edit")
                : t("admin.candidateFields.dialog.create")}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            {!editing && (
              <Field>
                <Label>{t("admin.candidateFields.dialog.fieldName")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
            <Field>
              <Label>{t("admin.candidateFields.dialog.label")}</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field>
              <Label>{t("admin.candidateFields.dialog.type")}</Label>
              {editing ? (
                <div className="rounded-md border bg-muted px-3 py-2 type-secondary">
                  {t(`admin.candidateFields.typeLabels.${fieldType}` as any)}
                  <span className="ml-2 text-xs">
                    {t("admin.candidateFields.dialog.typeNote")}
                  </span>
                </div>
              ) : (
                <Select
                  value={fieldType}
                  onValueChange={(value) =>
                    setFieldType(value as Field["fieldType"])
                  }
                >
                  <SelectTrigger
                    aria-label={t(
                      "admin.candidateFields.dialog.fieldTypeLabel",
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPE_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {t(`admin.candidateFields.typeLabels.${key}` as any)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <label className="flex gap-2">
              <Checkbox
                checked={required}
                onCheckedChange={(value) => setRequired(value === true)}
              />
              {t("admin.candidateFields.dialog.required")}
            </label>
            <label className="flex gap-2">
              <Checkbox
                checked={unique}
                onCheckedChange={(value) => setUnique(value === true)}
              />
              {t("admin.candidateFields.dialog.uniqueIdentity")}
            </label>
          </FieldGroup>
          {mutationError && (
            <InlineErrorBanner>{mutationError}</InlineErrorBanner>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t("admin.common.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? t("admin.common.saving") : t("admin.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
