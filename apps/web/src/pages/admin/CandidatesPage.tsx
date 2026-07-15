import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage, getApiFieldErrors } from "@/lib/apiErrors";
import { toast } from "sonner";
import {
  parseImportCsv,
  detectDuplicate,
  MAX_IMPORT_ROWS,
} from "@/lib/candidateImport";
import type { CandidateFieldConfig } from "@/lib/candidateImport";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { AppIcon } from "@/components/shared/AppIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  ImportWizard,
  type ImportPreviewRow,
} from "@/components/shared/ImportWizard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus, Search, Upload, Users, KeyRound } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DEFAULT_PASSWORD_POLICY } from "@exam/contracts";

/** Configuration of a candidate identity or metadata field. */
interface Field {
  id: string;
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
  sortOrder: number;
}

/** A candidate (examinee) record with identity fields. */
interface Candidate {
  id: string;
  username: string;
  name: string;
  isActive: boolean;
  fields: Record<string, unknown>;
}

/** Generic paginated response wrapper. */
interface Page<T> {
  items: T[];
}

/**
 * Admin page for managing candidates (examinees).
 * Supports listing, searching, creating, editing, enabling/disabling candidates,
 * and bulk-importing via CSV with a preview wizard.
 *
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Admin table with distinct header, clear
 * boundaries, cool-neutral palette.
 */
