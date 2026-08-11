import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2, LayoutTemplate } from "lucide-react";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import {
  summarizeProfile,
  type ProfileSummaryLabels,
} from "@/lib/examProfileSummary";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import type { ExamProfileDTO } from "@exam/contracts";

/** Format an ISO datetime as a short local date string. */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Resolve i18n labels for the profile summary formatter (single source). */
function useProfileSummaryLabels(): ProfileSummaryLabels {
  const { t } = useTranslation();
  return {
    durationMinutes: (m) =>
      t("admin.examProfilePages.summaryDuration", { count: m }),
    noLimit: t("admin.examProfilePages.fields.noLimitPlaceholder"),
    latestStart: (m) =>
      t("admin.examProfilePages.summaryLatestStart", { count: m }),
    minSubmit: (m) =>
      t("admin.examProfilePages.summaryMinSubmit", { count: m }),
    retake: {
      unlimited: t("admin.examProfilePages.enumLabels.retakePolicyUnlimited"),
      maxAttempts: (n) =>
        t("admin.examProfilePages.summaryMaxAttempts", { count: n }),
      passThenStop: t(
        "admin.examProfilePages.enumLabels.retakePolicyPassThenStop",
      ),
    },
    scoreStrategy: {
      highest: t("admin.examProfilePages.enumLabels.scoreStrategyHighest"),
      latest: t("admin.examProfilePages.enumLabels.scoreStrategyLatest"),
      first: t("admin.examProfilePages.enumLabels.scoreStrategyFirst"),
    },
    resultPublication: {
      immediate: t(
        "admin.examProfilePages.enumLabels.resultPublicationImmediate",
      ),
      afterGrading: t(
        "admin.examProfilePages.enumLabels.resultPublicationAfterGrading",
      ),
      manual: t("admin.examProfilePages.enumLabels.resultPublicationManual"),
    },
    interruption: {
      strict: t("admin.examProfilePages.enumLabels.interruptionStrict"),
      boundedGrace: t(
        "admin.examProfilePages.enumLabels.interruptionBoundedGrace",
      ),
      operatorIncident: t(
        "admin.examProfilePages.enumLabels.interruptionOperatorIncident",
      ),
    },
    separator: " · ",
  };
}

/**
 * Admin page listing organization-owned exam policy profiles. Profiles are
 * reusable authoring templates (P7-M2); applying one to an exam is
 * copy-on-apply, so editing/deleting a profile never affects existing exams.
 */
export function ExamProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const labels = useProfileSummaryLabels();
  const [profiles, setProfiles] = useState<ExamProfileDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<ExamProfileDTO[]>("/api/exam-profiles");
      setProfiles(data);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          t("admin.examProfilePages.feedback.loadFailed"),
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/exam-profiles/${id}`);
      toast.success(t("admin.examProfilePages.feedback.deleteSuccess"));
      await loadProfiles();
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          t("admin.examProfilePages.feedback.saveFailed"),
        ),
      );
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadProfiles} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.examProfilePages.listPageTitle")}
        description={t("admin.examProfilePages.listPageDescription")}
        actions={
          <Button onClick={() => navigate("/admin/exam-profiles/new")}>
            <AppIcon icon={Plus} size="inline" />
            {t("admin.examProfilePages.createBtn")}
          </Button>
        }
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={LayoutTemplate} size="state" />}
          title={t("admin.examProfilePages.emptyTitle")}
          description={t("admin.examProfilePages.emptyDescription")}
          action={
            <Button onClick={() => navigate("/admin/exam-profiles/new")}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.examProfilePages.createBtn")}
            </Button>
          }
        />
      ) : (
        <DataTableShell>
          <Table>
            <DataTableColumns
              columns={[
                { role: "primary-text" },
                { role: "long-text" },
                { role: "date" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="primary-text">
                  {t("admin.examProfilePages.columns.name")}
                </DataTableHead>
                <DataTableHead role="long-text">
                  {t("admin.examProfilePages.columns.summary")}
                </DataTableHead>
                <DataTableHead role="date">
                  {t("admin.examProfilePages.columns.updatedAt")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.examProfilePages.columns.actions")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <DataTableCell role="primary-text">{p.name}</DataTableCell>
                  <DataTableCell role="long-text">
                    {summarizeProfile(p, labels)}
                  </DataTableCell>
                  <DataTableCell role="date">
                    {formatUpdatedAt(p.updatedAt)}
                  </DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          navigate(`/admin/exam-profiles/${p.id}/edit`)
                        }
                        aria-label={t("admin.examProfilePages.actions.edit")}
                      >
                        <AppIcon icon={Pencil} size="inline" />
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t(
                              "admin.examProfilePages.actions.delete",
                            )}
                            data-row-action-tone="destructive"
                          >
                            <AppIcon icon={Trash2} size="inline" />
                          </Button>
                        }
                        title={t("admin.examProfilePages.deleteConfirmTitle")}
                        description={t(
                          "admin.examProfilePages.deleteConfirmDescription",
                        )}
                        confirmLabel={t(
                          "admin.examProfilePages.deleteConfirmAction",
                        )}
                        destructive
                        onConfirm={() => void handleDelete(p.id)}
                      />
                    </RowActions>
                  </DataTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      )}
    </div>
  );
}
