import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  SystemHealthResponse,
  DiagnosticsResponse,
  BackupEvidenceResponse,
  RestoreReadinessResponse,
  OpsPolicyResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { StatsCard } from "@/components/shared/StatsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, HeartPulse, MemoryStick, ShieldCheck } from "lucide-react";

const HEALTH_REFRESH_MS = 15_000;
const BACKUP_REFRESH_MS = 60_000;
const POLICY_REFRESH_MS = 60_000;

function getStatusLevel(value: number): SystemHealthResponse["status"] {
  if (value > 95) return "critical";
  if (value > 80) return "degraded";
  return "ok";
}

function getDbStatusLevel(ms: number): SystemHealthResponse["status"] {
  if (ms > 1000) return "critical";
  if (ms > 500) return "degraded";
  return "ok";
}

/**
 * P7-E2C — Operations surface (Admin business-owner summary + Application
 * Maintainer detail).
 *
 * Renders the operational control-plane truth: overall health, backup
 * posture (latest / latest VERIFIED / last failure / status counts), restore
 * readiness (drill evidence, automated vs operator-declared), and the
 * operational diagnostics projection (DB latency, Redis, scanners, email
 * worker). The business-integrity diagnostics block is rendered ONLY when
 * the backend includes it (Admin holds system.business_integrity.view;
 * Maintainer never receives it — the field is absent, not zeroed).
 *
 * Truthfulness rules:
 *   - no verified backup → "NO EVIDENCE / NOT VERIFIED", never a green state;
 *   - last backup failed → warning banner;
 *   - no secrets, no host paths — artifact labels only.
 */
