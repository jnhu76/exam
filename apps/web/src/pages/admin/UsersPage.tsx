import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { AppIcon } from "@/components/shared/AppIcon";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import { DataViewFooter } from "@/components/shared/DataViewFooter";
import { DataViewSearch } from "@/components/shared/DataViewSearch";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  ClipboardCheck,
  Pencil,
  Plus,
  Power,
  Users,
} from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";
import { RowActions } from "@/components/shared/RowActions";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageContainer } from "@/components/shared/PageContainer";
import { DEFAULT_PASSWORD_POLICY, type AssignableRole } from "@exam/contracts";
import { Permission } from "@exam/authz";
import { useAuth } from "@/hooks/useAuth";
import { can } from "@/lib/capabilities";
import { InvitationsCard } from "@/pages/admin/InvitationsCard";

/** User row shape as returned by the users list API. */
interface UserRow {
  id: string;
  username: string;
  name: string;
  /** Primary role; the API returns the full assignable set. */
  role: AssignableRole;
  /**
   * The target's ACTIVE role set from user_role_assignments — the truth for
   * assignment affordances. `role` above is only the primary-role compatibility
   * cache and must not gate assignment management.
   */
  activeRoles: AssignableRole[];
  isActive: boolean;
}

/** Generic paginated response containing a list of items. */
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Staff-list page size — real pagination reaches every staff target. */
const USERS_PAGE_SIZE = 20;
/** Option-catalog page size inside the assignment pickers. */
const CATALOG_PAGE_SIZE = 20;

