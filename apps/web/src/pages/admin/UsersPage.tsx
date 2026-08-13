import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { AppIcon } from "@/components/shared/AppIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus, Users } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";
import { RowActions } from "@/components/shared/RowActions";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DEFAULT_PASSWORD_POLICY, type AssignableRole } from "@exam/contracts";

/** User row shape as returned by the users list API. */
interface UserRow {
  id: string;
  username: string;
  name: string;
  /** Primary role; the API returns the full assignable set (RBAC-M8). */
  role: AssignableRole;
  isActive: boolean;
}

/** Generic paginated response containing a list of items. */
interface Page<T> {
  items: T[];
}

/**
 * Assignable-role item returned by GET /roles/assignable (RBAC-M8). The
 * backend @exam/authz ROLE_PRESETS is the SINGLE source of truth for the
 * assignable role set; this page consumes that authority instead of keeping a
 * parallel hardcoded closed set. P7-RBAC-REMEDIATION F-01: the prior
 * EDITABLE_ROLES array duplicated the backend and GET /roles/assignable had
 * zero frontend consumers — a future role addition would silently diverge the
 * selector. Candidate is excluded from the staff-creation selector because
 * candidates are managed via the dedicated candidate flow.
 */
interface AssignableRoleItem {
  key: AssignableRole;
  label: string;
  purpose: string;
}

