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
import { InvitationsCard } from "@/pages/admin/InvitationsCard";

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

/** Course item (subset) as returned by GET /courses. */
interface CourseOption {
  id: string;
  name: string;
  code: string;
}

/** Teacher-to-Course assignment episode as returned by the assignment API. */
interface CourseAssignment {
  id: string;
  courseId: string;
  status: "active" | "revoked";
  assignedAt: string;
  revokedAt: string | null;
}

/** Grader exam picker option (Admin exam list). */
interface ExamOption {
  id: string;
  title: string;
}

/** Grader-to-Exam assignment episode as returned by the assignment API. */
interface ExamAssignment {
  id: string;
  examId: string;
  status: "active" | "revoked";
  assignedAt: string;
  revokedAt: string | null;
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

  // Teacher course-assignment dialog state (issue 286).
  const [assignmentsUser, setAssignmentsUser] = useState<UserRow | null>(null);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsBusy, setAssignmentsBusy] = useState(false);

  // Grader exam-assignment dialog state (issue 296).
  const [examAssignmentsUser, setExamAssignmentsUser] =
    useState<UserRow | null>(null);
  const [examAssignments, setExamAssignments] = useState<ExamAssignment[]>([]);
  const [examOptions, setExamOptions] = useState<ExamOption[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [examAssignmentsLoading, setExamAssignmentsLoading] = useState(false);
  const [examAssignmentsBusy, setExamAssignmentsBusy] = useState(false);

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
      toast.error(getApiErrorMessage(err, t, t("admin.common.saveFailed")));
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
      toast.error(
        getApiErrorMessage(err, t, t("admin.common.operationFailed")),
      );
    } finally {
      setTogglingId(null);
    }
  }

  /** Opens the Teacher course-assignment dialog for a Teacher user. */
  async function openAssignments(user: UserRow) {
    setAssignmentsUser(user);
    setAssignments([]);
    setSelectedCourseId("");
    setAssignmentsLoading(true);
    try {
      const [assignmentRes, courseRes] = await Promise.all([
        api.get<{ items: CourseAssignment[] }>(
          `/api/admin/users/${user.id}/course-assignments?status=all`,
        ),
        api.get<Page<CourseOption>>("/api/courses?page=1&pageSize=100"),
      ]);
      setAssignments(assignmentRes.items);
      setCourseOptions(courseRes.items);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.teacherCourses.loadFailed")),
      );
      setAssignmentsUser(null);
    } finally {
      setAssignmentsLoading(false);
    }
  }

  /** Assigns the selected course to the dialog user and refreshes the list. */
  async function assignCourse() {
    if (!assignmentsUser || !selectedCourseId || assignmentsBusy) return;
    setAssignmentsBusy(true);
    try {
      const res = await api.post<{ outcome: "applied" | "no_change" }>(
        `/api/admin/users/${assignmentsUser.id}/course-assignments`,
        { courseId: selectedCourseId },
      );
      if (res.outcome === "no_change") {
        toast.info(t("admin.users.teacherCourses.noChange"));
      }
      setSelectedCourseId("");
      await openAssignments(assignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.teacherCourses.loadFailed")),
      );
    } finally {
      setAssignmentsBusy(false);
    }
  }

  /** Revokes an active course assignment (next-request effective). */
  async function revokeCourse(assignment: CourseAssignment) {
    if (!assignmentsUser || assignmentsBusy) return;
    setAssignmentsBusy(true);
    try {
      await api.post(
        `/api/admin/users/${assignmentsUser.id}/course-assignments/${assignment.courseId}/revoke`,
      );
      await openAssignments(assignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.teacherCourses.loadFailed")),
      );
    } finally {
      setAssignmentsBusy(false);
    }
  }

  /** Opens the Grader exam-assignment dialog for a Grader user. */
  async function openExamAssignments(user: UserRow) {
    setExamAssignmentsUser(user);
    setExamAssignments([]);
    setSelectedExamId("");
    setExamAssignmentsLoading(true);
    try {
      const [assignmentRes, examRes] = await Promise.all([
        api.get<{ items: ExamAssignment[] }>(
          `/api/admin/users/${user.id}/exam-assignments?status=all`,
        ),
        api.get<Page<ExamOption>>("/api/exams?page=1&pageSize=100"),
      ]);
      setExamAssignments(assignmentRes.items);
      setExamOptions(examRes.items);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.loadFailed")),
      );
      setExamAssignmentsUser(null);
    } finally {
      setExamAssignmentsLoading(false);
    }
  }

  /** Assigns the selected exam to the dialog user and refreshes the list. */
  async function assignExam() {
    if (!examAssignmentsUser || !selectedExamId || examAssignmentsBusy) return;
    setExamAssignmentsBusy(true);
    try {
      const res = await api.post<{ outcome: "applied" | "no_change" }>(
        `/api/admin/users/${examAssignmentsUser.id}/exam-assignments`,
        { examId: selectedExamId },
      );
      if (res.outcome === "no_change") {
        toast.info(t("admin.users.graderExams.noChange"));
      }
      setSelectedExamId("");
      await openExamAssignments(examAssignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.loadFailed")),
      );
    } finally {
      setExamAssignmentsBusy(false);
    }
  }

  /** Revokes an active exam assignment (next-request effective). */
  async function revokeExam(assignment: ExamAssignment) {
    if (!examAssignmentsUser || examAssignmentsBusy) return;
    setExamAssignmentsBusy(true);
    try {
      await api.post(
        `/api/admin/users/${examAssignmentsUser.id}/exam-assignments/${assignment.examId}/revoke`,
      );
      await openExamAssignments(examAssignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.loadFailed")),
      );
    } finally {
      setExamAssignmentsBusy(false);
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
      <InvitationsCard roles={selectableRoles} />
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
                      {user.role === "Teacher" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openAssignments(user)}
                        >
                          {t("admin.users.teacherCourses.openBtn")}
                        </Button>
                      )}
                      {user.role === "Grader" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openExamAssignments(user)}
                        >
                          {t("admin.users.graderExams.openBtn")}
                        </Button>
                      )}
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
                <p className="py-2 type-secondary" data-testid="locked-role">
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
      <Dialog
        open={assignmentsUser !== null}
        onOpenChange={(next) => {
          if (!next) setAssignmentsUser(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {t("admin.users.teacherCourses.dialogTitle", {
                name: assignmentsUser?.name ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {assignmentsLoading ? (
            <p className="py-4 type-secondary">{t("admin.common.loading")}</p>
          ) : (
            <FieldGroup className="py-4">
              <Field>
                <Label>{t("admin.users.teacherCourses.pickLabel")}</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedCourseId}
                    onValueChange={setSelectedCourseId}
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue
                        placeholder={t(
                          "admin.users.teacherCourses.pickPlaceholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {courseOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => void assignCourse()}
                    disabled={!selectedCourseId || assignmentsBusy}
                  >
                    {t("admin.users.teacherCourses.assignBtn")}
                  </Button>
                </div>
              </Field>
              <Field>
                <Label>{t("admin.users.teacherCourses.currentLabel")}</Label>
                {assignments.filter((a) => a.status === "active").length ===
                0 ? (
                  <p className="py-2 type-secondary">
                    {t("admin.users.teacherCourses.empty")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {assignments
                      .filter((a) => a.status === "active")
                      .map((a) => {
                        const course = courseOptions.find(
                          (c) => c.id === a.courseId,
                        );
                        return (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {course
                                ? `${course.name} (${course.code})`
                                : a.courseId}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={assignmentsBusy}
                              onClick={() => void revokeCourse(a)}
                            >
                              {t("admin.users.teacherCourses.revokeBtn")}
                            </Button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignmentsUser(null)}
              disabled={assignmentsBusy}
            >
              {t("admin.common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={examAssignmentsUser !== null}
        onOpenChange={(next) => {
          if (!next) setExamAssignmentsUser(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {t("admin.users.graderExams.dialogTitle", {
                name: examAssignmentsUser?.name ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {examAssignmentsLoading ? (
            <p className="py-4 type-secondary">{t("admin.common.loading")}</p>
          ) : (
            <FieldGroup className="py-4">
              <Field>
                <Label>{t("admin.users.graderExams.pickLabel")}</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedExamId}
                    onValueChange={setSelectedExamId}
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue
                        placeholder={t(
                          "admin.users.graderExams.pickPlaceholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {examOptions.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => void assignExam()}
                    disabled={!selectedExamId || examAssignmentsBusy}
                  >
                    {t("admin.users.graderExams.assignBtn")}
                  </Button>
                </div>
              </Field>
              <Field>
                <Label>{t("admin.users.graderExams.currentLabel")}</Label>
                {examAssignments.filter((a) => a.status === "active").length ===
                0 ? (
                  <p className="py-2 type-secondary">
                    {t("admin.users.graderExams.empty")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {examAssignments
                      .filter((a) => a.status === "active")
                      .map((a) => {
                        const exam = examOptions.find((e) => e.id === a.examId);
                        return (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {exam ? exam.title : a.examId}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={examAssignmentsBusy}
                              onClick={() => void revokeExam(a)}
                            >
                              {t("admin.users.graderExams.revokeBtn")}
                            </Button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExamAssignmentsUser(null)}
              disabled={examAssignmentsBusy}
            >
              {t("admin.common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