/** Lifecycle of a mutation-support option catalog inside an assignment dialog. */
type CatalogStatus = "idle" | "loading" | "ready" | "unavailable";

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
 * Assignable-role item returned by GET /roles/assignable. The backend
 * @exam/authz ROLE_PRESETS is the SINGLE source of truth for the assignable
 * role set; this page consumes that authority instead of keeping a parallel
 * hardcoded closed set — a future role addition must not silently diverge the
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
  const { user: actor } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Latest-request guard: rapid page flips fire overlapping staff-list
  // requests; a stale response resolving last must not overwrite the table
  // (same contract as QuestionPage).
  const usersGenRef = useRef(0);
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
  // silently flip an unmapped role to Admin.
  const [roleLocked, setRoleLocked] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Teacher course-assignment dialog state (issue 286).
  const [assignmentsUser, setAssignmentsUser] = useState<UserRow | null>(null);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsBusy, setAssignmentsBusy] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  // Course option catalog — MUTATION-SUPPORT data only: fetched solely while
  // the assign-new affordance applies, so the assignment read projection never
  // depends on CourseView/ExamView surrogate routes. Search is server-side
  // (debounced DataViewSearch) and pagination is real, so every eligible course
  // is eventually selectable.
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [courseTotal, setCourseTotal] = useState(0);
  const [coursePage, setCoursePage] = useState(1);
  const [courseSearch, setCourseSearch] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [courseStatus, setCourseStatus] = useState<CatalogStatus>("idle");
  const courseGenRef = useRef(0);
  // Read-projection generation guards: a slow assignment GET for a previous
  // dialog target must not land in a dialog opened for another user.
  const assignmentsGenRef = useRef(0);

  // Grader exam-assignment dialog state (issue 296).
  const [examAssignmentsUser, setExamAssignmentsUser] =
    useState<UserRow | null>(null);
  const [examAssignments, setExamAssignments] = useState<ExamAssignment[]>([]);
  const [examAssignmentsLoading, setExamAssignmentsLoading] = useState(false);
  const [examAssignmentsBusy, setExamAssignmentsBusy] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  // Exam option catalog — same mutation-support contract as courses. The exam
  // list route has no search parameter, so reachability is pagination-only.
  const [examOptions, setExamOptions] = useState<ExamOption[]>([]);
  const [examTotal, setExamTotal] = useState(0);
  const [examPage, setExamPage] = useState(1);
  const [examStatus, setExamStatus] = useState<CatalogStatus>("idle");
  const examGenRef = useRef(0);
  const examAssignmentsGenRef = useRef(0);

  /** Staff roles selectable in the create/edit dialog (Candidate excluded). */
  const selectableRoles = assignableRoles.filter((r) => r.key !== "Candidate");

  // Actor capability gates: affordances are derived from the actor's
  // capability set — never from a role label. View decides whether the
  // assignment surface is offered at all; Manage decides whether the
  // assign/revoke controls inside it are mutable (View-without-Manage renders
  // the dialog read-only). UX truthfulness only; the server stays the
  // authority on every route.
  const canViewTeacherAssignments =
    actor !== null && can(actor, Permission.CourseTeacherAssignmentView);
  const canManageTeacherAssignments =
    actor !== null && can(actor, Permission.CourseTeacherAssignmentManage);
  const canViewGraderAssignments =
    actor !== null && can(actor, Permission.ExamGraderAssignmentView);
  const canManageGraderAssignments =
    actor !== null && can(actor, Permission.ExamGraderAssignmentManage);

  // The option catalogs load only while the assign-new affordance applies:
  // actor Manage capability × target active role × target account active. The
  // canonical write endpoints reject inactive targets, so the UI must not offer
  // a guaranteed-to-fail mutation.
  const courseCatalogApplicable =
    assignmentsUser !== null &&
    canManageTeacherAssignments &&
    assignmentsUser.isActive;
  const examCatalogApplicable =
    examAssignmentsUser !== null &&
    canManageGraderAssignments &&
    examAssignmentsUser.isActive;

  /**
   * Resolves a role display label: local i18n `roleLabels` wins; a missing
   * key falls back to the generic `unknown` label so an unlocalized backend
   * catalog label can never leak English into the UI. Catalog membership still
   * comes from the backend assignable roles; only the display fallback is
   * generic (fail-visible instead of leaking the key).
   */
  function roleLabel(key: string) {
    return t(`admin.users.roleLabels.${key}`, {
      defaultValue: t("admin.users.roleLabels.unknown"),
    });
  }

  /** Fetches the assignable-role authority and the current staff page. */
  const loadUsers = useCallback(async () => {
    const generation = ++usersGenRef.current;
    const isStale = () => generation !== usersGenRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        api.get<{ items: AssignableRoleItem[] }>("/api/roles/assignable"),
        // Real pagination: every staff target in the
        // canonical staff-management domain is reachable by paging — no fixed
        // first-page truncation.
        api.get<Page<UserRow>>(
          `/api/users?page=${usersPage}&pageSize=${USERS_PAGE_SIZE}`,
        ),
      ]);
      if (isStale()) return;
      setAssignableRoles(rolesRes.items);
      // The server already restricts the list to staff members
      // (assignment-aware, before pagination — F-03). No client-side role
      // post-filter here: a Candidate-primary user with a staff secondary
      // assignment must stay visible, and Candidate-only users can never
      // crowd staff off the page.
      setUsers(usersRes.items);
      setUsersTotal(usersRes.total);
    } catch {
      if (isStale()) return;
      setError(t("admin.users.loadFailed"));
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [usersPage, t]);
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
    // would otherwise flip the role. selectableRoles (not assignableRoles) is
    // the membership check: the dialog can only ever offer roles it can actually
    // render as options.
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

  /**
   * Loads the assignment read projection for the dialog user. This GET is
   * the dialog's only required request: it succeeds or fails independently
   * of the option catalog. The generation guard
   * keeps a slow response for a previous target from landing in a dialog
   * opened for another user.
   */
  async function refreshAssignments(user: UserRow) {
    const generation = ++assignmentsGenRef.current;
    const isStale = () => generation !== assignmentsGenRef.current;
    setAssignmentsLoading(true);
    try {
      const assignmentRes = await api.get<{ items: CourseAssignment[] }>(
        `/api/admin/users/${user.id}/course-assignments?status=all`,
      );
      if (isStale()) return;
      setAssignments(assignmentRes.items);
    } catch (err) {
      if (isStale()) return;
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.teacherCourses.loadFailed")),
      );
      // The read itself failed — the dialog has no projection to show.
      setAssignmentsUser(null);
    } finally {
      if (!isStale()) setAssignmentsLoading(false);
    }
  }

  /** Opens the Teacher course-assignment dialog for a Teacher user. */
  function openAssignments(user: UserRow) {
    courseGenRef.current++; // cancel any in-flight catalog request
    setAssignmentsUser(user);
    setAssignments([]);
    setSelectedCourseId("");
    setCourseOptions([]);
    setCourseTotal(0);
    setCoursePage(1);
    setCourseSearch("");
    setCourseQuery("");
    setCourseStatus("idle");
    void refreshAssignments(user);
  }

  /**
   * Loads one page of the course option catalog. The catalog is
   * mutation-support data: a failure downgrades only the picker (status
   * "unavailable" + retry) and never discards the assignment read.
   */
  const loadCourseCatalog = useCallback(async () => {
    const generation = ++courseGenRef.current;
    const isStale = () => generation !== courseGenRef.current;
    setCourseStatus("loading");
    try {
      const params = new URLSearchParams({
        page: String(coursePage),
        pageSize: String(CATALOG_PAGE_SIZE),
      });
      if (courseQuery.trim()) params.set("search", courseQuery.trim());
      const courseRes = await api.get<Page<CourseOption>>(
        `/api/courses?${params.toString()}`,
      );
      if (isStale()) return;
      setCourseOptions(courseRes.items);
      setCourseTotal(courseRes.total);
      setCourseStatus("ready");
    } catch {
      if (isStale()) return;
      setCourseOptions([]);
      setCourseTotal(0);
      setCourseStatus("unavailable");
    }
  }, [coursePage, courseQuery]);
  useEffect(() => {
    if (!courseCatalogApplicable) return;
    void loadCourseCatalog();
  }, [courseCatalogApplicable, loadCourseCatalog]);

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
      await refreshAssignments(assignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          t,
          t("admin.users.teacherCourses.assignFailed"),
        ),
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
      await refreshAssignments(assignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          t,
          t("admin.users.teacherCourses.revokeFailed"),
        ),
      );
    } finally {
      setAssignmentsBusy(false);
    }
  }

  /**
   * Loads the grader assignment read projection — independent of the exam
   * option catalog, with the same stale-response
   * guard as the teacher dialog.
   */
  async function refreshExamAssignments(user: UserRow) {
    const generation = ++examAssignmentsGenRef.current;
    const isStale = () => generation !== examAssignmentsGenRef.current;
    setExamAssignmentsLoading(true);
    try {
      const assignmentRes = await api.get<{ items: ExamAssignment[] }>(
        `/api/admin/users/${user.id}/exam-assignments?status=all`,
      );
      if (isStale()) return;
      setExamAssignments(assignmentRes.items);
    } catch (err) {
      if (isStale()) return;
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.loadFailed")),
      );
      setExamAssignmentsUser(null);
    } finally {
      if (!isStale()) setExamAssignmentsLoading(false);
    }
  }

  /** Opens the Grader exam-assignment dialog for a Grader user. */
  function openExamAssignments(user: UserRow) {
    examGenRef.current++;
    setExamAssignmentsUser(user);
    setExamAssignments([]);
    setSelectedExamId("");
    setExamOptions([]);
    setExamTotal(0);
    setExamPage(1);
    setExamStatus("idle");
    void refreshExamAssignments(user);
  }

  /**
   * Loads one page of the exam option catalog (mutation-support data; a
   * failure downgrades only the picker, never the assignment read).
   */
  const loadExamCatalog = useCallback(async () => {
    const generation = ++examGenRef.current;
    const isStale = () => generation !== examGenRef.current;
    setExamStatus("loading");
    try {
      const examRes = await api.get<Page<ExamOption>>(
        `/api/exams?page=${examPage}&pageSize=${CATALOG_PAGE_SIZE}`,
      );
      if (isStale()) return;
      setExamOptions(examRes.items);
      setExamTotal(examRes.total);
      setExamStatus("ready");
    } catch {
      if (isStale()) return;
      setExamOptions([]);
      setExamTotal(0);
      setExamStatus("unavailable");
    }
  }, [examPage]);
  useEffect(() => {
    if (!examCatalogApplicable) return;
    void loadExamCatalog();
  }, [examCatalogApplicable, loadExamCatalog]);

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
      await refreshExamAssignments(examAssignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.assignFailed")),
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
      await refreshExamAssignments(examAssignmentsUser);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.graderExams.revokeFailed")),
      );
    } finally {
      setExamAssignmentsBusy(false);
    }
  }

  // Single-source column declarations (issue 457): the same array feeds the
  // desktop table and the derived mobile card list — no page-local mobile map.
  const columns: DataViewColumnDef<UserRow>[] = [
    {
      id: "username",
      meta: { role: "primary-text" },
      header: t("admin.users.columns.username"),
      cell: ({ row }) => row.original.username,
    },
    {
      id: "name",
      meta: { role: "primary-text" },
      header: t("admin.users.columns.name"),
      cell: ({ row }) => row.original.name,
    },
    {
      id: "role",
      // priority "normal": the account role is identity-critical on the card;
      // role "type" alone would default to low and drop it (issue 457 audit).
      meta: { role: "type", priority: "normal" },
      header: t("admin.users.columns.role"),
      cell: ({ row }) => (
        <Badge variant="outline">{roleLabel(row.original.role)}</Badge>
      ),
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.users.columns.status"),
      cell: ({ row }) => (
        <StatusBadge status={row.original.isActive ? "active" : "inactive"} />
      ),
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.users.columns.actions"),
      cell: ({ row }) => {
        const user = row.original;
        return (
          <RowActions
            row={user}
            actions={[
              {
                id: "edit",
                label: t("admin.users.editLabel"),
                icon: Pencil,
                onSelect: () => open(user),
              },
              // The target's ACTIVE role membership (assignment truth, not the
              // primary-role cache) decides eligibility; the ACTOR's capability
              // decides whether the surface is offered.
              ...(canViewTeacherAssignments &&
              user.activeRoles.includes("Teacher")
                ? [
                    {
                      id: "teacher-courses",
                      label: t("admin.users.teacherCourses.openBtn"),
                      icon: BookOpen,
                      onSelect: () => void openAssignments(user),
                    },
                  ]
                : []),
              ...(canViewGraderAssignments &&
              user.activeRoles.includes("Grader")
                ? [
                    {
                      id: "grader-exams",
                      label: t("admin.users.graderExams.openBtn"),
                      icon: ClipboardCheck,
                      onSelect: () => void openExamAssignments(user),
                    },
                  ]
                : []),
              {
                id: "toggle-active",
                label: user.isActive
                  ? t("admin.common.disable")
                  : t("admin.common.enable"),
                icon: Power,
                tone: user.isActive ? "destructive" : "default",
                disabled: togglingId !== null,
                confirm: {
                  title: user.isActive
                    ? t("admin.common.confirmDisable")
                    : t("admin.common.confirmEnable"),
                  description: t("admin.users.enableDisable", {
                    action: user.isActive
                      ? t("admin.common.disable")
                      : t("admin.common.enable"),
                    name: user.name,
                  }),
                  destructive: user.isActive,
                },
                onSelect: () => void toggle(user),
              },
            ]}
          />
        );
      },
    },
  ];

  // Full-page loader only for the initial load: page flips keep the table
  // (and its pagination controls) mounted while the next page is in flight.
  if (isLoading && users.length === 0) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadUsers} />;
  return (
    <PageContainer role="admin-dense" className="flex flex-col gap-6">
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
        <DataTableShell
          footer={
            usersTotal > USERS_PAGE_SIZE ? (
              <DataViewFooter
                range={{
                  page: usersPage,
                  pageSize: USERS_PAGE_SIZE,
                  total: usersTotal,
                }}
                navigation={
                  <DataTablePagination
                    page={usersPage}
                    pageSize={USERS_PAGE_SIZE}
                    total={usersTotal}
                    onPageChange={setUsersPage}
                  />
                }
              />
            ) : undefined
          }
          mobile={
            <MobileRecordList
              columns={columns}
              rows={users}
              getRowId={(u) => u.id}
            />
          }
        >
          <DesktopDataTable
            columns={columns}
            data={users}
            getRowId={(u) => u.id}
          />
        </DataTableShell>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          // Busy close contract: Esc/overlay/X must not change open state
          // while a save is in flight.
          if (!next && saving) return;
          setDialogOpen(next);
        }}
      >
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
          // Busy close contract: no close via Esc/overlay/X while an
          // assign/revoke request is in flight.
          if (!next && assignmentsBusy) return;
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
              {canManageTeacherAssignments &&
                (assignmentsUser?.isActive ? (
                  <Field>
                    <Label>{t("admin.users.teacherCourses.pickLabel")}</Label>
                    {courseStatus === "unavailable" ? (
                      <div className="flex items-center gap-2">
                        <p className="type-secondary">
                          {t("admin.users.teacherCourses.optionsUnavailable")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadCourseCatalog()}
                        >
                          {t("common.retry")}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <DataViewSearch
                          value={courseSearch}
                          onChange={setCourseSearch}
                          onSearch={(term) => {
                            setCourseQuery(term);
                            setCoursePage(1);
                          }}
                          // The default clear only empties the input value;
                          // the committed server query and page must reset
                          // with it, or the visible unfiltered list would
                          // still be filtered and paged server-side.
                          onClear={() => {
                            setCourseSearch("");
                            setCourseQuery("");
                            setCoursePage(1);
                          }}
                          loading={courseStatus === "loading"}
                        />
                        {courseStatus === "ready" &&
                        courseOptions.length === 0 ? (
                          <p className="type-secondary py-2">
                            {t("admin.users.teacherCourses.optionsEmpty")}
                          </p>
                        ) : (
                          <RadioGroup
                            value={selectedCourseId}
                            onValueChange={setSelectedCourseId}
                            aria-label={t(
                              "admin.users.teacherCourses.pickPlaceholder",
                            )}
                            className="max-h-64 gap-2 overflow-y-auto"
                          >
                            {courseOptions.map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center gap-2"
                              >
                                <RadioGroupItem
                                  value={c.id}
                                  id={`course-option-${c.id}`}
                                />
                                <Label
                                  htmlFor={`course-option-${c.id}`}
                                  className="min-w-0 truncate font-normal"
                                >
                                  {c.name} ({c.code})
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        )}
                        {courseTotal > CATALOG_PAGE_SIZE && (
                          <DataViewFooter
                            range={{
                              page: coursePage,
                              pageSize: CATALOG_PAGE_SIZE,
                              total: courseTotal,
                            }}
                            navigation={
                              <DataTablePagination
                                page={coursePage}
                                pageSize={CATALOG_PAGE_SIZE}
                                total={courseTotal}
                                onPageChange={setCoursePage}
                              />
                            }
                          />
                        )}
                        <div className="flex justify-end">
                          <Button
                            onClick={() => void assignCourse()}
                            disabled={!selectedCourseId || assignmentsBusy}
                          >
                            {t("admin.users.teacherCourses.assignBtn")}
                          </Button>
                        </div>
                      </>
                    )}
                  </Field>
                ) : (
                  <p
                    className="type-secondary"
                    data-testid="teacher-assign-inactive"
                  >
                    {t("admin.users.teacherCourses.inactiveTarget")}
                  </p>
                ))}
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
                            {canManageTeacherAssignments && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={assignmentsBusy}
                                onClick={() => void revokeCourse(a)}
                              >
                                {t("admin.users.teacherCourses.revokeBtn")}
                              </Button>
                            )}
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
          // Busy close contract.
          if (!next && examAssignmentsBusy) return;
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
              {canManageGraderAssignments &&
                (examAssignmentsUser?.isActive ? (
                  <Field>
                    <Label>{t("admin.users.graderExams.pickLabel")}</Label>
                    {examStatus === "unavailable" ? (
                      <div className="flex items-center gap-2">
                        <p className="type-secondary">
                          {t("admin.users.graderExams.optionsUnavailable")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadExamCatalog()}
                        >
                          {t("common.retry")}
                        </Button>
                      </div>
                    ) : (
                      <>
                        {examStatus === "ready" && examOptions.length === 0 ? (
                          <p className="type-secondary py-2">
                            {t("admin.users.graderExams.optionsEmpty")}
                          </p>
                        ) : (
                          <RadioGroup
                            value={selectedExamId}
                            onValueChange={setSelectedExamId}
                            aria-label={t(
                              "admin.users.graderExams.pickPlaceholder",
                            )}
                            className="max-h-64 gap-2 overflow-y-auto"
                          >
                            {examOptions.map((e) => (
                              <div
                                key={e.id}
                                className="flex items-center gap-2"
                              >
                                <RadioGroupItem
                                  value={e.id}
                                  id={`exam-option-${e.id}`}
                                />
                                <Label
                                  htmlFor={`exam-option-${e.id}`}
                                  className="min-w-0 truncate font-normal"
                                >
                                  {e.title}
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        )}
                        {examTotal > CATALOG_PAGE_SIZE && (
                          <DataViewFooter
                            range={{
                              page: examPage,
                              pageSize: CATALOG_PAGE_SIZE,
                              total: examTotal,
                            }}
                            navigation={
                              <DataTablePagination
                                page={examPage}
                                pageSize={CATALOG_PAGE_SIZE}
                                total={examTotal}
                                onPageChange={setExamPage}
                              />
                            }
                          />
                        )}
                        <div className="flex justify-end">
                          <Button
                            onClick={() => void assignExam()}
                            disabled={!selectedExamId || examAssignmentsBusy}
                          >
                            {t("admin.users.graderExams.assignBtn")}
                          </Button>
                        </div>
                      </>
                    )}
                  </Field>
                ) : (
                  <p
                    className="type-secondary"
                    data-testid="grader-assign-inactive"
                  >
                    {t("admin.users.graderExams.inactiveTarget")}
                  </p>
                ))}
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
                            {canManageGraderAssignments && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={examAssignmentsBusy}
                                onClick={() => void revokeExam(a)}
                              >
                                {t("admin.users.graderExams.revokeBtn")}
                              </Button>
                            )}
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
    </PageContainer>
  );
}
