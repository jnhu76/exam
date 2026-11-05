import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { plainTextProjection } from "@exam/domain";
import { resolveRichAnswerDocument } from "@exam/contracts";
import { Permission } from "@exam/authz";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { toast } from "sonner";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { can } from "@/lib/capabilities";
import { downloadFile } from "@/lib/download";
import { routes } from "@/lib/routes";
import { createContextSafeUuid } from "@/lib/uuid";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageSection } from "@/components/shared/PageSection";
import {
  DataTableCell,
  DataTableSurface,
  DataTableHead,
  DataTableOverflowText,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  Play,
  Send,
  Save,
  WifiOff,
  RefreshCw,
  Clock,
  Timer,
  Flag,
  FileCheck2,
  CircleCheck,
  X,
  HelpCircle,
  Download,
  FileJson,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { PageContainer } from "@/components/shared/PageContainer";
import { getTypeLabelKey } from "@/lib/constants";
import type {
  AttemptTimelineEvent,
  AttemptTimelineResponse,
  MisconductFlagDTO,
  ProctorAttemptEvent,
  ProctorAttemptEventListResponse,
  AnswerSaveReceiptSummary,
} from "@exam/contracts";

/**
 * Alias for {@link AttemptTimelineEvent} from the shared contracts package,
 * so the component reads naturally while staying in sync with the backend
 * schema (no type drift between frontend and backend).
 */
type TimelineEvent = AttemptTimelineEvent;

/** Tone classes for timeline event badges (semantic tokens only). */
type EventTone =
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "secondary"
  | "muted";

/**
 * Display metadata for a known audit action: i18n label key, tone, and icon.
 * Mirrors the statusMeta pattern — no display copy here; labels resolve via
 * `t(meta.labelKey)` (see {@link TimelineSection}).
 */
interface EventMeta {
  labelKey: string;
  tone: EventTone;
  icon: LucideIcon;
}

/**
 * Maps attempt-lifecycle audit actions to their i18n label key under
 * `admin.attemptDetail.events.*`. Audit *actions* are a distinct vocabulary
 * from lifecycle *statuses*, so this lives here rather than in statusMeta.ts.
 * Unknown actions fall back to a muted generic entry using the raw action.
 */
const EVENT_META: Record<string, EventMeta> = {
  "attempt.start": {
    labelKey: "admin.attemptDetail.events.start",
    tone: "primary",
    icon: Play,
  },
  "attempt.saveAnswer": {
    labelKey: "admin.attemptDetail.events.saveAnswer",
    tone: "secondary",
    icon: Save,
  },
  "attempt.disrupted": {
    labelKey: "admin.attemptDetail.events.disrupted",
    tone: "warning",
    icon: WifiOff,
  },
  "attempt.restore": {
    labelKey: "admin.attemptDetail.events.restore",
    tone: "info",
    icon: RefreshCw,
  },
  "attempt.submit": {
    labelKey: "admin.attemptDetail.events.submit",
    tone: "primary",
    icon: Send,
  },
  "attempt.autoSubmit": {
    labelKey: "admin.attemptDetail.events.autoSubmit",
    tone: "secondary",
    icon: Send,
  },
  "attempt.forceSubmit": {
    labelKey: "admin.attemptDetail.events.forceSubmit",
    tone: "destructive",
    icon: Send,
  },
  "attempt.extendTime": {
    labelKey: "admin.attemptDetail.events.extendTime",
    tone: "warning",
    icon: Timer,
  },
  grant_time: {
    labelKey: "admin.attemptDetail.events.grantTime",
    tone: "warning",
    icon: Clock,
  },
  "attempt.misconductFlagged": {
    labelKey: "admin.attemptDetail.events.misconductFlagged",
    tone: "destructive",
    icon: Flag,
  },
  "grading.score_entered": {
    labelKey: "admin.attemptDetail.events.scoreEntered",
    tone: "secondary",
    icon: FileCheck2,
  },
  "grading.finalized": {
    labelKey: "admin.attemptDetail.events.finalized",
    tone: "success",
    icon: CircleCheck,
  },
};

/** Badge tone → Tailwind class mapping for timeline events. */
const eventToneClass: Record<EventTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  secondary: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
};

/** Resolves an audit action to its display metadata, falling back to muted. */
function getEventMeta(action: string): EventMeta {
  return (
    EVENT_META[action] ?? { labelKey: "", tone: "muted", icon: HelpCircle }
  );
}

/** Level tone for one telemetry row badge (semantic tokens only). */
function telemetryLevelClass(level: ProctorAttemptEvent["level"]): string {
  if (level === "error") return "bg-destructive/10 text-destructive";
  if (level === "warn") return "bg-warning/10 text-warning";
  return "bg-muted text-muted-foreground";
}

