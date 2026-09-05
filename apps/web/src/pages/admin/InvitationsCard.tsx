import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { AppIcon } from "@/components/shared/AppIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldError } from "@/components/shared/FieldError";
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
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { RowActions } from "@/components/shared/RowActions";
import { PageSection } from "@/components/shared/PageSection";
import { Mail, Plus, Trash2 } from "lucide-react";
import type { AssignableRole, StaffInvitationDTO } from "@exam/contracts";

/** Assignable-role catalog item as returned by GET /roles/assignable. */
interface AssignableRoleItem {
  key: AssignableRole;
  label: string;
  purpose: string;
}

/** Invitation lifecycle status badge variant (computed server-side). */
function statusBadgeVariant(status: StaffInvitationDTO["status"]) {
  switch (status) {
    case "accepted":
      return "default" as const;
    case "revoked":
      return "destructive" as const;
    case "expired":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

/**
 * Admin staff-invitation panel (issue 297): issue email invitations and manage
 * pending ones. Rendered inside the user-management page because an
 * invitation IS pending staff membership.
 *
 * The acceptance URL is returned by the invite response exactly once (the
 * server stores only its hash). The panel surfaces it with an explicit
 * "shown once" hint so email-disabled deployments remain usable (ADR-011
 * §12: an outbox row marked sent without a provider id is not proof of
 * delivery).
 */
export function InvitationsCard({ roles }: { roles: AssignableRoleItem[] }) {
  const { t } = useTranslation();
  const [invitations, setInvitations] = useState<StaffInvitationDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("Teacher");
  const [fieldError, setFieldError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null);

  /**
   * Same display contract as UsersPage: the local i18n `roleLabels` entry
   * wins; the backend assignable-roles catalog decides MEMBERSHIP only. Its
   * `label` is an English catalog string and must never leak into the UI
   * (P7 review #5), including in the invite-role dropdown options.
   */
  const roleLabel = useCallback(
    (key: string) =>
      t(`admin.users.roleLabels.${key}`, {
        defaultValue: t("admin.users.roleLabels.unknown"),
      }),
    [t],
  );

  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{
        items: StaffInvitationDTO[];
        total: number;
      }>("/api/invitations?page=1&pageSize=20");
      setInvitations(res.items);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.invitations.loadFailed")),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => void loadInvitations(), [loadInvitations]);

  function openInvite() {
    setEmail("");
    setRole("Teacher");
    setFieldError("");
    setOneTimeUrl(null);
    setDialogOpen(true);
  }

  async function submitInvite() {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setFieldError(t("admin.users.invitations.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setFieldError(t("admin.users.invitations.emailInvalid"));
      return;
    }
    setFieldError("");
    setSubmitting(true);
    try {
      const res = await api.post<{
        invitation: StaffInvitationDTO;
        acceptUrl: string;
      }>("/api/invitations", { email: normalized, role });
      setOneTimeUrl(res.acceptUrl);
      await loadInvitations();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.invitations.inviteFailed")),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(invitation: StaffInvitationDTO) {
    try {
      await api.delete(`/api/invitations/${invitation.id}`);
      await loadInvitations();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.users.invitations.revokeFailed")),
      );
    }
  }

  async function copyUrl() {
    if (!oneTimeUrl) return;
    try {
      await navigator.clipboard.writeText(oneTimeUrl);
      toast.success(t("admin.users.invitations.copied"));
    } catch {
      // Clipboard may be unavailable (insecure context) — the field stays
      // selectable so the Admin can copy manually.
    }
  }

  return (
    <PageSection
      title={t("admin.users.invitations.title")}
      description={t("admin.users.invitations.description")}
      actions={
        <Button onClick={openInvite}>
          <AppIcon icon={Plus} size="inline" />
          {t("admin.users.invitations.inviteBtn")}
        </Button>
      }
    >
      {invitations.length === 0 && !isLoading ? (
        <EmptyState
          icon={<AppIcon icon={Mail} size="state" />}
          title={t("admin.users.invitations.empty")}
          description={t("admin.users.invitations.description")}
        />
      ) : (
        <DataTableShell minTableWidth="compact">
          <Table>
            <DataTableColumns
              columns={[
                { role: "primary-text" },
                { role: "type" },
                { role: "status" },
                { role: "type" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="primary-text">
                  {t("admin.users.invitations.columns.email")}
                </DataTableHead>
                <DataTableHead role="type">
                  {t("admin.users.invitations.columns.role")}
                </DataTableHead>
                <DataTableHead role="status">
                  {t("admin.users.invitations.columns.status")}
                </DataTableHead>
                <DataTableHead role="type">
                  {t("admin.users.invitations.columns.expiresAt")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.users.invitations.columns.actions")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <DataTableCell role="primary-text">
                    {invitation.email}
                  </DataTableCell>
                  <DataTableCell role="type">
                    <Badge variant="outline">
                      {roleLabel(invitation.role)}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell role="status">
                    <Badge variant={statusBadgeVariant(invitation.status)}>
                      {t(`admin.users.invitations.status.${invitation.status}`)}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell role="type">
                    {new Date(invitation.expiresAt).toLocaleString()}
                  </DataTableCell>
                  <DataTableCell role="actions">
                    {invitation.status === "pending" && (
                      <RowActions
                        row={invitation}
                        actions={[
                          {
                            id: "revoke",
                            label: t("admin.users.invitations.revoke"),
                            icon: Trash2,
                            tone: "destructive",
                            confirm: {
                              title: t("admin.users.invitations.revokeTitle"),
                              description: t(
                                "admin.users.invitations.revokeDescription",
                              ),
                              destructive: true,
                            },
                            onSelect: () => void revoke(invitation),
                          },
                        ]}
                      />
                    )}
                  </DataTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.users.invitations.dialogTitle")}
            </DialogTitle>
          </DialogHeader>
          {oneTimeUrl ? (
            <div className="space-y-3" data-testid="invite-one-time-url">
              <p className="font-medium">
                {t("admin.users.invitations.acceptUrlTitle")}
              </p>
              <p className="type-secondary">
                {t("admin.users.invitations.acceptUrlHint")}
              </p>
              <div className="flex gap-2">
                <Input readOnly value={oneTimeUrl} className="flex-1" />
                <Button variant="outline" onClick={() => void copyUrl()}>
                  {t("admin.users.invitations.copy")}
                </Button>
              </div>
              <DialogFooter>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDialogOpen(false);
                    setOneTimeUrl(null);
                  }}
                >
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitInvite();
              }}
            >
              <FieldGroup className="gap-4">
                <Field>
                  <Label htmlFor="invite-email">
                    {t("admin.users.invitations.emailLabel")}
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder={t("admin.users.invitations.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                  />
                  <FieldError>{fieldError}</FieldError>
                </Field>
                <Field>
                  <Label>{t("admin.users.invitations.roleLabel")}</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => setRole(v as AssignableRole)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {roleLabel(r.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting
                    ? t("admin.users.invitations.submitting")
                    : t("admin.users.invitations.submit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
