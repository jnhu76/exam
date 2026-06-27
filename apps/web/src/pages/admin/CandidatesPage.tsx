import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import {
  ImportWizard,
  type ImportPreviewRow,
} from "@/components/shared/ImportWizard";
import {
  AdminShell,
  AdminShellHeader,
  AdminSearchPanel,
  AdminTableShell,
  AdminToolbarButton,
} from "@/components/admin";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Plus, Search, Upload, Users, KeyRound } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";
import { SearchInput } from "@/components/shared/SearchInput";
import { RowActions } from "@/components/shared/RowActions";
import { DEFAULT_PASSWORD_POLICY } from "@exam/contracts";

/** Candidate custom field definition with display metadata. */
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
/** A candidate record with identity fields and custom field values. */
/** A candidate (examinee) record with identity fields. */
interface Candidate {
  id: string;
  username: string;
  name: string;
  isActive: boolean;
  fields: Record<string, unknown>;
}
/** Generic paginated API response wrapper. */
/** Generic paginated response wrapper. */
interface Page<T> {
  items: T[];
}

/** Admin candidate management page with search, CRUD, enable/disable, and CSV import. */
/**
 * Admin page for managing candidates (examinees).
 * Supports listing, searching, creating, editing, enabling/disabling candidates,
 * and bulk-importing via CSV with a preview wizard.
 */
