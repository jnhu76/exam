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

/**
 * sessionStorage key for an unresolved (indeterminate) operator time grant.
 * The grant's `operationId` is command identity: losing it across a refresh
 * would silently mint a new identity and could legitimately double-grant. The
 * pending command is therefore persisted keyed by `organizationId + attemptId`
 * so a refresh / accidental navigation cannot discard it. Cleared on a
 * confirmed outcome (granted / idempotent_replay / terminal) or explicit
 * discard.
 */
const PENDING_GRANT_STORAGE_KEY = "exam.pendingTimeGrant";

/** A frozen operator time-grant command — the exact bytes to (re)send. */
interface PendingTimeGrant {
  organizationId: string;
  attemptId: string;
  operationId: string;
  addedSeconds: number;
  reasonCode: string;
  reasonText: string;
}

/**
 * State machine for the time-grant dialog. `draft` holds a live operationId +
 * editable fields; the moment the user submits, a `PendingTimeGrant` is frozen
 * and the dialog moves to `submitting` (or `indeterminate` on an unconfirmed
 * failure). Retry always replays the frozen command verbatim.
 */
type GrantDialogState =
  | {
      phase: "draft";
      operationId: string;
      minutes: number;
      reasonCode: string;
      reasonText: string;
    }
  | { phase: "submitting"; command: PendingTimeGrant }
  | { phase: "indeterminate"; command: PendingTimeGrant };

/** Failure classification for a grant request outcome. */
type GrantFailureKind =
  | "indeterminate"
  | "confirmed_rejection"
  | "idempotency_conflict";

/**
 * Classifies a thrown grant error into the recovery action the UI must take.
 *
 *   indeterminate       — network drop / 5xx where the server's commit status
 *                         is unknown. KEEP the frozen command and reuse the
 *                         same operationId on retry (never mint a new one).
 *   confirmed_rejection — 4xx with a known code (validation / state / not
 *                         found). The command will never succeed as-sent; clear
 *                         it and let the admin re-edit.
 *   idempotency_conflict — the operationId was already committed for a
 *                         different payload. That identity is now unusable;
 *                         clear it and tell the admin a new command is needed.
 */
function classifyGrantFailure(error: unknown): GrantFailureKind {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    const code = (error as { code?: string }).code;
    if (code === "IDEMPOTENCY_CONFLICT") return "idempotency_conflict";
    // status 0 = network failure (fetch threw); 5xx = server may or may not
    // have committed → treat as unconfirmed.
    if (status === 0 || status >= 500) return "indeterminate";
    // 4xx with a definitive code is a confirmed rejection.
    return "confirmed_rejection";
  }
  // Non-ApiError throw (defensive): treat as unconfirmed.
  return "indeterminate";
}

/** Builds the sessionStorage sub-key for one attempt's pending grant. */
function pendingGrantStorageKey(organizationId: string, attemptId: string) {
  return `${PENDING_GRANT_STORAGE_KEY}:${organizationId}:${attemptId}`;
}

/** Loads a persisted pending grant for an attempt, if any. */
function loadPendingGrant(
  organizationId: string,
  attemptId: string,
): PendingTimeGrant | null {
  try {
    const raw = sessionStorage.getItem(
      pendingGrantStorageKey(organizationId, attemptId),
    );
    return raw ? (JSON.parse(raw) as PendingTimeGrant) : null;
  } catch {
    return null;
  }
}

/** Persists a pending grant so a refresh cannot lose the operationId. */
function savePendingGrant(command: PendingTimeGrant): void {
  try {
    sessionStorage.setItem(
      pendingGrantStorageKey(command.organizationId, command.attemptId),
      JSON.stringify(command),
    );
  } catch {
    // sessionStorage may be unavailable (private mode / quota); the in-memory
    // state machine still guards the within-session retry path.
  }
}