export function CandidatesPage() {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<Candidate | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetFieldError, setResetFieldError] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [candidateData, fieldData] = await Promise.all([
        api.get<Page<Candidate>>("/api/candidates"),
        api.get<Field[]>("/api/candidate-fields"),
      ]);
      setCandidates(candidateData.items);
      setFields(fieldData.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      setError(t("admin.candidates.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const filteredCandidates = useMemo(
    () =>
      search
        ? candidates.filter(
            (c) =>
              c.name.toLowerCase().includes(search.toLowerCase()) ||
              c.username.toLowerCase().includes(search.toLowerCase()),
          )
        : candidates,
    [candidates, search],
  );

  function open(candidate?: Candidate) {
    setEditing(candidate ?? null);
    setUsername(candidate?.username ?? "");
    setPassword("");
    setName(candidate?.name ?? "");
    setValues(
      Object.fromEntries(
        fields.map((field) => [
          field.name,
          String(candidate?.fields[field.name] ?? ""),
        ]),
      ),
    );
    setSaveError(null);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function payloadFields() {
    return Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.fieldType === "number" && values[field.name] !== ""
          ? Number(values[field.name])
          : (values[field.name] ?? ""),
      ]),
    );
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim())
      errors.name = t("admin.candidates.validation.nameRequired");
    if (!editing) {
      if (!username.trim())
        errors.username = t("admin.candidates.validation.usernameRequired");
      if (password.length < DEFAULT_PASSWORD_POLICY.minLength)
        errors.password = t("admin.candidates.validation.passwordMin", {
          min: DEFAULT_PASSWORD_POLICY.minLength,
        });
    }
    for (const field of fields) {
      if (field.required && !(values[field.name] ?? "").toString().trim()) {
        errors[`field:${field.name}`] = t(
          "admin.candidates.validation.fieldRequired",
        );
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (saving || !validate()) return;
    setSaveError(null);
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/candidates/${editing.id}`, {
          name,
          fields: payloadFields(),
        });
        toast.success(t("admin.candidates.toast.updated"));
      } else {
        await api.post("/api/candidates", {
          username,
          password,
          name,
          fields: payloadFields(),
        });
        toast.success(t("admin.candidates.toast.created"));
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      const serverFieldErrors = getApiFieldErrors(err);
      setFieldErrors((current) => ({ ...current, ...serverFieldErrors }));
      setSaveError(getApiErrorMessage(err, t("admin.common.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(candidate: Candidate) {
    if (togglingId) return;
    setTogglingId(candidate.id);
    try {
      await api.patch(`/api/candidates/${candidate.id}`, {
        isActive: !candidate.isActive,
      });
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("admin.common.operationFailed")));
    } finally {
      setTogglingId(null);
    }
  }

  function openReset(candidate: Candidate) {
    setResetTarget(candidate);
    setResetPassword("");
    setResetConfirmPassword("");
    setResetFieldError("");
    setResetOpen(true);
  }

  async function confirmResetPassword() {
    if (!resetTarget || resetting) return;
    const len = resetPassword.length;
    if (
      len < DEFAULT_PASSWORD_POLICY.minLength ||
      len > DEFAULT_PASSWORD_POLICY.maxLength
    ) {
      setResetFieldError(
        t("admin.candidates.validation.passwordRange", {
          min: DEFAULT_PASSWORD_POLICY.minLength,
          max: DEFAULT_PASSWORD_POLICY.maxLength,
        }),
      );
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setResetFieldError(t("admin.candidates.validation.passwordMismatch"));
      return;
    }
    setResetting(true);
    try {
      await api.post(`/api/users/${resetTarget.id}/reset-password`, {
        newPassword: resetPassword,
      });
      toast.success(t("admin.candidates.toast.passwordReset"));
      setResetOpen(false);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirmPassword("");
      setResetFieldError("");
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t("admin.candidates.toast.resetFailed")),
      );
    } finally {
      setResetting(false);
    }
  }

  function fieldConfigs(): CandidateFieldConfig[] {
    return fields.map((f) => ({
      name: f.name,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      unique: f.unique,
    }));
  }

  function importRows() {
    return parseImportCsv(csv, fieldConfigs()).rows;
  }

  function importTruncated(): boolean {
    return parseImportCsv(csv, fieldConfigs()).truncated;
  }

  function previewRows(): ImportPreviewRow[] {
    const rows = importRows();
    const seenUsernames = new Set<string>();
    return rows.map((row, index) => {
      const missing = fields.find(
        (field) => field.required && !row.fields[field.name],
      );
      if (!row.username || !row.name || missing) {
        return {
          row: index + 2,
          status: "error",
          message: missing
            ? t("admin.candidates.importDialog.missingField", {
                label: missing.label,
              })
            : t("admin.candidates.importDialog.missingUsername"),
        };
      }
      const inBatch = seenUsernames.has(row.username);
      seenUsernames.add(row.username);
      const existsInDb = detectDuplicate(row, fieldConfigs(), candidates);
      const exists = existsInDb || inBatch;
      if (!exists && !row.password) {
        return {
          row: index + 2,
          status: "error",
          message: t("admin.candidates.importDialog.needPassword"),
        };
      }
      if (
        !exists &&
        row.password &&
        row.password.length < DEFAULT_PASSWORD_POLICY.minLength
      ) {
        return {
          row: index + 2,
          status: "error",
          message: t("admin.candidates.importDialog.passwordMin", {
            min: DEFAULT_PASSWORD_POLICY.minLength,
          }),
        };
      }
      const message = existsInDb
        ? t("admin.candidates.importDialog.exists")
        : inBatch
          ? t("admin.candidates.importDialog.duplicateInBatch")
          : t("admin.candidates.importDialog.willCreate");
      return {
        row: index + 2,
        status: exists ? "update" : "create",
        message,
      };
    });
  }

  async function importCsv() {
    try {
      const result = await api.post<{
        created: number;
        updated: number;
        errors: unknown[];
      }>("/api/candidates/import", { rows: importRows() });
      setImportSummary(
        t("admin.candidates.importDialog.result", {
          created: result.created,
          updated: result.updated,
          errors: result.errors.length,
        }),
      );
      setCsv("");
      await load();
    } catch {
      toast.error(t("admin.candidates.importDialog.failed"));
      return;
    }
    setTimeout(() => {
      setImportOpen(false);
      setImportSummary("");
    }, 1500);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.candidates.title")}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => open()}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.candidates.createBtn")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(true);
                setImportSummary("");
                setCsv("");
              }}
            >
              <AppIcon icon={Upload} size="inline" />
              {t("admin.candidates.importBtn")}
            </Button>
          </div>
        }
      />
      <SearchInput
        aria-label={t("admin.candidates.searchLabel")}
        placeholder={t("admin.candidates.searchPlaceholder")}
        value={search}
        onChange={setSearch}
        onClear={() => setSearch("")}
        clearLabel={t("admin.candidates.clearSearchLabel")}
        containerClassName="max-w-md flex-1"
      />
      {filteredCandidates.length === 0 && search ? (
        <EmptyState
          icon={<AppIcon icon={Search} size="state" />}
          title={t("admin.candidates.noMatch")}
          description={t("admin.candidates.noMatchDescription", { q: search })}
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              {t("admin.common.clearSearch")}
            </Button>
          }
        />
      ) : filteredCandidates.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Users} size="state" />}
          title={t("admin.candidates.empty")}
          description={t("admin.candidates.emptyDescription")}
          action={
            <div className="flex gap-2">
              <Button onClick={() => open()}>
                {t("admin.candidates.createBtn")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImportOpen(true);
                  setImportSummary("");
                  setCsv("");
                }}
              >
                {t("admin.candidates.importBtn")}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <DataTableShell minTableWidth="standard" actionsDensity="wide">
            <Table>
              <DataTableColumns
                columns={[
                  { role: "short-id" },
                  { role: "primary-text" },
                  ...fields.map((field) => ({
                    role: "secondary-text" as const,
                    key: field.id,
                  })),
                  { role: "status" },
                  { role: "actions" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="short-id">
                    {t("admin.candidates.columns.username")}
                  </DataTableHead>
                  <DataTableHead role="primary-text">
                    {t("admin.candidates.columns.name")}
                  </DataTableHead>
                  {fields.map((field) => (
                    <DataTableHead role="secondary-text" key={field.id}>
                      {field.label}
                    </DataTableHead>
                  ))}
                  <DataTableHead role="status">
                    {t("admin.candidates.columns.status")}
                  </DataTableHead>
                  <DataTableHead role="actions">
                    {t("admin.candidates.columns.actions")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCandidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <DataTableCell role="short-id">
                      {candidate.username}
                    </DataTableCell>
                    <DataTableCell role="primary-text">
                      {candidate.name}
                    </DataTableCell>
                    {fields.map((field) => (
                      <DataTableCell role="secondary-text" key={field.id}>
                        {String(candidate.fields[field.name] ?? "-")}
                      </DataTableCell>
                    ))}
                    <DataTableCell role="status">
                      <StatusBadge
                        status={candidate.isActive ? "active" : "inactive"}
                      />
                    </DataTableCell>
                    <DataTableCell role="actions">
                      <RowActions>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => open(candidate)}
                          aria-label={t("admin.candidates.editLabel")}
                        >
                          <AppIcon icon={Pencil} size="inline" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openReset(candidate)}
                          aria-label={t("admin.candidates.resetPassword")}
                          data-testid={`candidate-reset-password-${candidate.id}`}
                        >
                          <AppIcon icon={KeyRound} size="inline" />
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={togglingId !== null}
                            >
                              {togglingId === candidate.id
                                ? t("admin.common.processing")
                                : candidate.isActive
                                  ? t("admin.common.disable")
                                  : t("admin.common.enable")}
                            </Button>
                          }
                          title={
                            candidate.isActive
                              ? t("admin.common.confirmDisable")
                              : t("admin.common.confirmEnable")
                          }
                          description={t("admin.candidates.enableDisable", {
                            action: candidate.isActive
                              ? t("admin.common.disable")
                              : t("admin.common.enable"),
                            name: candidate.name,
                          })}
                          destructive={candidate.isActive}
                          onConfirm={() => void toggle(candidate)}
                        />
                      </RowActions>
                    </DataTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
        </>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("admin.candidates.dialog.edit")
                : t("admin.candidates.dialog.create")}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            {!editing && (
              <>
                <Field>
                  <Label htmlFor="candidate-username">
                    {t("admin.candidates.dialog.username")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="candidate-username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username)
                        setFieldErrors((prev) => ({ ...prev, username: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.username}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="candidate-password">
                    {t("admin.candidates.dialog.password")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="candidate-password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password)
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                    placeholder={t("validation.passwordMinChars", {
                      min: DEFAULT_PASSWORD_POLICY.minLength,
                    })}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>
              </>
            )}
            <Field>
              <Label htmlFor="candidate-name">
                {t("admin.candidates.dialog.name")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="candidate-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name)
                    setFieldErrors((prev) => ({ ...prev, name: "" }));
                }}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            {fields.map((field) => (
              <Field key={field.id}>
                <Label htmlFor={`candidate-field-${field.name}`}>
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-destructive">*</span>
                  )}
                </Label>
                <Input
                  id={`candidate-field-${field.name}`}
                  type={field.fieldType === "number" ? "number" : "text"}
                  value={values[field.name] ?? ""}
                  onChange={(e) => {
                    setValues((current) => ({
                      ...current,
                      [field.name]: e.target.value,
                    }));
                    if (fieldErrors[`field:${field.name}`]) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        [`field:${field.name}`]: "",
                      }));
                    }
                  }}
                />
                <FieldError>{fieldErrors[`field:${field.name}`]}</FieldError>
              </Field>
            ))}
          </FieldGroup>
          {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
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
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("admin.candidates.dialog.resetTitle")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <Label htmlFor="candidate-reset-password">
                {t("admin.candidates.dialog.newPassword")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="candidate-reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.value);
                  if (resetFieldError) setResetFieldError("");
                }}
                placeholder={t("validation.passwordMinChars", {
                  min: DEFAULT_PASSWORD_POLICY.minLength,
                })}
              />
            </Field>
            <Field>
              <Label htmlFor="candidate-reset-password-confirm">
                {t("admin.candidates.dialog.confirmNewPassword")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="candidate-reset-password-confirm"
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => {
                  setResetConfirmPassword(e.target.value);
                  if (resetFieldError) setResetFieldError("");
                }}
                placeholder={t("admin.candidates.dialog.confirmNewPassword")}
              />
              <FieldError>{resetFieldError}</FieldError>
            </Field>
            {resetTarget && (
              <p className="text-xs text-muted-foreground">
                {t("admin.candidates.dialog.resetDescription", {
                  name: resetTarget.name,
                })}
              </p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              {t("admin.common.cancel")}
            </Button>
            <Button
              data-testid="reset-password-confirm-btn"
              onClick={() => void confirmResetPassword()}
              disabled={resetting}
            >
              {resetting
                ? t("admin.candidates.dialog.resetting")
                : t("admin.candidates.dialog.confirmReset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        title={t("admin.candidates.importDialog.title")}
        instructions={t("admin.candidates.importDialog.instructions")}
        warning={
          importTruncated()
            ? t("admin.candidates.importDialog.truncated", {
                max: MAX_IMPORT_ROWS,
              })
            : undefined
        }
        csv={csv}
        onCsvChange={setCsv}
        preview={previewRows()}
        summary={importSummary}
        onConfirm={() => void importCsv()}
      />
    </div>
  );
}