/**
 * #866: read-only answer-save receipt summary — deliberately weak evidence,
 * presented as such. Three server-aggregated scalars over accepted-save
 * receipts only: count, MAX clientSeq, last server savedAt. The disclaimer
 * is part of the contract (issue reconciliation note): receipts are protocol
 * metadata, NOT independent content-authenticity proof; an empty summary is
 * NOT "never saved" (rejected or lost saves leave no server record — that
 * absence is UNKNOWN, not negative evidence); a clientSeq position is not a
 * content-identity claim across attempts.
 */
function ReceiptSummarySection({
  summary,
  isLoading,
  hasError,
  onRetry,
}: {
  summary: AnswerSaveReceiptSummary | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  return (
    <PageSection
      title={t("admin.attemptDetail.receiptSummary.title")}
      description={t("admin.attemptDetail.receiptSummary.description")}
    >
      {isLoading ? (
        <LoadingState />
      ) : hasError ? (
        <ErrorState
          message={t("admin.attemptDetail.receiptSummary.loadFailed")}
          onRetry={onRetry}
        />
      ) : !summary || summary.receiptCount === 0 ? (
        <p className="type-metadata">
          {t("admin.attemptDetail.receiptSummary.empty")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="type-metadata shrink-0">
            {t("admin.attemptDetail.receiptSummary.count", {
              count: summary.receiptCount,
            })}
          </span>
          <span className="type-metadata shrink-0">
            {t("admin.attemptDetail.receiptSummary.maxClientSeq", {
              seq: summary.maxClientSeq ?? 0,
            })}
          </span>
          <span className="type-metadata shrink-0">
            {t("admin.attemptDetail.receiptSummary.lastSavedAt", {
              time: summary.lastSavedAt
                ? formatDateTime(summary.lastSavedAt)
                : "-",
            })}
          </span>
        </div>
      )}
      <p className="mt-2 type-metadata">
        {t("admin.attemptDetail.receiptSummary.disclaimer")}
      </p>
    </PageSection>
  );
}

/** Props for the telemetry (proctor-events) timeline section. */
interface TelemetrySectionProps {
  events: ProctorAttemptEvent[] | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  /** Last loaded page and the server's pagination metadata (append-on-load). */
  page: number;
  totalPages: number;
  total: number;
  /** True while a Load-More page fetch is in flight (rows stay visible). */
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Card showing the merged proctor-events timeline for one attempt
 * (client_events telemetry + audit rows, newest first). The wire payload is
 * the server-projected allowlist metadata (proctorMonitoringService), so the
 * page renders stable category codes only — never raw client blobs. Source
 * provenance is rendered per row: client rows are ADVISORY telemetry, audit
 * rows are the authoritative compliance record (#544).
 *
 * Time authority (#544): the timeline is ordered by the server-owned receive
 * instant, projected per row as `serverRecordedAt` — shown first on every
 * row. Client rows additionally carry the client-ASSERTED `occurredAt`,
 * labeled as a claim, never as the ordering instant. Older evidence pages
 * load via Load-More append; the counts footer always states how much of the
 * server total is on screen, so a partial view is never mistaken for the
 * full history.
 */
function TelemetrySection({
  events,
  isLoading,
  hasError,
  onRetry,
  page,
  totalPages,
  total,
  loadingMore,
  onLoadMore,
}: TelemetrySectionProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const hasMore = page < totalPages;
  return (
    <PageSection
      title={t("admin.attemptDetail.telemetry.title")}
      description={t("admin.attemptDetail.telemetry.description")}
    >
      {isLoading ? (
        <LoadingState />
      ) : hasError ? (
        <ErrorState
          message={t("admin.attemptDetail.telemetry.loadFailed")}
          onRetry={onRetry}
        />
      ) : !events || events.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Clock} size="state" />}
          title={t("admin.attemptDetail.telemetry.emptyTitle")}
          description={t("admin.attemptDetail.telemetry.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border p-2 text-xs"
            >
              <span className="type-metadata shrink-0 whitespace-nowrap">
                {t("admin.attemptDetail.telemetry.serverReceivedAt")}{" "}
                {formatDateTime(event.serverRecordedAt)}
              </span>
              {event.source === "client_event" && (
                <span className="type-metadata shrink-0 whitespace-nowrap">
                  {t("admin.attemptDetail.telemetry.clientClaimedAt")}{" "}
                  {formatDateTime(event.occurredAt)}
                </span>
              )}
              <Badge
                variant="secondary"
                className={`shrink-0 ${telemetryLevelClass(event.level)}`}
              >
                {event.source === "audit_log"
                  ? t("admin.attemptDetail.telemetry.sourceAuditLog")
                  : t("admin.attemptDetail.telemetry.sourceClientEvent")}
              </Badge>
              <span className="font-medium">{event.name}</span>
              {event.metadata && Object.keys(event.metadata).length > 0 && (
                <span className="type-metadata min-w-0 break-all">
                  {JSON.stringify(event.metadata)}
                </span>
              )}
            </div>
          ))}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="type-metadata">
              {t("admin.attemptDetail.telemetry.counts", {
                shown: events.length,
                total,
              })}
            </span>
            {hasMore && (
              <span className="type-metadata">
                {t("admin.attemptDetail.telemetry.partialNotice", {
                  shown: events.length,
                })}
              </span>
            )}
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {t("admin.attemptDetail.telemetry.loadMore")}
              </Button>
            )}
          </div>
        </div>
      )}
    </PageSection>
  );
}