/** Admin page for managing platform users (create, edit, enable/disable). */
export function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Selectable staff roles, sourced from the backend assignable-role authority
  // (GET /roles/assignable). Candidate is filtered out for the staff selector.
  const [assignableRoles, setAssignableRoles] = useState<AssignableRoleItem[]>(
    [],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AssignableRole>("Admin");
  // Edit-only: true when the editing user's current role is NOT in the
  // assignable catalog (drift / future-compatible state). The dialog then
  // shows the role read-only and PATCH omits `role` — the save can never
  // silently flip an unmapped role to Admin (P7 review #6).
  const [roleLocked, setRoleLocked] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  /** Staff roles selectable in the create/edit dialog (Candidate excluded). */
  const selectableRoles = assignableRoles.filter((r) => r.key !== "Candidate");

  /**
   * Resolves a role display label: local i18n `roleLabels` wins; a missing
   * key falls back to the generic `unknown` label so an unlocalized backend
   * catalog label can never leak English into the UI (P7 review #5). Catalog
   * membership still comes from the backend assignable roles; only the
   * display fallback is generic (fail-visible instead of leaking the key).
   */
  function roleLabel(key: string) {
    return t(`admin.users.roleLabels.${key}`, {
      defaultValue: t("admin.users.roleLabels.unknown"),
    });
  }

  /** Fetches the assignable-role authority and the staff user list. */
  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        api.get<{ items: AssignableRoleItem[] }>("/api/roles/assignable"),
        api.get<Page<UserRow>>("/api/users"),
      ]);
      setAssignableRoles(rolesRes.items);
      // The server already restricts the list to staff members
      // (assignment-aware, before pagination — F-03). No client-side role
      // post-filter here: a Candidate-primary user with a staff secondary
      // assignment must stay visible, and Candidate-only users can never
      // crowd staff off the page.
      setUsers(usersRes.items);
    } catch {
      setError(t("admin.users.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void loadUsers(), [loadUsers]);

  /** Opens the create/edit dialog, optionally pre-filling with an existing user. */
  function open(user?: UserRow) {
    setEditing(user ?? null);
    setUsername(user?.username ?? "");
    setPassword("");
    setName(user?.name ?? "");
    // Create: default Admin is acceptable. Edit: a current role that is not
    // selectable in the staff dialog (missing from the catalog, or the
    // Candidate compatibility role of a Candidate-primary + staff-secondary
    // user) locks the selector instead of silently selecting Admin — saving
    // would otherwise flip the role (P7 review #6). selectableRoles (not
    // assignableRoles) is the membership check: the dialog can only ever
    // offer roles it can actually render as options.
    if (!user) {
      setRole("Admin");
      setRoleLocked(false);
    } else if (selectableRoles.some((r) => r.key === user.role)) {
      setRole(user.role);
      setRoleLocked(false);
    } else {
      setRole("Admin");
      setRoleLocked(true);
    }
    setFieldErrors({});
    setDialogOpen(true);
  }

  /** Validates the form fields and returns true if valid. */
  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = t("admin.users.validation.nameRequired");
    if (!editing) {
      if (!username.trim())
        errors.username = t("admin.users.validation.usernameRequired");
      if (password.length < DEFAULT_PASSWORD_POLICY.minLength)
        errors.password = t("admin.users.validation.passwordMin", {
          min: DEFAULT_PASSWORD_POLICY.minLength,
        });
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /** Saves a new or updated user and refreshes the user list. */
  async function save() {
    if (saving || !validate()) return;
    setSaving(true);
    try {
      if (editing) {
        const payload: { name: string; role?: AssignableRole } = { name };
        // A locked (unmapped) current role must never be overwritten by the
        // default value — omit `role` so the server keeps the original.
        if (!roleLocked) payload.role = role;
        await api.patch(`/api/users/${editing.id}`, payload);
      } else {
        await api.post("/api/users", { username, password, name, role });
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("admin.common.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  /** Toggles the active/inactive status of a user account. */
  async function toggle(user: UserRow) {
    if (togglingId) return;
    setTogglingId(user.id);
    try {
      await api.patch(`/api/users/${user.id}`, { isActive: !user.isActive });
      await loadUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, t("admin.common.operationFailed")));
    } finally {
      setTogglingId(null);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadUsers} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.users.title")}
        actions={
          <Button onClick={() => open()}>
            <AppIcon icon={Plus} size="inline" />
            {t("admin.users.createBtn")}
          </Button>
        }
      />
      {users.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Users} size="state" />}
          title={t("admin.users.empty")}
          description={t("admin.users.emptyDescription")}
        />
      ) : (
        <DataTableShell minTableWidth="compact" actionsDensity="normal">
          <Table>
            <DataTableColumns
              columns={[
                { role: "short-id" },
                { role: "primary-text" },
                { role: "type" },
                { role: "status" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="short-id">
                  {t("admin.users.columns.username")}
                </DataTableHead>
                <DataTableHead role="primary-text">
                  {t("admin.users.columns.name")}
                </DataTableHead>
                <DataTableHead role="type">
                  {t("admin.users.columns.role")}
                </DataTableHead>
                <DataTableHead role="status">
                  {t("admin.users.columns.status")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.users.columns.actions")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <DataTableCell role="short-id">{user.username}</DataTableCell>
                  <DataTableCell role="primary-text">{user.name}</DataTableCell>
                  <DataTableCell role="type">
                    <Badge variant="outline">{roleLabel(user.role)}</Badge>
                  </DataTableCell>
                  <DataTableCell role="status">
                    <StatusBadge
                      status={user.isActive ? "active" : "inactive"}
                    />
                  </DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => open(user)}
                        aria-label={t("admin.users.editLabel")}
                      >
                        <AppIcon icon={Pencil} size="inline" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={togglingId !== null}
                          >
                            {togglingId === user.id
                              ? t("admin.common.processing")
                              : user.isActive
                                ? t("admin.common.disable")
                                : t("admin.common.enable")}
                          </Button>
                        }
                        title={
                          user.isActive
                            ? t("admin.common.confirmDisable")
                            : t("admin.common.confirmEnable")
                        }
                        description={t("admin.users.enableDisable", {
                          action: user.isActive
                            ? t("admin.common.disable")
                            : t("admin.common.enable"),
                          name: user.name,
                        })}
                        destructive={user.isActive}
                        onConfirm={() => void toggle(user)}
                      />
                    </RowActions>
                  </DataTableCell>
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
              {editing
                ? t("admin.users.dialog.edit")
                : t("admin.users.dialog.create")}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            {!editing && (
              <>
                <Field>
                  <Label>{t("admin.users.dialog.username")}</Label>
                  <Input
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
                  <Label>{t("admin.users.dialog.password")}</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password)
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>
              </>
            )}
            <Field>
              <Label>{t("admin.users.dialog.name")}</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name)
                    setFieldErrors((prev) => ({ ...prev, name: "" }));
                }}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            <Field>
              <Label>{t("admin.users.dialog.role")}</Label>
              {roleLocked && editing ? (
                <p
                  className="py-2 text-sm text-muted-foreground"
                  data-testid="locked-role"
                >
                  {t("admin.users.dialog.roleLockedHint", {
                    role: roleLabel(editing.role),
                  })}
                </p>
              ) : (
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as AssignableRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableRoles.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {roleLabel(r.key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </FieldGroup>
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
    </div>
  );
}
