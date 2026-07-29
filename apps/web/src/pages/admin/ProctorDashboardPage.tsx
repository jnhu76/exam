import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/capabilities";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Users, MonitorPlay } from "lucide-react";
import type {
  CandidateStatusItem,
  CandidateStatusResponse,
  TimeGrantRequest,
  TimeGrantResponse,
} from "@exam/contracts";

/** Polling interval for the proctor dashboard (ms). */
const POLL_INTERVAL_MS = 5_000;

/** Groups candidates into status categories for the proctor dashboard. */
interface StatusGroups {
  active: CandidateStatusItem[];
  disrupted: CandidateStatusItem[];
  submitted: CandidateStatusItem[];
  graded: CandidateStatusItem[];
}

/**
 * Groups an array of candidate status items by their attempt status.
 */
function groupByStatus(candidates: CandidateStatusItem[]): StatusGroups {
  const groups: StatusGroups = {
    active: [],
    disrupted: [],
    submitted: [],
    graded: [],
  };
  for (const c of candidates) {
    if (c.status === "in_progress") {
      groups.active.push(c);
    } else if (c.status === "disrupted") {
      groups.disrupted.push(c);
    } else if (c.status === "submitted" || c.status === "grading") {
      groups.submitted.push(c);
    } else if (c.status === "graded") {
      groups.graded.push(c);
    }
    // not_started / queued / voided are not displayed in the status card groups
  }
  return groups;
}

/**
 * Proctor dashboard for monitoring live exam candidates via HTTP polling.
 * Displays status cards grouped by attempt state and exposes action buttons
 * for force-submit, time-grant, and misconduct flag.
 */