/** Per-question grading result for a single exam attempt. */
interface QuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  type: string;
  content: string;
  /** Frozen answer input mode — the render authority
   * for candidateAnswer. */
  answerMode?: string | null;
  order: number;
}

/** Attempt result returned when grading is complete and results are visible. */
interface VisibleAttemptResult {
  attemptId: string;
  status: "graded";
  showResultImmediately: true;
  examTitle: string;
  passingScore: number;
  totalScore: number;
  passed: boolean;
  gradedAt: string;
  questionResults: QuestionResult[];
}

/** Union of the visible attempt result and the hidden (not-yet-graded) response. */
type AttemptResultResponse =
  | VisibleAttemptResult
  | {
      attemptId: string;
      status: string;
      showResultImmediately: false;
      examTitle: string;
    };

/** Attempt statuses an admin may flag for misconduct. */
const FLAGGABLE_STATUSES = new Set(["in_progress", "disrupted"]);

/** Converts an answer value to a display-friendly string. Rich documents collapse to their plain-text projection for the compact table cells — but only when the FROZEN answerMode is rich, and only after the read authority accepts the document. A rich-mode value the authority cannot interpret keeps the integrity notice; it must not masquerade as a plain answer (§7 read contract). */
function formatAnswer(value: unknown, answerMode?: string | null): string {
  if (value == null) return "—";
  const richDocument = resolveRichAnswerDocument(value, answerMode);
  if (richDocument) return plainTextProjection(richDocument);
  if (answerMode === "rich")
    return i18n.t("content.unsupportedAnswer" as never);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Triggers a download for one of the attempt export formats and surfaces a
 * toast on failure. Shared by the CSV and JSON export buttons.
 */
async function exportAttempt(
  attemptId: string,
  format: "csv" | "json",
  exportFailedMsg: string,
): Promise<void> {
  try {
    if (format === "csv") {
      await downloadFile(
        `/api/admin/attempts/${attemptId}/export/csv`,
        `attempt-${attemptId}.csv`,
      );
    } else {
      await downloadFile(
        `/api/admin/attempts/${attemptId}/export`,
        `attempt-${attemptId}.json`,
      );
    }
  } catch (err) {
    toast.error(getApiErrorMessage(err, i18n.t, exportFailedMsg));
  }
}

/** Props for the attempt export buttons (CSV + JSON). */
interface ExportButtonsProps {
  attemptId: string;
  /** AttemptExport capability — the buttons render only for callers whose
   * capability set owns the export endpoints (issue 612). UX truthfulness only;
   * the backend remains the security authority. */
  canExport: boolean;
}

function ExportButtons({ attemptId, canExport }: ExportButtonsProps) {
  const { t } = useTranslation();
  if (!canExport) return null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() =>
          void exportAttempt(
            attemptId,
            "csv",
            t("admin.attemptDetail.errors.exportFailed"),
          )
        }
      >
        <AppIcon icon={Download} size="inline" />
        {t("admin.attemptDetail.actions.exportCsv")}
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          void exportAttempt(
            attemptId,
            "json",
            t("admin.attemptDetail.errors.exportFailed"),
          )
        }
      >
        <AppIcon icon={FileJson} size="inline" />
        {t("admin.attemptDetail.actions.exportJson")}
      </Button>
    </>
  );
}

/** Props for the attempt lifecycle timeline section. */
interface TimelineSectionProps {
  events: TimelineEvent[] | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  expandedEventId: string | null;
  onToggleEvent: (id: string) => void;
}