export function CandidatesPage() {
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
  /** Fetches the candidate list and field definitions in parallel. */
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
      setError("加载考生列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  /** Candidates filtered by the current search term (matches name or username). */
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
  /** Opens the create/edit dialog, pre-filling form state from the given candidate or defaults. */
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
  /** Builds the fields payload object from form values, coercing number fields. */
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
  /** Validates the candidate form fields and sets field-level error messages. Returns true if valid. */
  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "请输入姓名";
    if (!editing) {
      if (!username.trim()) errors.username = "请输入用户名";
      if (password.length < DEFAULT_PASSWORD_POLICY.minLength)
        errors.password = `密码至少 ${DEFAULT_PASSWORD_POLICY.minLength} 位`;
    }
    for (const field of fields) {
      if (field.required && !(values[field.name] ?? "").toString().trim()) {
        errors[`field:${field.name}`] = "此字段为必填项";
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }
  /** Validates and persists the candidate via create or update API, then reloads the list. */
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
        toast.success("考生已更新");
      } else {
        await api.post("/api/candidates", {
          username,
          password,
          name,
          fields: payloadFields(),
        });
        toast.success("考生已创建");
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      const serverFieldErrors = getApiFieldErrors(err);
      setFieldErrors((current) => ({ ...current, ...serverFieldErrors }));
      setSaveError(getApiErrorMessage(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  }
  /** Toggles the active/disabled status of a candidate. */
  async function toggle(candidate: Candidate) {
    if (togglingId) return;
    setTogglingId(candidate.id);
    try {
      await api.patch(`/api/candidates/${candidate.id}`, {
        isActive: !candidate.isActive,
      });
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "操作失败，请稍后重试"));
    } finally {
      setTogglingId(null);
    }
  }
  /** Opens the reset-password dialog for the given candidate. */
  function openReset(candidate: Candidate) {
    setResetTarget(candidate);
    setResetPassword("");
    setResetConfirmPassword("");
    setResetFieldError("");
    setResetOpen(true);
  }
  /** Resets the targeted candidate's password via the admin API. */
  async function confirmResetPassword() {
    if (!resetTarget || resetting) return;
    const len = resetPassword.length;
    if (
      len < DEFAULT_PASSWORD_POLICY.minLength ||
      len > DEFAULT_PASSWORD_POLICY.maxLength
    ) {
      setResetFieldError(
        `密码长度必须在 ${DEFAULT_PASSWORD_POLICY.minLength} 到 ${DEFAULT_PASSWORD_POLICY.maxLength} 位之间`,
      );
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setResetFieldError("两次输入的密码不一致");
      return;
    }
    setResetting(true);
    try {
      await api.post(`/api/users/${resetTarget.id}/reset-password`, {
        newPassword: resetPassword,
      });
      toast.success("密码已重置");
      setResetOpen(false);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirmPassword("");
      setResetFieldError("");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "重置密码失败，请稍后重试"));
    } finally {
      setResetting(false);
    }
  }
  /** Converts field definitions to the CandidateFieldConfig format used by the import parser. */
  function fieldConfigs(): CandidateFieldConfig[] {
    return fields.map((f) => ({
      name: f.name,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      unique: f.unique,
    }));
  }
  /** Parses the raw CSV input into structured import rows. */
  function importRows() {
    return parseImportCsv(csv, fieldConfigs()).rows;
  }
  /** Returns true if the CSV input exceeded the maximum import row limit. */
  function importTruncated(): boolean {
    return parseImportCsv(csv, fieldConfigs()).truncated;
  }
  /** Builds preview rows for the import wizard, marking each as error, update, or create. */
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
          message: missing ? `${missing.label}不能为空` : "缺少用户名或姓名",
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
          message: "新增候选人需要初始密码",
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
          message: `初始密码至少 ${DEFAULT_PASSWORD_POLICY.minLength} 位`,
        };
      }
      const message = existsInDb
        ? "已存在，重复导入将覆盖现有资料"
        : inBatch
          ? "本批次内重复用户名，将覆盖前一行"
          : "将新增候选人";
      return {
        row: index + 2,
        status: exists ? "update" : "create",
        message,
      };
    });
  }
  /** Submits the parsed CSV rows to the import API and displays a summary. */
  async function importCsv() {
    try {
      const result = await api.post<{
        created: number;
        updated: number;
        errors: unknown[];
      }>("/api/candidates/import", { rows: importRows() });
      setImportSummary(
        `导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，错误 ${result.errors.length} 条`,
      );
      setCsv("");
      await load();
    } catch {
      toast.error("导入失败，请重试");
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
    <AdminShell>
      <AdminShellHeader
        title="考生管理"
        actions={
          <div className="flex gap-2">
            <AdminToolbarButton verb="add" icon={Plus} onClick={() => open()}>
              新增考生
            </AdminToolbarButton>
            <AdminToolbarButton
              verb="import"
              icon={Upload}
              onClick={() => {
                setImportOpen(true);
                setImportSummary("");
                setCsv("");
              }}
            >
              导入
            </AdminToolbarButton>
          </div>
        }
      />
      <AdminSearchPanel>
        <SearchInput
          aria-label="搜索考生"
          placeholder="搜索考生姓名或用户名..."
          value={search}
          onChange={setSearch}
          onClear={() => setSearch("")}
          clearLabel="清除考生搜索"
          containerClassName="max-w-md flex-1"
        />
      </AdminSearchPanel>
      {filteredCandidates.length === 0 && search ? (
        <EmptyState
          icon={<Search className="size-8" />}
          title="未找到匹配的考生"
          description={`没有符合「${search}」的考生。`}
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              清除搜索
            </Button>
          }
        />
      ) : filteredCandidates.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="暂无考生"
          description="可以通过「新增考生」或「导入」创建考生。"
          action={
            <div className="flex gap-2">
              <Button onClick={() => open()}>新增考生</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImportOpen(true);
                  setImportSummary("");
                  setCsv("");
                }}
              >
                导入
              </Button>
            </div>
          }
        />
      ) : (
        <AdminTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>姓名</TableHead>
                {fields.map((field) => (
                  <TableHead key={field.id}>{field.label}</TableHead>
                ))}
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCandidates.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell>{candidate.username}</TableCell>
                  <TableCell>{candidate.name}</TableCell>
                  {fields.map((field) => (
                    <TableCell key={field.id}>
                      {String(candidate.fields[field.name] ?? "-")}
                    </TableCell>
                  ))}
                  <TableCell>{candidate.isActive ? "启用" : "禁用"}</TableCell>
                  <TableCell>
                    <RowActions>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => open(candidate)}
                        aria-label="编辑考生"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openReset(candidate)}
                        aria-label="重置密码"
                        data-testid={`candidate-reset-password-${candidate.id}`}
                      >
                        <KeyRound />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={togglingId !== null}
                          >
                            {togglingId === candidate.id
                              ? "处理中..."
                              : candidate.isActive
                                ? "禁用"
                                : "启用"}
                          </Button>
                        }
                        title={candidate.isActive ? "确认禁用" : "确认启用"}
                        description={`确定要${candidate.isActive ? "禁用" : "启用"}考生「${candidate.name}」吗？`}
                        destructive={candidate.isActive}
                        onConfirm={() => void toggle(candidate)}
                      />
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminTableShell>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑考生" : "新增考生"}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            {!editing && (
              <>
                <Field>
                  <Label htmlFor="candidate-username">
                    用户名 <span className="text-destructive">*</span>
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
                    初始密码 <span className="text-destructive">*</span>
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
                    placeholder={`至少 ${DEFAULT_PASSWORD_POLICY.minLength} 位`}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>
              </>
            )}
            <Field>
              <Label htmlFor="candidate-name">
                姓名 <span className="text-destructive">*</span>
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
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <Label htmlFor="candidate-reset-password">
                新密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="candidate-reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.value);
                  if (resetFieldError) setResetFieldError("");
                }}
                placeholder={`${DEFAULT_PASSWORD_POLICY.minLength}-${DEFAULT_PASSWORD_POLICY.maxLength} 位`}
              />
            </Field>
            <Field>
              <Label htmlFor="candidate-reset-password-confirm">
                确认新密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="candidate-reset-password-confirm"
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => {
                  setResetConfirmPassword(e.target.value);
                  if (resetFieldError) setResetFieldError("");
                }}
                placeholder="请再次输入新密码"
              />
              <FieldError>{resetFieldError}</FieldError>
            </Field>
            {resetTarget && (
              <p className="text-xs text-muted-foreground">
                将重置考生「{resetTarget.name}」的登录密码。
              </p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              取消
            </Button>
            <Button
              data-testid="reset-password-confirm-btn"
              onClick={() => void confirmResetPassword()}
              disabled={resetting}
            >
              {resetting ? "重置中..." : "确认重置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        title="导入考生"
        instructions="粘贴 CSV 内容。表头需包含 username、password、name 以及配置的身份字段。"
        warning={
          importTruncated()
            ? `数据已截断为前 ${MAX_IMPORT_ROWS} 行，超出部分已忽略。`
            : undefined
        }
        csv={csv}
        onCsvChange={setCsv}
        preview={previewRows()}
        summary={importSummary}
        onConfirm={() => void importCsv()}
      />
    </AdminShell>
  );
}
