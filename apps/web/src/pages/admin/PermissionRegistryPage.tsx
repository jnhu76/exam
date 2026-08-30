import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { PermissionCategory } from "@exam/authz";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AppIcon } from "@/components/shared/AppIcon";
import { BadgeCheck, KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Backend projections (mirror the @exam/contracts response schemas). */
interface PermissionEntry {
  key: string;
  category: string;
}
interface RolePresetEntry {
  key: string;
  label: string;
  purpose: string;
  isSystem: boolean;
  assignable: boolean;
  loginAllowed: boolean;
  defaultScope: string;
  permissions: string[];
  sensitivePermissions: string[];
}
interface PermissionRegistryResponse {
  permissions: PermissionEntry[];
  rolePresets: RolePresetEntry[];
}

interface UserSummary {
  id: string;
  username: string;
  name: string;
}
interface UserListResponse {
  items: UserSummary[];
}

interface EffectiveAuthorityResponse {
  user: { id: string; name: string | null; username: string };
  authority:
    | {
        ok: true;
        authority: {
          primaryRole: string;
          activeRoles: string[];
          capabilities: string[];
          assignmentIds: string[];
        };
      }
    | { ok: false; reason: string };
  assignments: Array<{
    id: string;
    role: string;
    isPrimary: boolean;
    isActive: boolean;
    createdAt: string;
  }>;
}

/** Canonical category ordering for stable display (mirrors ADR §4.x). */
const CATEGORY_ORDER = Object.values(PermissionCategory);

/**
 * Permission registry + effective-authority inspector.
 *
 * Every field is a READ PROJECTION of existing authority — the permission
 * catalog, the role presets, and the assignment-authority kernel. This page
 * never mutates anything and never re-derives a second authority; the backend
 * endpoints it consumes are themselves projections of `@exam/authz` /
 * `deriveAssignmentAuthority`. Capability keys render verbatim (they are the
 * canonical vocabulary); category grouping is the semantic display grouping.
 */
export function PermissionRegistryPage() {
  const { t } = useTranslation();

  const [registry, setRegistry] = useState<PermissionRegistryResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Effective-authority inspector state.
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [authority, setAuthority] = useState<EffectiveAuthorityResponse | null>(
    null,
  );
  const [authorityLoading, setAuthorityLoading] = useState(false);
  const [authorityError, setAuthorityError] = useState<string | null>(null);

  const loadRegistry = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<PermissionRegistryResponse>(
        "/api/admin/permission-registry",
      );
      setRegistry(result);
    } catch {
      setError(t("admin.permissions.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  // The inspector's user picker: the staff user list (the same read surface
  // the Users page uses — no new search endpoint for this visibility page).
  useEffect(() => {
    let cancelled = false;
    api
      .get<UserListResponse>("/api/admin/users?pageSize=100")
      .then((result) => {
        if (!cancelled) setUsers(result.items);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAuthority = useCallback(
    async (userId: string) => {
      setAuthorityLoading(true);
      setAuthorityError(null);
      setAuthority(null);
      try {
        const result = await api.get<EffectiveAuthorityResponse>(
          `/api/admin/users/${userId}/effective-authority`,
        );
        setAuthority(result);
      } catch {
        setAuthorityError(t("admin.permissions.loadAuthorityFailed"));
      } finally {
        setAuthorityLoading(false);
      }
    },
    [t],
  );

  const handleUserSelect = useCallback(
    (userId: string) => {
      setSelectedUserId(userId);
      if (userId) loadAuthority(userId);
    },
    [loadAuthority],
  );

  const groupedPermissions = useMemo(() => {
    const byCategory = new Map<string, PermissionEntry[]>();
    for (const entry of registry?.permissions ?? []) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }
    return [...byCategory.entries()].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a[0] as never) -
        CATEGORY_ORDER.indexOf(b[0] as never),
    );
  }, [registry]);

  const assignableRoles = useMemo(
    () => (registry?.rolePresets ?? []).filter((r) => r.assignable),
    [registry],
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadRegistry} />;

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("admin.permissions.title")}
        description={t("admin.permissions.description")}
      />

      {/* 1. Permission catalog grouped by semantic category. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <AppIcon icon={KeyRound} size="inline" />
          <h2 className="type-section-title">
            {t("admin.permissions.catalog.title")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("admin.permissions.catalog.description")}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groupedPermissions.map(([category, entries]) => (
            <div key={category} className="rounded-md border p-4">
              <h3 className="mb-3 text-sm font-medium">
                {t(`admin.permissions.categories.${category}` as never, {
                  defaultValue: category,
                })}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {entries.length}
                </span>
              </h3>
              <ul className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <li
                    key={entry.key}
                    className="rounded bg-muted px-2 py-1 font-mono text-xs"
                    title={entry.key}
                  >
                    {entry.key}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Role × permission matrix over the assignable presets. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <AppIcon icon={ShieldCheck} size="inline" />
          <h2 className="type-section-title">
            {t("admin.permissions.roles.title")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("admin.permissions.roles.description")}
        </p>
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">
                  {t("admin.permissions.roles.columnPermission")}
                </TableHead>
                {assignableRoles.map((role) => (
                  <TableHead key={role.key} className="text-center">
                    {t(`admin.permissions.roles.role.${role.key}` as never, {
                      defaultValue: role.label,
                    })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedPermissions.map(([category, entries]) => (
                <Fragment key={category}>
                  <TableRow className="bg-muted/50">
                    <TableCell
                      colSpan={assignableRoles.length + 1}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t(`admin.permissions.categories.${category}` as never, {
                        defaultValue: category,
                      })}
                    </TableCell>
                  </TableRow>
                  {entries.map((entry) => (
                    <TableRow key={entry.key}>
                      <TableCell className="font-mono text-xs">
                        {entry.key}
                      </TableCell>
                      {assignableRoles.map((role) => (
                        <TableCell key={role.key} className="text-center">
                          {role.permissions.includes(entry.key) ? (
                            <AppIcon
                              icon={BadgeCheck}
                              size="inline"
                              className="text-primary"
                              aria-label={t("admin.permissions.roles.granted")}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 3. Capability grants of a staff user — role-preset union, NOT
          per-resource authority; resource reach is narrowed by scope
          assignments at the enforcement layer. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <AppIcon icon={UsersRound} size="inline" />
          <h2 className="type-section-title">
            {t("admin.permissions.effective.title")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("admin.permissions.effective.description")}
        </p>
        <div className="flex max-w-md flex-col gap-3">
          <Select value={selectedUserId} onValueChange={handleUserSelect}>
            <SelectTrigger
              aria-label={t("admin.permissions.effective.userSelect")}
            >
              <SelectValue
                placeholder={t("admin.permissions.effective.userSelect")}
              />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name || user.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {authorityLoading && <LoadingState />}
          {authorityError && (
            <ErrorState
              message={authorityError}
              onRetry={() => loadAuthority(selectedUserId)}
            />
          )}

          {authority && selectedUser && (
            <div className="flex flex-col gap-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {authority.user.name || authority.user.username}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {authority.user.username}
                  </p>
                </div>
                {authority.authority.ok ? (
                  <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground">
                    {authority.authority.authority.primaryRole}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {t("admin.permissions.effective.noActive")}
                  </span>
                )}
              </div>

              {authority.authority.ok ? (
                <>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("admin.permissions.effective.capabilities")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {authority.authority.authority.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-xs text-primary-soft-foreground"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("admin.permissions.effective.scopeNote")}
                    </p>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("admin.permissions.effective.assignments")}
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {authority.assignments.map((assignment) => (
                        <li
                          key={assignment.id}
                          className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs"
                        >
                          <span className="font-medium">{assignment.role}</span>
                          {assignment.isPrimary && (
                            <span className="rounded bg-primary-soft px-1.5 text-primary-soft-foreground">
                              {t("admin.permissions.effective.primary")}
                            </span>
                          )}
                          {!assignment.isActive && (
                            <span className="text-muted-foreground">
                              {t("admin.permissions.effective.inactive")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("admin.permissions.effective.reason", {
                    reason: authority.authority.reason,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