export function OperationsPage() {
  const { t } = useTranslation();
  const { formatDateTime, formatDuration } = useProductDateTime();
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [backup, setBackup] = useState<BackupEvidenceResponse | null>(null);
  const [restore, setRestore] = useState<RestoreReadinessResponse | null>(null);
  const [policy, setPolicy] = useState<OpsPolicyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<{
    desiredRpoSeconds: string;
    desiredRetentionDays: string;
    desiredDrillCadenceDays: string;
    reason: string;
  } | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySaved, setPolicySaved] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [h, d, b, r, p] = await Promise.all([
        api.get<SystemHealthResponse>("/api/system/health"),
        api.get<DiagnosticsResponse>("/api/system/diagnostics"),
        api.get<BackupEvidenceResponse>("/api/system/backups"),
        api.get<RestoreReadinessResponse>("/api/system/restore-readiness"),
        api.get<OpsPolicyResponse>("/api/system/ops-policy"),
      ]);
      setHealth(h);
      setDiag(d);
      setBackup(b);
      setRestore(r);
      setPolicy(p);
      setError(null);
      setStale(false);
    } catch (err) {
      setStale(true);
      if (error === null) {
        setError(t("ops.errors.loadFailed"));
      }
      logger.warn("operations.poll_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => void loadAll(), HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadAll]);

  /** P7-E3: Admin saves the operational policy INTENT (CAS versioned). */
  async function savePolicy() {
    const current = policy?.policy;
    if (!policyDraft) return;
    setPolicySaving(true);
    setPolicyError(null);
    setPolicySaved(false);
    try {
      const updated = await api.put<OpsPolicyResponse>(
        "/api/system/ops-policy",
        {
          desiredRpoSeconds: Number(policyDraft.desiredRpoSeconds),
          desiredRetentionDays: Number(policyDraft.desiredRetentionDays),
          desiredDrillCadenceDays: Number(policyDraft.desiredDrillCadenceDays),
          version: current?.version ?? 0,
          reason: policyDraft.reason,
        },
      );
      setPolicy(updated);
      setPolicyDraft(null);
      setPolicySaved(true);
    } catch (err) {
      setPolicyError(t("ops.policy.saveFailed"));
      logger.warn("ops_policy.save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPolicySaving(false);
    }
  }

  if (isLoading && !health) {
    return (
      <div data-testid="operations-page" className="space-y-4">
        <PageHeader title={t("ops.title")} />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !health && !backup) {
    return (
      <div data-testid="operations-page">
        <PageHeader title={t("ops.title")} />
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            void loadAll();
          }}
        />
      </div>
    );
  }

  // ── Backup posture computation (truthful states) ──
  const latestVerified = backup?.latestVerified ?? null;
  const lastFailure = backup?.lastFailure ?? null;
  const hasAnyRun =
    (backup?.counts.succeeded ?? 0) +
      (backup?.counts.failed ?? 0) +
      (backup?.counts.abandoned ?? 0) >
    0;
  const failureAfterVerified =
    lastFailure !== null &&
    latestVerified !== null &&
    new Date(lastFailure.completedAt ?? lastFailure.startedAt) >
      new Date(latestVerified.verifiedAt ?? latestVerified.startedAt);
  // Warning when the last attempt failed AND there is no verified backup
  // after it (no verified backup at all, or a failure newer than the last
  // verified one) — a lone failure must never look healthy.
  const showFailureWarning =
    lastFailure !== null && (latestVerified === null || failureAfterVerified);
  let backupTone: "healthy" | "warning" | "critical" | "neutral" = "neutral";
  if (!hasAnyRun)
    backupTone = "neutral"; // NO EVIDENCE
  else if (latestVerified === null)
    backupTone = "warning"; // NOT VERIFIED
  else if (failureAfterVerified) backupTone = "warning";
  else backupTone = "healthy";

  const backupAgeMs =
    latestVerified?.verifiedAt != null
      ? Math.max(0, Date.now() - new Date(latestVerified.verifiedAt).getTime())
      : null;

  const drill = restore?.latestDrill ?? null;
  let drillTone: "healthy" | "warning" | "neutral" = "neutral";
  if (drill === null)
    drillTone = "neutral"; // NO EVIDENCE
  else if (drill.result === "succeeded") drillTone = "healthy";
  else drillTone = "warning";

  return (
    <div data-testid="operations-page" className="space-y-6">
      <PageHeader title={t("ops.title")} description={t("ops.subtitle")} />

      {stale && <InlineErrorBanner>{t("ops.staleWarning")}</InlineErrorBanner>}
      {showFailureWarning && (
        <InlineErrorBanner>{t("ops.backup.failureWarning")}</InlineErrorBanner>
      )}

      {/* ── Overall health ── */}
      <section aria-label={t("ops.health.section")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label={t("ops.health.status")}
            value={health ? t(`ops.health.statusValue.${health.status}`) : "—"}
            icon={<AppIcon icon={HeartPulse} size="metric" />}
            supporting={
              health ? <StatusBadge status={health.status} /> : undefined
            }
          />
          <StatsCard
            label={t("ops.health.cpu")}
            value={health ? String(health.cpu) : "—"}
            suffix="%"
            icon={<AppIcon icon={MemoryStick} size="metric" />}
          />
          <StatsCard
            label={t("ops.health.memory")}
            value={health ? String(health.memory) : "—"}
            suffix="%"
            icon={<AppIcon icon={MemoryStick} size="metric" />}
          />
          <StatsCard
            label={t("ops.health.dbLatency")}
            value={health ? String(health.dbResponseMs) : "—"}
            suffix="ms"
            icon={<AppIcon icon={Database} size="metric" />}
          />
        </div>
      </section>

      {/* ── Backup posture ── */}
      <section aria-label={t("ops.backup.section")}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("ops.backup.title")}</CardTitle>
            {backup ? (
              <Badge
                variant={
                  backupTone === "healthy"
                    ? "default"
                    : backupTone === "warning"
                      ? "secondary"
                      : "outline"
                }
                data-testid="backup-status-badge"
              >
                {latestVerified === null && hasAnyRun
                  ? t("ops.backup.notVerified")
                  : !hasAnyRun
                    ? t("ops.backup.noEvidence")
                    : failureAfterVerified
                      ? t("ops.backup.warning")
                      : t("ops.backup.healthy")}
              </Badge>
            ) : (
              <Skeleton className="h-6 w-24" />
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {backup === null ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.backup.lastVerified")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {latestVerified
                      ? `${latestVerified.artifactLabel} · ${formatDateTime(
                          new Date(latestVerified.verifiedAt!),
                        )}`
                      : t("ops.backup.noVerifiedArtifact")}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.backup.age")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {backupAgeMs !== null ? formatDuration(backupAgeMs) : "—"}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.backup.lastFailure")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {lastFailure
                      ? `${lastFailure.failureReason ?? lastFailure.status} · ${formatDateTime(
                          new Date(
                            lastFailure.completedAt ?? lastFailure.startedAt,
                          ),
                        )}`
                      : t("ops.backup.noFailure")}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.backup.counts")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {t("ops.backup.succeeded")}: {backup.counts.succeeded} ·{" "}
                    {t("ops.backup.failed")}: {backup.counts.failed} ·{" "}
                    {t("ops.backup.abandoned")}: {backup.counts.abandoned} ·{" "}
                    {t("ops.backup.running")}: {backup.counts.running}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Operational policy intent (P7-E3, ADR-017 D9) ── */}
      <section aria-label={t("ops.policy.section")}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AppIcon icon={ShieldCheck} size="nav" />
              {t("ops.policy.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("ops.policy.intentNote")}
            </p>
            {policy === null ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="space-y-1">
                  {(
                    [
                      ["rpo", policy.compliance.rpo],
                      ["retention", policy.compliance.retention],
                      ["drill", policy.compliance.drill],
                    ] as const
                  ).map(([key, item]) => (
                    <div
                      key={key}
                      data-slot="diagnostic-data-row"
                      className="flex flex-wrap items-baseline justify-between gap-2 py-1"
                    >
                      <span className="text-sm text-muted-foreground">
                        {t(`ops.policy.fields.${key}`)}
                      </span>
                      <span className="text-sm tabular-nums">
                        {t("ops.policy.desired")}: {item.desired ?? "—"} ·{" "}
                        {t("ops.policy.observed")}: {item.observed ?? "—"}
                        <StatusBadge
                          status={complianceBadgeKey(item.status)}
                          className="ml-2"
                        />
                      </span>
                    </div>
                  ))}
                  {policy.policy && (
                    <div
                      data-slot="diagnostic-data-row"
                      className="flex flex-wrap items-baseline justify-between gap-2 py-1"
                    >
                      <span className="text-sm text-muted-foreground">
                        {t("ops.policy.lastChange")}
                      </span>
                      <span className="text-sm tabular-nums">
                        {policy.policy.reason} · {policy.policy.updatedBy} ·{" "}
                        {formatDateTime(new Date(policy.policy.updatedAt))}
                      </span>
                    </div>
                  )}
                </div>

                {policyDraft !== null ? (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="policy-rpo">
                          {t("ops.policy.fields.rpo")} (s)
                        </Label>
                        <Input
                          id="policy-rpo"
                          type="number"
                          min={300}
                          max={604800}
                          value={policyDraft.desiredRpoSeconds}
                          onChange={(e) =>
                            setPolicyDraft({
                              ...policyDraft,
                              desiredRpoSeconds: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="policy-retention">
                          {t("ops.policy.fields.retention")} (d)
                        </Label>
                        <Input
                          id="policy-retention"
                          type="number"
                          min={1}
                          max={3650}
                          value={policyDraft.desiredRetentionDays}
                          onChange={(e) =>
                            setPolicyDraft({
                              ...policyDraft,
                              desiredRetentionDays: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="policy-drill">
                          {t("ops.policy.fields.drill")} (d)
                        </Label>
                        <Input
                          id="policy-drill"
                          type="number"
                          min={1}
                          max={365}
                          value={policyDraft.desiredDrillCadenceDays}
                          onChange={(e) =>
                            setPolicyDraft({
                              ...policyDraft,
                              desiredDrillCadenceDays: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="policy-reason">
                        {t("ops.policy.reason")}
                      </Label>
                      <Input
                        id="policy-reason"
                        value={policyDraft.reason}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...policyDraft,
                            reason: e.target.value,
                          })
                        }
                      />
                    </div>
                    {policyError && (
                      <p role="alert" className="text-sm text-destructive">
                        {policyError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => void savePolicy()}
                        disabled={policySaving}
                      >
                        {policySaving
                          ? t("ops.policy.saving")
                          : t("ops.policy.save")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setPolicyDraft(null)}
                      >
                        {t("ops.policy.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="policy-edit-button"
                    onClick={() =>
                      setPolicyDraft({
                        desiredRpoSeconds: String(
                          policy.policy?.desiredRpoSeconds ?? 3600,
                        ),
                        desiredRetentionDays: String(
                          policy.policy?.desiredRetentionDays ?? 30,
                        ),
                        desiredDrillCadenceDays: String(
                          policy.policy?.desiredDrillCadenceDays ?? 7,
                        ),
                        reason: "",
                      })
                    }
                  >
                    {t("ops.policy.edit")}
                  </Button>
                )}
                {policySaved && (
                  <p className="text-sm text-foreground">
                    {t("ops.policy.saved")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Restore readiness ── */}
      <section aria-label={t("ops.restore.section")}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {t("ops.restore.title")}
            </CardTitle>
            {restore ? (
              <Badge
                variant={
                  drillTone === "healthy"
                    ? "default"
                    : drillTone === "warning"
                      ? "secondary"
                      : "outline"
                }
                data-testid="restore-status-badge"
              >
                {drill === null
                  ? t("ops.restore.noEvidence")
                  : drill.result === "succeeded"
                    ? t("ops.restore.proven")
                    : t("ops.restore.declared")}
              </Badge>
            ) : (
              <Skeleton className="h-6 w-24" />
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {restore === null ? (
              <Skeleton className="h-16 w-full" />
            ) : drill === null ? (
              <p className="text-sm text-muted-foreground">
                {t("ops.restore.noDrill")}
              </p>
            ) : (
              <>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.restore.lastDrill")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {drill.operationId} ·{" "}
                    {formatDateTime(
                      new Date(drill.completedAt ?? drill.startedAt),
                    )}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.restore.result")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {drill.result === "succeeded"
                      ? t("ops.restore.resultSucceeded")
                      : drill.result === "failed"
                        ? t("ops.restore.resultFailed")
                        : t("ops.restore.resultDeclared")}
                    {drill.source === "automated"
                      ? ` · ${t("ops.restore.sourceAutomated")}`
                      : ` · ${t("ops.restore.sourceDeclared")}`}
                    {drill.durationMs !== null &&
                      ` · ${formatDuration(drill.durationMs)}`}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Runtime diagnostics (operational projection) ── */}
      <section aria-label={t("ops.diagnostics.section")}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("ops.diagnostics.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {diag === null ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.diagnostics.dbLatency")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {diag.dbLatency} ms
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.diagnostics.redis")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {diag.redisStatus.state}
                    {diag.redisStatus.latencyMs !== null &&
                      ` · ${diag.redisStatus.latencyMs} ms`}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.diagnostics.heartbeatScanner")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {diag.heartbeatStatus.lastScanAt
                      ? formatDateTime(
                          new Date(diag.heartbeatStatus.lastScanAt),
                        )
                      : "—"}
                    {" · "}
                    {diag.heartbeatStatus.disruptedCount}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.diagnostics.deadlineScanner")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {diag.deadlineScannerStatus.lastScanAt
                      ? formatDateTime(
                          new Date(diag.deadlineScannerStatus.lastScanAt),
                        )
                      : "—"}
                    {" · "}
                    {diag.deadlineScannerStatus.autoSubmitCount}
                  </span>
                </div>
                <div
                  data-slot="diagnostic-data-row"
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("ops.diagnostics.emailWorker")}
                  </span>
                  <span className="text-sm tabular-nums">
                    {diag.emailStatus.status}
                    {diag.emailStatus.worker.lastPollAt &&
                      ` · ${formatDateTime(
                        new Date(diag.emailStatus.worker.lastPollAt),
                      )}`}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/**
 * Maps a compliance status to the statusMeta key (P7-E3). The compliance
 * vocabulary is presented through the StatusBadge authority.
 */
function complianceBadgeKey(status: string): string {
  switch (status) {
    case "SATISFIED":
      return "compliance_satisfied";
    case "NOT_SATISFIED":
      return "compliance_not_satisfied";
    case "UNKNOWN":
      return "compliance_unknown";
    case "NOT_CONFIGURED":
      return "compliance_not_configured";
    case "NOT_ENFORCED":
      return "compliance_not_enforced";
    default:
      return "unknown";
  }
}