/** Clears a persisted pending grant for an attempt. */
function clearPendingGrant(organizationId: string, attemptId: string): void {
  try {
    sessionStorage.removeItem(
      pendingGrantStorageKey(organizationId, attemptId),
    );
  } catch {
    // ignore
  }
}

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
  const [extending, setExtending] = useState(false);
  const [extendTarget, setExtendTarget] = useState<CandidateStatusItem | null>(
    null,
  );
  // Operator time-grant dialog state machine (REC-I4-I3B2 + review P1-3/P1-4).
  //
  //   draft        — dialog open, operationId minted, fields still editable.
  //                  Submitting freezes a PendingTimeGrant and moves to
  //                  `submitting`.
  //   submitting   — a frozen command is in flight; fields are read-only.
  //   indeterminate— the request failed without a confirmed outcome (network
  //                  drop / 5xx where commit status is unknown). The frozen
  //                  command is RETAINED and reused verbatim on retry so the
  //                  same operationId cannot silently mint a duplicate grant.
  //                  It is also persisted to sessionStorage so a refresh /
  //                  navigation cannot lose the pending identity.
  //
  // A confirmed outcome (granted / idempotent_replay / terminal), a confirmed
  // rejection (4xx with a known code), or an idempotency conflict clears the
  // frozen command. An indeterminate command for one attempt blocks opening a
  // grant dialog for a different attempt until it is resolved or discarded.
  const [grantState, setGrantState] = useState<GrantDialogState>({
    phase: "draft",
    operationId: crypto.randomUUID(),
    minutes: 10,
    reasonCode: "technical_incident",
    reasonText: "",
  });

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

  /** Handles operator time grant for a candidate (REC-I4-I3B2 + review P1-3/4). */
  async function handleGrantTime() {
    if (!extendTarget?.attemptId || !user) return;
    const orgId = user.organizationId;
    const attemptId = extendTarget.attemptId;

    // Resolve the command to send. From `draft` we freeze a fresh command
    // (first send); from `submitting`/`indeterminate` we replay the already
    // frozen command VERBATIM — same operationId, same payload — so a retry
    // can never drift into an idempotency conflict or a duplicate grant.
    let command: PendingTimeGrant;
    if (grantState.phase === "draft") {
      command = {
        organizationId: orgId,
        attemptId,
        operationId: grantState.operationId,
        addedSeconds: grantState.minutes * 60,
        reasonCode: grantState.reasonCode,
        reasonText: grantState.reasonText.trim() || grantState.reasonCode,
      };
    } else {
      command = grantState.command;
      // Defensive: the frozen command must target the open dialog's attempt.
      if (command.attemptId !== attemptId) return;
    }

    setExtending(true);
    setGrantState({ phase: "submitting", command });
    const body: TimeGrantRequest = {
      operationId: command.operationId,
      addedSeconds: command.addedSeconds,
      reasonCode: command.reasonCode,
      reasonText: command.reasonText,
    };

    try {
      const res = await api.post<TimeGrantResponse, TimeGrantRequest>(
        `/api/admin/attempts/${attemptId}/time-grants`,
        body,
      );
      // All three outcomes are CONFIRMED results → clear the pending command.
      clearPendingGrant(orgId, attemptId);
      switch (res.outcome) {
        case "granted":
          toast.success(
            t("admin.proctorDashboard.extendDialog.done", {
              minutes: command.addedSeconds / 60,
            }),
          );
          break;
        case "idempotent_replay":
          // Same command was already committed; do not report a new grant.
          toast.success(t("admin.proctorDashboard.extendDialog.doneReplay"));
          break;
        case "terminal":
          // The attempt had already ended; NO time was added. Surface as a
          // warning, not a success, so the proctor does not misread it.
          toast.warning(t("admin.proctorDashboard.extendDialog.doneTerminal"));
          break;
      }
      // Confirmed result: close the dialog and reset to a fresh draft.
      resetGrantDialog();
      await loadStatus();
    } catch (err) {
      switch (classifyGrantFailure(err)) {
        case "indeterminate": {
          // Commit status unknown: KEEP the frozen command, persist it so a
          // refresh cannot lose it, and surface a retry affordance.
          savePendingGrant(command);
          setGrantState({ phase: "indeterminate", command });
          toast.warning(t("admin.proctorDashboard.extendDialog.indeterminate"));
          break;
        }
        case "idempotency_conflict": {
          // The operationId is now unusable for this payload; clear it and
          // tell the admin a new command is required to retry.
          clearPendingGrant(orgId, attemptId);
          resetGrantDialog();
          toast.error(
            t("admin.proctorDashboard.extendDialog.idempotencyConflict"),
          );
          break;
        }
        case "confirmed_rejection":
        default: {
          // Definitive failure (validation / state / not-found): clear the
          // command and let the admin re-edit.
          clearPendingGrant(orgId, attemptId);
          resetGrantDialog();
          toast.error(
            err instanceof Error
              ? err.message
              : t("admin.proctorDashboard.errors.extendFailed"),
          );
          break;
        }
      }
    } finally {
      setExtending(false);
    }
  }

  /**
   * Resets the grant dialog to a fresh editable draft (new operationId, default
   * fields) and clears the dialog target. Used on confirmed outcomes and
   * discardable failures. Does NOT touch an indeterminate command's persisted
   * copy — that is cleared separately via clearPendingGrant.
   */
  function resetGrantDialog() {
    setGrantState({
      phase: "draft",
      operationId: crypto.randomUUID(),
      minutes: 10,
      reasonCode: "technical_incident",
      reasonText: "",
    });
    setExtendDialogOpen(false);
    setExtendTarget(null);
  }

  /**
   * Opens the grant dialog for a candidate. Honors the indeterminate-command
   * invariant: if an unresolved command exists for THIS attempt, restore it
   * (so the proctor retries the same operationId); if one exists for a
   * DIFFERENT attempt, block opening and direct the proctor to resolve it
   * first (prevents a second in-flight grant that would mint a new identity).
   */
  function openGrantDialog(candidate: CandidateStatusItem) {
    if (!user || !candidate.attemptId) return;
    const orgId = user.organizationId;
    const attemptId = candidate.attemptId;

    // If the in-memory state is an unresolved command for a different attempt,
    // block: that command's operationId is still live.
    if (
      (grantState.phase === "submitting" ||
        grantState.phase === "indeterminate") &&
      grantState.command.attemptId !== attemptId
    ) {
      toast.warning(
        t("admin.proctorDashboard.extendDialog.blockedByPending", {
          minutes: grantState.command.addedSeconds / 60,
        }),
      );
      return;
    }

    setExtendTarget(candidate);

    // Hydrate from sessionStorage: a prior indeterminate command for this
    // attempt (e.g. after a refresh) must be retried with the same identity.
    const pending = loadPendingGrant(orgId, attemptId);
    if (pending) {
      setGrantState({ phase: "indeterminate", command: pending });
    } else {
      setGrantState({
        phase: "draft",
        operationId: crypto.randomUUID(),
        minutes: 10,
        reasonCode: "technical_incident",
        reasonText: "",
      });
    }
    setExtendDialogOpen(true);
  }

  /**
   * Patches a subset of the editable draft fields. No-op when the dialog is not
   * in the `draft` phase (frozen commands are read-only). Centralizing the
   * `phase === "draft"` guard keeps the discriminated-union narrowing in one
   * place instead of each input's onChange.
   */
  function updateDraft(
    patch: Partial<
      Pick<
        Extract<GrantDialogState, { phase: "draft" }>,
        "minutes" | "reasonCode" | "reasonText"
      >
    >,
  ) {
    setGrantState((prev) =>
      prev.phase === "draft" ? { ...prev, ...patch } : prev,
    );
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

  // Project the grant dialog fields from the state machine. In `draft` the
  // fields are live-editable; once a command is frozen (submitting /
  // indeterminate) the inputs render the frozen command read-only so a retry
  // cannot drift the payload.
  const grantFieldsEditable = grantState.phase === "draft";
  const grantMinutes =
    grantState.phase === "draft"
      ? grantState.minutes
      : Math.round(grantState.command.addedSeconds / 60);
  const grantReasonCode =
    grantState.phase === "draft"
      ? grantState.reasonCode
      : grantState.command.reasonCode;
  const grantReasonText =
    grantState.phase === "draft"
      ? grantState.reasonText
      : grantState.command.reasonText;
  // A frozen command (retry) is always submittable; a draft needs a positive
  // minute count and a non-empty reason.
  const canSubmitGrant =
    grantState.phase !== "draft" ||
    (grantState.minutes > 0 && grantState.reasonText.trim().length > 0);

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
          if (!open) {
            // Closing in `draft` (nothing sent yet) is a free cancel — clear
            // the identity. Closing while a command is `submitting` or
            // `indeterminate` KEEPS the frozen command alive: its operationId
            // may already be committed server-side, so discarding it would
            // risk minting a duplicate on the next open.
            if (grantState.phase === "draft") {
              resetGrantDialog();
            } else {
              setExtendDialogOpen(false);
            }
          } else {
            setExtendDialogOpen(open);
          }
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
          {grantState.phase === "indeterminate" && (
            <div
              role="alert"
              className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
            >
              {t("admin.proctorDashboard.extendDialog.indeterminateBanner")}
            </div>
          )}
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">
              {t("admin.proctorDashboard.extendDialog.minutesLabel")}
            </Label>
            <Input
              id="extend-minutes"
              type="number"
              min={1}
              value={grantMinutes}
              disabled={!grantFieldsEditable}
              onChange={(e) =>
                updateDraft({
                  minutes: Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <Label htmlFor="grant-reason-code">
              {t("admin.proctorDashboard.extendDialog.reasonCodeLabel")}
            </Label>
            <Select
              value={grantReasonCode}
              disabled={!grantFieldsEditable}
              onValueChange={(v) => updateDraft({ reasonCode: v })}
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
              disabled={!grantFieldsEditable}
              onChange={(e) => updateDraft({ reasonText: e.target.value })}
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
              disabled={extending || !canSubmitGrant}
              onClick={() => void handleGrantTime()}
            >
              {extending
                ? t("admin.proctorDashboard.extendDialog.confirming")
                : grantState.phase === "indeterminate"
                  ? t("admin.proctorDashboard.extendDialog.retry")
                  : t("admin.proctorDashboard.extendDialog.confirm", {
                      minutes: grantMinutes,
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
                        onClick={() => openGrantDialog(candidate)}
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