/**
 * Card showing the chronological audit trail of an attempt. Reuses the shared
 * loading/error/empty states. Each event row expands to reveal its metadata.
 */
function TimelineSection({
  events,
  isLoading,
  hasError,
  onRetry,
  expandedEventId,
  onToggleEvent,
}: TimelineSectionProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  return (
    <PageSection title={t("admin.attemptDetail.timeline.title")}>
      {isLoading ? (
        <LoadingState />
      ) : hasError ? (
        <ErrorState
          message={t("admin.attemptDetail.timeline.loadFailed")}
          onRetry={onRetry}
        />
      ) : !events || events.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Clock} size="state" />}
          title={t("admin.attemptDetail.timeline.emptyTitle")}
          description={t("admin.attemptDetail.timeline.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {events.map((event, index) => {
            const meta = getEventMeta(event.action);
            const Icon = meta.icon;
            const isExpanded = expandedEventId === event.id;
            // Unknown actions have no labelKey; fall back to the raw action.
            const label = meta.labelKey
              ? t(meta.labelKey as never)
              : event.action;
            return (
              <div key={event.id}>
                {index > 0 && <Separator className="my-1" />}
                <button
                  type="button"
                  onClick={() => onToggleEvent(event.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  aria-expanded={isExpanded}
                >
                  <span className="text-muted-foreground" aria-hidden="true">
                    <AppIcon icon={Icon} size="inline" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={eventToneClass[meta.tone]}
                      >
                        {label}
                      </Badge>
                      <span className="type-metadata whitespace-nowrap">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </span>
                    <span className="type-metadata mt-0.5 block truncate">
                      {t("admin.attemptDetail.timeline.actorPrefix")}{" "}
                      {event.actorId}
                    </span>
                  </span>
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-1 px-2 pb-2">
                    <pre className="type-code rounded bg-muted p-3">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                    {event.ipAddress && (
                      <p className="type-metadata">
                        {t("admin.attemptDetail.timeline.ipAddress", {
                          address: event.ipAddress,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageSection>
  );
}

/**
 * Displays a graded exam attempt's score summary and per-question answer details.
 * Shows the earned score, passing threshold, and a table of each question with
 * the candidate's answer, standard answer, and points awarded.
 */
export function AttemptDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: actor } = useAuth();
  const [result, setResult] = useState<VisibleAttemptResult | null>(null);
  const [liveAttempt, setLiveAttempt] = useState<{
    attemptId: string;
    status: string;
    examTitle: string;
  } | null>(null);
  const [liveMisconduct, setLiveMisconduct] =
    useState<MisconductFlagDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Timeline fetch is independent of the result fetch so it can load and
  // render for any attempt status (live or graded).
  const [receiptSummary, setReceiptSummary] =
    useState<AnswerSaveReceiptSummary | null>(null);
  const [receiptSummaryLoading, setReceiptSummaryLoading] = useState(true);
  const [receiptSummaryError, setReceiptSummaryError] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  // Telemetry (proctor-events) fetch: independent of both the result and the
  // audit timeline so it renders for any attempt status — the monitoring list
  // drops submitted/graded attempts, but this timeline stays queryable for
  // the retention window and is where save-failure evidence lives (#800).
  const [telemetry, setTelemetry] = useState<ProctorAttemptEvent[] | null>(
    null,
  );
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryError, setTelemetryError] = useState(false);
  // Pagination state mirrors the server response (page/totalPages/total) so
  // the section can state exactly how much of the server total is on screen.
  // `page` advances only on a successful Load-More append.
  const [telemetryPage, setTelemetryPage] = useState(1);
  const [telemetryTotalPages, setTelemetryTotalPages] = useState(0);
  const [telemetryTotal, setTelemetryTotal] = useState(0);
  const [telemetryLoadingMore, setTelemetryLoadingMore] = useState(false);
  // Stale-response guard for the telemetry fetch/append: a response issued for
  // a PREVIOUS attempt must never write rows, pagination metadata, or an error
  // into the next attempt's section after a route change. The ref records the
  // attempt id the in-flight request belongs to; a late response whose scope
  // no longer matches is dropped. (The result/timeline loads are single-shot
  // and replace their state wholesale, so they do not need this.)
  const telemetryScopeRef = useRef<string | null>(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagSeverity, setFlagSeverity] = useState<"warning" | "serious">(
    "warning",
  );
  const [flagNotes, setFlagNotes] = useState("");
  const [flagging, setFlagging] = useState(false);
  // INVARIANT: one logical misconduct command = one operationId (J5-R0 §8.2).
  // Minted when the dialog opens, retained across same-dialog retries so an
  // unconfirmed failure replays the SAME identity (a retry is not a new
  // command), and retired when the dialog closes or the command is confirmed
  // — the next dialog is a new command with a new identity.
  const [flagCommandIdentity, setFlagCommandIdentity] = useState<string | null>(
    null,
  );

  // Route reachability and sub-feature authority are DISTINCT capabilities: the
  // route gate is the attempts/:id entry in ADMIN_ROUTE_CAPABILITIES, while each
  // sub-feature owns its own @exam/authz permission (enforced per endpoint by the
  // API). A caller holding only the route capability gets the timeline shell
  // without the privileged sub-features, and without issuing requests the
  // backend would deny. UX composition only; the backend remains the security
  // authority.
  const canReadResult = actor !== null && can(actor, Permission.ScoreAllView);
  const canExportAttempt =
    actor !== null && can(actor, Permission.AttemptExport);
  const canFlagMisconduct =
    actor !== null && can(actor, Permission.AttemptMisconductMark);
  // Deep link into the Recovery archive (ledger/episodes/related incidents):
  // composed only for callers who can actually reach the recovery route gate
  // (IncidentRecoveryView — Admin preset). UX composition only; the backend
  // remains the security authority (issue 612 pattern).
  const canOpenRecoveryArchive =
    actor !== null && can(actor, Permission.IncidentRecoveryView);

  /** Header actions shared by every branch: the recovery-archive deep link
   * (capability-gated) plus the branch-specific buttons. */
  const recoveryArchiveButton = canOpenRecoveryArchive && id && (
    <Button
      variant="outline"
      onClick={() => navigate(routes.admin.recoveryAttempt(id))}
    >
      {t("admin.attemptDetail.actions.recoveryArchive")}
    </Button>
  );

  const loadResult = useCallback(async () => {
    // INVARIANT: the result fetch is issued only for callers whose capability
    // set owns it — page reachability alone must not mint a request the backend
    // will deny.
    if (!id || !canReadResult) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setLiveAttempt(null);
    setLiveMisconduct(null);
    try {
      // Admin/teacher all-view surface: the FULL result representation
      // (frozen standardAnswer per question). The candidate-safe projection
      // lives on GET /api/scores/attempts/:id (EXSEM-017 contract split).
      const data = await api.get<AttemptResultResponse>(
        `/api/admin/attempts/${id}/result`,
      );
      if (data.showResultImmediately === true) {
        setResult(data);
      } else if (FLAGGABLE_STATUSES.has(data.status)) {
        setLiveAttempt({
          attemptId: data.attemptId,
          status: data.status,
          examTitle: data.examTitle,
        });
        // The hidden (non-graded) response does not expose misconduct; the
        // badge is shown once an admin flags it this session.
      } else {
        setError(
          data.status === "submitted"
            ? t("admin.attemptDetail.errors.statusSubmitted")
            : data.status === "graded"
              ? t("admin.attemptDetail.errors.statusGradedHidden")
              : t("admin.attemptDetail.errors.resultHidden"),
        );
      }
    } catch {
      setError(t("admin.attemptDetail.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, t, canReadResult]);

  useEffect(() => {
    loadResult();
  }, [loadResult]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    setTimelineLoading(true);
    setTimelineError(false);
    setTimeline(null);
    try {
      const data = await api.get<AttemptTimelineResponse>(
        `/api/admin/attempts/${id}/timeline`,
      );
      setTimeline(data.events);
    } catch {
      setTimelineError(true);
    } finally {
      setTimelineLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // #866: receipt summary fetch — independent read-only aggregate.
  const loadReceiptSummary = useCallback(async () => {
    if (!id) return;
    setReceiptSummaryLoading(true);
    setReceiptSummaryError(false);
    setReceiptSummary(null);
    try {
      const data = await api.get<AnswerSaveReceiptSummary>(
        `/api/admin/attempts/${id}/answer-save-receipt-summary`,
      );
      setReceiptSummary(data);
    } catch {
      setReceiptSummaryError(true);
    } finally {
      setReceiptSummaryLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReceiptSummary();
  }, [loadReceiptSummary]);

  const loadTelemetry = useCallback(async () => {
    if (!id) return;
    // Claim the scope: any response still in flight for a previous attempt
    // now fails its scope check below and is dropped.
    telemetryScopeRef.current = id;
    setTelemetryLoading(true);
    setTelemetryError(false);
    setTelemetry(null);
    setTelemetryLoadingMore(false);
    try {
      const data = await api.get<ProctorAttemptEventListResponse>(
        `/api/admin/attempts/${id}/proctor-events?limit=50`,
      );
      if (telemetryScopeRef.current !== id) return;
      setTelemetry(data.items);
      setTelemetryPage(data.page);
      setTelemetryTotalPages(data.totalPages);
      setTelemetryTotal(data.total);
    } catch {
      if (telemetryScopeRef.current === id) setTelemetryError(true);
    } finally {
      if (telemetryScopeRef.current === id) setTelemetryLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  /**
   * Load-More: fetches the NEXT page and appends it to the visible rows.
   * INVARIANT: existing rows stay mounted while the fetch is in flight
   * (`telemetryLoading` is not toggled — the section keeps rendering the
   * loaded evidence), and a failed fetch leaves the rows intact. Rows are
   * deduplicated by event id on append so a timeline that shifted between
   * page fetches cannot produce duplicate React keys. A response whose
   * attempt scope no longer matches is dropped (route change).
   */
  const loadMoreTelemetry = useCallback(async () => {
    if (!id || telemetryLoadingMore) return;
    const nextPage = telemetryPage + 1;
    const scope = telemetryScopeRef.current;
    setTelemetryLoadingMore(true);
    try {
      const data = await api.get<ProctorAttemptEventListResponse>(
        `/api/admin/attempts/${id}/proctor-events?limit=50&page=${nextPage}`,
      );
      if (telemetryScopeRef.current !== scope) return;
      setTelemetry((prev) => {
        const seen = new Set((prev ?? []).map((event) => event.id));
        return [
          ...(prev ?? []),
          ...data.items.filter((event) => !seen.has(event.id)),
        ];
      });
      setTelemetryPage(data.page);
      setTelemetryTotalPages(data.totalPages);
      setTelemetryTotal(data.total);
    } catch {
      // Keep the already-visible rows; the fetch failure is surfaced as a
      // toast, not by replacing the loaded evidence with an error state.
      if (telemetryScopeRef.current === scope) {
        toast.error(t("admin.attemptDetail.telemetry.loadMoreFailed"));
      }
    } finally {
      if (telemetryScopeRef.current === scope) setTelemetryLoadingMore(false);
    }
  }, [id, telemetryLoadingMore, telemetryPage, t]);

  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const setFlagDialog = useCallback((open: boolean) => {
    setFlagDialogOpen(open);
    setFlagCommandIdentity(open ? createContextSafeUuid() : null);
  }, []);

  const handleFlag = useCallback(async () => {
    // Capability guard on the callback itself (issue 612): a render regression that
    // re-shows the flag button must not be able to invoke the command.
    if (!liveAttempt || !flagCommandIdentity || !canFlagMisconduct) return;
    const notes = flagNotes.trim();
    if (!notes) {
      toast.error(t("admin.attemptDetail.flag.notesRequired"));
      return;
    }
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${liveAttempt.attemptId}/misconduct`,
        { operationId: flagCommandIdentity, severity: flagSeverity, notes },
      );
      toast.success(t("admin.attemptDetail.flag.flagged"));
      setFlagDialog(false);
      setFlagNotes("");
      setLiveMisconduct({
        flaggedAt: new Date().toISOString(),
        flaggedBy: "",
        notes,
        severity: flagSeverity,
      });
    } catch {
      toast.error(t("admin.attemptDetail.flag.flagFailed"));
    } finally {
      setFlagging(false);
    }
  }, [
    liveAttempt,
    flagCommandIdentity,
    flagSeverity,
    flagNotes,
    setFlagDialog,
    canFlagMisconduct,
    t,
  ]);

  // Timeline-only shell (issue 612): a caller without the score-read capability
  // (e.g. the Proctor preset, which legitimately reaches this route via
  // attempt.timeline.view) still gets the timeline surface; the result view,
  // export and misconduct sub-features simply do not compose for this caller.
  // Branches on the capability, never on a role name, so any custom role with
  // the same divergent set composes identically.
  if (!canReadResult) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.attemptDetail.shell.title")}
          actions={
            <div className="flex gap-2">
              {recoveryArchiveButton}
              <Button variant="outline" onClick={() => void navigate(-1)}>
                {t("admin.attemptDetail.actions.back")}
              </Button>
            </div>
          }
        />
        <ReceiptSummarySection
          summary={receiptSummary}
          isLoading={receiptSummaryLoading}
          hasError={receiptSummaryError}
          onRetry={loadReceiptSummary}
        />
        <TimelineSection
          events={timeline}
          isLoading={timelineLoading}
          hasError={timelineError}
          onRetry={loadTimeline}
          expandedEventId={expandedEventId}
          onToggleEvent={toggleEvent}
        />
        <TelemetrySection
          events={telemetry}
          isLoading={telemetryLoading}
          hasError={telemetryError}
          onRetry={loadTelemetry}
          page={telemetryPage}
          totalPages={telemetryTotalPages}
          total={telemetryTotal}
          loadingMore={telemetryLoadingMore}
          onLoadMore={loadMoreTelemetry}
        />
      </div>
    );
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result && !liveAttempt)
    return (
      <ErrorState
        message={t("admin.attemptDetail.errors.dataLoadFailed")}
        onRetry={loadResult}
      />
    );

  // Live (in_progress/disrupted) attempt: admin misconduct-flag action view.
  if (liveAttempt && !result) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={`${liveAttempt.examTitle} - ${t(
            "admin.attemptDetail.live.titleSuffix",
          )}`}
          actions={
            <div className="flex gap-2">
              {recoveryArchiveButton}
              <ExportButtons attemptId={id!} canExport={canExportAttempt} />
              <Button variant="outline" onClick={() => void navigate(-1)}>
                {t("admin.attemptDetail.actions.back")}
              </Button>
            </div>
          }
        />
        <PageSection title={t("admin.attemptDetail.live.statusTitle")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={liveAttempt.status} />
              {liveMisconduct && (
                <StatusBadge status={`misconduct_${liveMisconduct.severity}`} />
              )}
              {liveMisconduct && (
                <span className="type-secondary">{liveMisconduct.notes}</span>
              )}
            </div>
            {canFlagMisconduct && (
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setFlagDialog(true)}
              >
                {t("admin.attemptDetail.actions.flagMisconduct")}
              </Button>
            )}
          </div>
        </PageSection>

        <ReceiptSummarySection
          summary={receiptSummary}
          isLoading={receiptSummaryLoading}
          hasError={receiptSummaryError}
          onRetry={loadReceiptSummary}
        />
        <TimelineSection
          events={timeline}
          isLoading={timelineLoading}
          hasError={timelineError}
          onRetry={loadTimeline}
          expandedEventId={expandedEventId}
          onToggleEvent={toggleEvent}
        />

        <TelemetrySection
          events={telemetry}
          isLoading={telemetryLoading}
          hasError={telemetryError}
          onRetry={loadTelemetry}
          page={telemetryPage}
          totalPages={telemetryTotalPages}
          total={telemetryTotal}
          loadingMore={telemetryLoadingMore}
          onLoadMore={loadMoreTelemetry}
        />

        <Dialog open={flagDialogOpen} onOpenChange={setFlagDialog}>
          <DialogContent aria-describedby={undefined} size="sm">
            <DialogHeader>
              <DialogTitle>
                {t("admin.attemptDetail.live.flagDialog.title")}
              </DialogTitle>
              <DialogDescription>
                {t("admin.attemptDetail.live.flagDialog.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="flag-severity">
                  {t("admin.attemptDetail.live.flagDialog.severityLabel")}
                </Label>
                <Select
                  value={flagSeverity}
                  onValueChange={(v) =>
                    setFlagSeverity(v as "warning" | "serious")
                  }
                >
                  <SelectTrigger id="flag-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">
                      {t("admin.attemptDetail.live.flagDialog.severityWarning")}
                    </SelectItem>
                    <SelectItem value="serious">
                      {t("admin.attemptDetail.live.flagDialog.severitySerious")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="flag-notes">
                  {t("admin.attemptDetail.live.flagDialog.notesLabel")}
                </Label>
                <Textarea
                  id="flag-notes"
                  value={flagNotes}
                  onChange={(e) => setFlagNotes(e.target.value)}
                  placeholder={t(
                    "admin.attemptDetail.live.flagDialog.notesPlaceholder",
                  )}
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setFlagDialog(false)}
                disabled={flagging}
              >
                {t("admin.attemptDetail.live.flagDialog.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={flagging}
                onClick={() => void handleFlag()}
              >
                {flagging
                  ? t("admin.attemptDetail.live.flagDialog.submitting")
                  : t("admin.attemptDetail.live.flagDialog.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Past this point the attempt is graded with a visible result.
  if (!result)
    return (
      <ErrorState
        message={t("admin.attemptDetail.errors.scoreDataLoadFailed")}
        onRetry={loadResult}
      />
    );

  const sortedQuestions = [...result.questionResults].sort(
    (a, b) => a.order - b.order,
  );
  const earnedScore = sortedQuestions.reduce((sum, q) => sum + q.score, 0);

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={`${result.examTitle} - ${t(
          "admin.attemptDetail.result.titleSuffix",
        )}`}
        actions={
          <div className="flex gap-2">
            {recoveryArchiveButton}
            <ExportButtons attemptId={id!} canExport={canExportAttempt} />
            <Button variant="outline" onClick={() => void navigate(-1)}>
              {t("admin.attemptDetail.actions.back")}
            </Button>
          </div>
        }
      />

      <PageSection title={t("admin.attemptDetail.result.summaryTitle")}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="type-secondary">
              {t("admin.attemptDetail.result.totalScore")}
            </p>
            <p className="type-metric">{result.totalScore}</p>
          </div>
          <div>
            <p className="type-secondary">
              {t("admin.attemptDetail.result.earnedScore")}
            </p>
            <p data-testid="earned-score" className="type-metric">
              <span
                className={result.passed ? "text-success" : "text-destructive"}
              >
                {earnedScore}
              </span>
            </p>
          </div>
          <div>
            <p className="type-secondary">
              {t("admin.attemptDetail.result.passingLine")}
            </p>
            <p className="type-metric">{result.passingScore}</p>
          </div>
          <div>
            <p className="type-secondary">
              {t("admin.attemptDetail.result.status")}
            </p>
            <StatusBadge
              status={result.passed ? "passed" : "not_passed"}
              className="mt-1"
            />
          </div>
        </div>
      </PageSection>

      <DataTableShell
        archetype="detail-comparison"
        title={t("admin.attemptDetail.result.detailTitle")}
      >
        <DataTableSurface
          columns={[
            { role: "number" },
            { role: "long-text", key: "question", overflow: "truncate" },
            { role: "type" },
            { role: "secondary-text", key: "candidate-answer" },
            { role: "secondary-text", key: "standard-answer" },
            { role: "score", key: "earned-score" },
            { role: "score", key: "max-score" },
          ]}
        >
          <TableHeader>
            <TableRow>
              <DataTableHead role="number">
                {t("admin.attemptDetail.result.columns.number")}
              </DataTableHead>
              <DataTableHead role="long-text">
                {t("admin.attemptDetail.result.columns.content")}
              </DataTableHead>
              <DataTableHead role="type">
                {t("admin.attemptDetail.result.columns.type")}
              </DataTableHead>
              <DataTableHead role="secondary-text">
                {t("admin.attemptDetail.result.columns.candidateAnswer")}
              </DataTableHead>
              <DataTableHead role="secondary-text">
                {t("admin.attemptDetail.result.columns.standardAnswer")}
              </DataTableHead>
              <DataTableHead role="score">
                {t("admin.attemptDetail.result.columns.score")}
              </DataTableHead>
              <DataTableHead role="score">
                {t("admin.attemptDetail.result.columns.maxScore")}
              </DataTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedQuestions.map((q) => (
              <TableRow key={q.questionId}>
                <DataTableCell role="number">{q.order + 1}</DataTableCell>
                <DataTableCell role="long-text">
                  <DataTableOverflowText mode="truncate" value={q.content} />
                </DataTableCell>
                <DataTableCell role="type">
                  <Badge variant="outline">
                    {(getTypeLabelKey(q.type)
                      ? t(getTypeLabelKey(q.type) as never)
                      : undefined) ?? q.type}
                  </Badge>
                </DataTableCell>
                <DataTableCell role="secondary-text">
                  <Badge variant={q.correct ? "success" : "secondary"}>
                    {!q.correct && (
                      <AppIcon
                        icon={X}
                        size="inline"
                        className="text-muted-foreground"
                      />
                    )}
                    {formatAnswer(q.candidateAnswer, q.answerMode)}
                  </Badge>
                </DataTableCell>
                <DataTableCell role="secondary-text">
                  {formatAnswer(q.standardAnswer)}
                </DataTableCell>
                <DataTableCell role="score">{q.score}</DataTableCell>
                <DataTableCell role="score">{q.maxScore}</DataTableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTableSurface>
      </DataTableShell>

      <ReceiptSummarySection
        summary={receiptSummary}
        isLoading={receiptSummaryLoading}
        hasError={receiptSummaryError}
        onRetry={loadReceiptSummary}
      />

      <TimelineSection
        events={timeline}
        isLoading={timelineLoading}
        hasError={timelineError}
        onRetry={loadTimeline}
        expandedEventId={expandedEventId}
        onToggleEvent={toggleEvent}
      />

      <TelemetrySection
        events={telemetry}
        isLoading={telemetryLoading}
        hasError={telemetryError}
        onRetry={loadTelemetry}
        page={telemetryPage}
        totalPages={telemetryTotalPages}
        total={telemetryTotal}
        loadingMore={telemetryLoadingMore}
        onLoadMore={loadMoreTelemetry}
      />
    </PageContainer>
  );
}