export function ProctorDashboardPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { user } = useAuthContext();
  const { id: examId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CandidateStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  // Action dialogs
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [grantReasonCode, setGrantReasonCode] = useState("technical_incident");
  const [grantReasonText, setGrantReasonText] = useState("");
  // Caller-supplied idempotency identity: minted when the dialog opens, reused
  // across retries, discarded only on success or when the dialog closes.
  const [grantOperationId, setGrantOperationId] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendTarget, setExtendTarget] = useState<CandidateStatusItem | null>(
    null,
  );

  const [misconductDialogOpen, setMisconductDialogOpen] = useState(false);
  const [misconductSeverity, setMisconductSeverity] = useState<
    "warning" | "serious"
  >("warning");
  const [misconductNotes, setMisconductNotes] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [misconductTarget, setMisconductTarget] =
    useState<CandidateStatusItem | null>(null);

  const [forceSubmitting, setForceSubmitting] = useState(false);

  /** Fetches candidate status from the API. */
  const loadStatus = useCallback(async () => {
    if (!examId) return;
    setError(null);
    try {
      const result = await api.get<CandidateStatusResponse>(
        `/api/admin/exams/${examId}/candidates/status`,
      );
      setData(result);
    } catch {
      setError(t("admin.proctorDashboard.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadStatus();
    intervalRef.current = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadStatus]);

  /** Handles force-submit for a candidate. */
  async function handleForceSubmit(attemptId: string) {
    setForceSubmitting(true);
    try {
      await api.post(`/api/admin/attempts/${attemptId}/force-submit`, {
        reason: t("admin.proctorDashboard.forceSubmit.reason"),
      });
      toast.success(t("admin.proctorDashboard.forceSubmit.done"));
      await loadStatus();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.proctorDashboard.errors.forceSubmitFailed"),
      );
    } finally {
      setForceSubmitting(false);
    }
  }

  /** Handles operator time grant for a candidate (REC-I4-I3B2). */
  async function handleGrantTime() {
    if (!extendTarget?.attemptId || extending || !grantOperationId) return;
    setExtending(true);
    try {
      const body: TimeGrantRequest = {
        operationId: grantOperationId,
        addedSeconds: extendMinutes * 60,
        reasonCode: grantReasonCode,
        reasonText: grantReasonText.trim() || grantReasonCode,
      };
      const res = await api.post<TimeGrantResponse, TimeGrantRequest>(
        `/api/admin/attempts/${extendTarget.attemptId}/time-grants`,
        body,
      );
      toast.success(
        t("admin.proctorDashboard.extendDialog.done", {
          minutes: extendMinutes,
        }),
      );
      // Success: discard the operationId so the next dialog open mints a fresh
      // one. A closed/discarded dialog never reuses a stale identity.
      setGrantOperationId(null);
      setExtendDialogOpen(false);
      await loadStatus();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.proctorDashboard.errors.extendFailed"),
      );
      // Retry reuses the same operationId (idempotency); do NOT regenerate.
    } finally {
      setExtending(false);
    }
  }

  /** Handles misconduct flag for a candidate. */
  async function handleFlagMisconduct() {
    if (!misconductTarget?.attemptId || flagging) return;
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${misconductTarget.attemptId}/misconduct`,
        {
          severity: misconductSeverity,
          notes:
            misconductNotes ||
            t("admin.proctorDashboard.misconductDialog.defaultNotes"),
        },
      );
      toast.success(t("admin.proctorDashboard.misconductDialog.done"));
      setMisconductDialogOpen(false);
      setMisconductNotes("");
      await loadStatus();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.proctorDashboard.errors.flagFailed"),
      );
    } finally {
      setFlagging(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadStatus} />;
  if (!data) return null;

  const groups = groupByStatus(data.candidates);
  const hasAnyCandidates = data.candidates.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.proctorDashboard.title")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                void loadStatus();
              }}
            >
              <AppIcon icon={RefreshCw} size="inline" />
              {t("admin.proctorDashboard.actions.refresh")}
            </Button>
            <Button
              data-testid="proctor-monitor-link"
              variant="outline"
              size="sm"
              onClick={() =>
                examId && void navigate(routes.admin.examProctorMonitor(examId))
              }
            >
              <AppIcon icon={MonitorPlay} size="inline" />
              {t("admin.proctorDashboard.actions.monitor")}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              {t("admin.proctorDashboard.actions.back")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            {t("admin.proctorDashboard.tabs.all", { count: data.total })}
          </TabsTrigger>
          <TabsTrigger value="active">
            {t("admin.proctorDashboard.tabs.active", {
              count: groups.active.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="disrupted">
            {t("admin.proctorDashboard.tabs.disrupted", {
              count: groups.disrupted.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="submitted">
            {t("admin.proctorDashboard.tabs.submitted", {
              count: groups.submitted.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="graded">
            {t("admin.proctorDashboard.tabs.graded", {
              count: groups.graded.length,
            })}
          </TabsTrigger>
        </TabsList>

        {!hasAnyCandidates && (
          <div className="mt-4">
            <EmptyState
              icon={<AppIcon icon={Users} size="state" />}
              title={t("admin.proctorDashboard.empty.title")}
              description={t("admin.proctorDashboard.empty.description")}
            />
          </div>
        )}

        <TabsContent value="all" className="mt-4">
          {renderCards(data.candidates)}
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          {renderCards(groups.active)}
        </TabsContent>
        <TabsContent value="disrupted" className="mt-4">
          {renderCards(groups.disrupted)}
        </TabsContent>
        <TabsContent value="submitted" className="mt-4">
          {renderCards(groups.submitted)}
        </TabsContent>
        <TabsContent value="graded" className="mt-4">
          {renderCards(groups.graded)}
        </TabsContent>
      </Tabs>

      {/* Operator time grant dialog */}
      <Dialog
        open={extendDialogOpen}
        onOpenChange={(open) => {
          // Closing (incl. dismiss) discards the operationId so the next open
          // mints a fresh identity — a stale identity is never reused.
          if (!open) setGrantOperationId(null);
          setExtendDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.proctorDashboard.extendDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.proctorDashboard.extendDialog.description", {
                name: extendTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">
              {t("admin.proctorDashboard.extendDialog.minutesLabel")}
            </Label>
            <Input
              id="extend-minutes"
              type="number"
              min={1}
              value={extendMinutes}
              onChange={(e) =>
                setExtendMinutes(Number.parseInt(e.target.value, 10) || 0)
              }
            />
            <Label htmlFor="grant-reason-code">
              {t("admin.proctorDashboard.extendDialog.reasonCodeLabel")}
            </Label>
            <Select
              value={grantReasonCode}
              onValueChange={(v) => setGrantReasonCode(v)}
            >
              <SelectTrigger id="grant-reason-code">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="technical_incident">
                  {t(
                    "admin.proctorDashboard.extendDialog.reasonCodeTechnicalIncident",
                  )}
                </SelectItem>
                <SelectItem value="candidate_request">
                  {t(
                    "admin.proctorDashboard.extendDialog.reasonCodeCandidateRequest",
                  )}
                </SelectItem>
                <SelectItem value="other">
                  {t("admin.proctorDashboard.extendDialog.reasonCodeOther")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="grant-reason-text">
              {t("admin.proctorDashboard.extendDialog.reasonTextLabel")}
            </Label>
            <Textarea
              id="grant-reason-text"
              value={grantReasonText}
              onChange={(e) => setGrantReasonText(e.target.value)}
              placeholder={t(
                "admin.proctorDashboard.extendDialog.reasonTextPlaceholder",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtendDialogOpen(false)}
            >
              {t("admin.proctorDashboard.extendDialog.cancel")}
            </Button>
            <Button
              disabled={
                extending ||
                extendMinutes <= 0 ||
                grantReasonText.trim().length === 0
              }
              onClick={() => void handleGrantTime()}
            >
              {extending
                ? t("admin.proctorDashboard.extendDialog.confirming")
                : t("admin.proctorDashboard.extendDialog.confirm", {
                    minutes: extendMinutes,
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Misconduct dialog */}
      <Dialog
        open={misconductDialogOpen}
        onOpenChange={setMisconductDialogOpen}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.proctorDashboard.misconductDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.proctorDashboard.misconductDialog.description", {
                name: misconductTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="misconduct-severity">
              {t("admin.proctorDashboard.misconductDialog.severityLabel")}
            </Label>
            <Select
              value={misconductSeverity}
              onValueChange={(v: "warning" | "serious") =>
                setMisconductSeverity(v)
              }
            >
              <SelectTrigger id="misconduct-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">
                  {t("admin.proctorDashboard.misconductDialog.severityWarning")}
                </SelectItem>
                <SelectItem value="serious">
                  {t("admin.proctorDashboard.misconductDialog.severitySerious")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="misconduct-notes">
              {t("admin.proctorDashboard.misconductDialog.notesLabel")}
            </Label>
            <Textarea
              id="misconduct-notes"
              value={misconductNotes}
              onChange={(e) => setMisconductNotes(e.target.value)}
              placeholder={t(
                "admin.proctorDashboard.misconductDialog.notesPlaceholder",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMisconductDialogOpen(false)}
            >
              {t("admin.proctorDashboard.misconductDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={flagging || !misconductNotes.trim()}
              onClick={() => void handleFlagMisconduct()}
            >
              {flagging
                ? t("admin.proctorDashboard.misconductDialog.flagging")
                : t("admin.proctorDashboard.misconductDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  /** Renders a grid of candidate status cards. */
  function renderCards(items: CandidateStatusItem[]) {
    if (items.length === 0) {
      return (
        <EmptyState
          icon={<AppIcon icon={Users} size="state" />}
          title={t("admin.proctorDashboard.empty.filteredTitle")}
          description={t("admin.proctorDashboard.empty.filteredDescription")}
        />
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((candidate) => {
          const isLive =
            candidate.status === "in_progress" ||
            candidate.status === "disrupted";
          return (
            <Card key={candidate.candidateId}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium truncate">
                    {candidate.name}
                  </CardTitle>
                  <StatusBadge status={candidate.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {candidate.deadlineAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("admin.proctorDashboard.card.deadline")}
                    </span>
                    <span>{formatTime(candidate.deadlineAt)}</span>
                  </div>
                )}
                {candidate.lastActivityAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("admin.proctorDashboard.card.lastActivity")}
                    </span>
                    <span>{formatTime(candidate.lastActivityAt)}</span>
                  </div>
                )}
                {candidate.misconduct && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={`misconduct_${candidate.misconduct.severity}`}
                      className="w-fit"
                    />
                    {candidate.misconduct.notes && (
                      <span className="text-muted-foreground">
                        {candidate.misconduct.notes}
                      </span>
                    )}
                  </div>
                )}
                {isLive && candidate.attemptId && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(candidate.status === "in_progress" ||
                      candidate.status === "disrupted") && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={forceSubmitting}
                          >
                            {t("admin.proctorDashboard.card.forceSubmit")}
                          </Button>
                        }
                        title={t("admin.proctorDashboard.forceSubmit.title")}
                        description={t(
                          "admin.proctorDashboard.forceSubmit.description",
                          { name: candidate.name },
                        )}
                        destructive
                        onConfirm={() =>
                          void handleForceSubmit(candidate.attemptId!)
                        }
                      />
                    )}
                    {candidate.attemptId && user && isAdmin(user) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setExtendTarget(candidate);
                          setExtendMinutes(10);
                          // Mint a fresh idempotency identity for this grant
                          // command; reused on retry, discarded on close/success.
                          setGrantOperationId(crypto.randomUUID());
                          setGrantReasonCode("technical_incident");
                          setGrantReasonText("");
                          setExtendDialogOpen(true);
                        }}
                      >
                        {t("admin.proctorDashboard.card.extend")}
                      </Button>
                    )}
                    {candidate.attemptId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMisconductTarget(candidate);
                          setMisconductSeverity("warning");
                          setMisconductNotes("");
                          setMisconductDialogOpen(true);
                        }}
                      >
                        {t("admin.proctorDashboard.card.flag")}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }
}
