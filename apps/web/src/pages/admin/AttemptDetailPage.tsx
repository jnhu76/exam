import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
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
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { getTypeLabelKey } from "@/lib/constants";
import type {
  AttemptTimelineEvent,
  AttemptTimelineResponse,
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

/** Misconduct flag DTO (mirrors MisconductFlagDTO in @exam/contracts). */
interface MisconductFlag {
  flaggedAt: string;
  flaggedBy: string;
  notes: string;
  severity: "warning" | "serious";
}

/** Converts an answer value to a display-friendly string. */
function formatAnswer(value: unknown): string {
  if (value == null) return "—";
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
    const message = err instanceof ApiError ? err.message : exportFailedMsg;
    toast.error(message);
  }
}

/** Props for the attempt export buttons (CSV + JSON). */
interface ExportButtonsProps {
  attemptId: string;
}

/**
 * Two outline buttons — 导出CSV and 导出JSON — that download the attempt via
 * the shared {@link downloadFile} helper (cookie-authenticated, cross-origin
 * safe). Reused by both the live and graded attempt views. Labels resolve from
 * `admin.attemptDetail.actions.*` i18n keys.
 */
function ExportButtons({ attemptId }: ExportButtonsProps) {
  const { t } = useTranslation();
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("admin.attemptDetail.timeline.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
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
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(event.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground truncate">
                        {t("admin.attemptDetail.timeline.actorPrefix")}{" "}
                        {event.actorId}
                      </span>
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="flex flex-col gap-1 px-2 pb-2">
                      <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                      {event.ipAddress && (
                        <p className="text-xs text-muted-foreground">
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
      </CardContent>
    </Card>
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
  const [result, setResult] = useState<VisibleAttemptResult | null>(null);
  const [liveAttempt, setLiveAttempt] = useState<{
    attemptId: string;
    status: string;
    examTitle: string;
  } | null>(null);
  const [liveMisconduct, setLiveMisconduct] = useState<MisconductFlag | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Timeline fetch is independent of the result fetch so it can load and
  // render for any attempt status (live or graded).
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagSeverity, setFlagSeverity] = useState<"warning" | "serious">(
    "warning",
  );
  const [flagNotes, setFlagNotes] = useState("");
  const [flagging, setFlagging] = useState(false);

  const loadResult = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setLiveAttempt(null);
    setLiveMisconduct(null);
    try {
      const data = await api.get<AttemptResultResponse>(
        `/api/scores/attempts/${id}`,
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
            : data.status === "grading"
              ? t("admin.attemptDetail.errors.statusGrading")
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
  }, [id, t]);

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

  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleFlag = useCallback(async () => {
    if (!liveAttempt) return;
    const notes = flagNotes.trim();
    if (!notes) {
      toast.error(t("admin.attemptDetail.flag.notesRequired"));
      return;
    }
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${liveAttempt.attemptId}/misconduct`,
        { severity: flagSeverity, notes },
      );
      toast.success(t("admin.attemptDetail.flag.flagged"));
      setFlagDialogOpen(false);
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
  }, [liveAttempt, flagSeverity, flagNotes, t]);

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
              <ExportButtons attemptId={id!} />
              <Button variant="outline" onClick={() => void navigate(-1)}>
                {t("admin.attemptDetail.actions.back")}
              </Button>
            </div>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("admin.attemptDetail.live.statusTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={liveAttempt.status} />
                {liveMisconduct && (
                  <StatusBadge
                    status={`misconduct_${liveMisconduct.severity}`}
                  />
                )}
                {liveMisconduct && (
                  <span className="text-sm text-muted-foreground">
                    {liveMisconduct.notes}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setFlagDialogOpen(true)}
              >
                {t("admin.attemptDetail.actions.flagMisconduct")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <TimelineSection
          events={timeline}
          isLoading={timelineLoading}
          hasError={timelineError}
          onRetry={loadTimeline}
          expandedEventId={expandedEventId}
          onToggleEvent={toggleEvent}
        />

        <Dialog open={flagDialogOpen} onOpenChange={setFlagDialogOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-sm">
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
                onClick={() => setFlagDialogOpen(false)}
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${result.examTitle} - ${t(
          "admin.attemptDetail.result.titleSuffix",
        )}`}
        actions={
          <div className="flex gap-2">
            <ExportButtons attemptId={id!} />
            <Button variant="outline" onClick={() => void navigate(-1)}>
              {t("admin.attemptDetail.actions.back")}
            </Button>
          </div>
        }
      />

      <PageSection title={t("admin.attemptDetail.result.summaryTitle")}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {t("admin.attemptDetail.result.totalScore")}
            </p>
            <p className="type-metric">{result.totalScore}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              {t("admin.attemptDetail.result.passingLine")}
            </p>
            <p className="type-metric">{result.passingScore}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {t("admin.attemptDetail.result.status")}
            </p>
            <StatusBadge
              status={result.passed ? "passed" : "not_passed"}
              className="mt-1"
            />
          </div>
        </div>
      </PageSection>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.attemptDetail.result.detailTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTableShell contentClassName="p-0">
            <Table>
              <DataTableColumns
                columns={[
                  { role: "number" },
                  { role: "long-text", key: "question" },
                  { role: "type" },
                  { role: "secondary-text", key: "candidate-answer" },
                  { role: "secondary-text", key: "standard-answer" },
                  { role: "score", key: "earned-score" },
                  { role: "score", key: "max-score" },
                ]}
              />
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
                    <DataTableCell role="number">{q.order}</DataTableCell>
                    <DataTableCell
                      role="long-text"
                      className="truncate"
                      title={q.content}
                    >
                      {q.content}
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
                        {formatAnswer(q.candidateAnswer)}
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
            </Table>
          </DataTableShell>
        </CardContent>
      </Card>

      <TimelineSection
        events={timeline}
        isLoading={timelineLoading}
        hasError={timelineError}
        onRetry={loadTimeline}
        expandedEventId={expandedEventId}
        onToggleEvent={toggleEvent}
      />
    </div>
  );
}
