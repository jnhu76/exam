import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  TriangleAlert,
} from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";
import { useNavigate, useParams } from "react-router";
import {
  resolveRichAnswerDocument,
  type CandidateAttemptResultResponse,
} from "@exam/contracts";
import { ContentRenderer } from "@/components/shared/content/ContentRenderer";
import { ContentDocumentRenderer } from "@/components/shared/content/ContentDocumentRenderer";
import { useVerticalOverflowObservation } from "@/hooks/useVerticalOverflowObservation";
import { api } from "@/lib/api";
import { getTypeLabel } from "@/lib/constants";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import {
  DataTableCell,
  DataTableSurface,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { PageContainer } from "@/components/shared/PageContainer";

/** Formats an answer value into a human-readable string via i18n. */
function formatAnswer(answer: unknown, t: (key: string) => string): string {
  if (answer === undefined || answer === null || answer === "")
    return t("candidateResult.answer.unanswered");
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean")
    return answer
      ? t("candidateResult.answer.correct")
      : t("candidateResult.answer.incorrect");
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>)
      .map((v) => formatAnswer(v, t))
      .join("、");
  }
  return String(answer);
}

/** The hidden response variant of the candidate attempt-result contract. */
type HiddenAttemptResult = Extract<
  CandidateAttemptResultResponse,
  { showResultImmediately: false }
>;

/**
 * Status projection (icon + copy) for a hidden candidate result (#698).
 *
 * INVARIANT: for a non-graded attempt the wire `status` is the lifecycle-copy
 * authority — `hiddenReason` stays the engine's historical catch-all
 * ("not_started") there and must not be rendered literally; only a graded
 * attempt's `hiddenReason` names the gate still withholding the computable
 * result (resolveCandidateResultVisibility two-stage gate).
 */
function hiddenResultPresentation(
  result: HiddenAttemptResult,
  t: (key: string) => string,
): { icon: LucideIcon; tone: string; message: string } {
  if (result.status !== "graded") {
    switch (result.status) {
      case "in_progress":
        return {
          icon: Clock,
          tone: "text-muted-foreground",
          message: t("candidateResult.status.in_progress"),
        };
      case "submitted":
        return {
          icon: Hourglass,
          tone: "text-muted-foreground",
          message: t("candidateResult.status.submitted"),
        };
      case "disrupted":
        return {
          icon: TriangleAlert,
          tone: "text-warning",
          message: t("candidateResult.status.disrupted"),
        };
      case "voided":
        return {
          icon: CircleX,
          tone: "text-destructive",
          message: t("candidateResult.status.voided"),
        };
      case "not_started":
        return {
          icon: Clock,
          tone: "text-muted-foreground",
          message: t("candidateResult.status.not_started"),
        };
      case "queued":
        return {
          icon: Clock,
          tone: "text-muted-foreground",
          message: t("candidateResult.status.queued"),
        };
      default: {
        // INVARIANT (compile-time drift guard): with every non-graded wire
        // status mapped above, `result.status` is `never` here; a future
        // AttemptStatus extension without a mapped message fails typecheck
        // instead of silently sliding into the neutral fallback below. The
        // return keeps a runtime fallback for untyped/unknown payloads.
        const unhandled: never = result.status;
        void unhandled;
        return {
          icon: Hourglass,
          tone: "text-muted-foreground",
          message: t("candidateResult.status.default"),
        };
      }
    }
  }
  // Graded but withheld: hiddenReason names the still-closed gate.
  switch (result.hiddenReason) {
    case "not_graded":
      return {
        icon: Hourglass,
        tone: "text-muted-foreground",
        message: t("candidateResult.status.not_graded"),
      };
    case "pending_publish":
      return {
        icon: Hourglass,
        tone: "text-muted-foreground",
        message: t("candidateResult.status.pending_publish"),
      };
    default:
      // hiddenReason is optional on the wire — the fallback must not assert
      // any particular lifecycle state.
      return {
        icon: Hourglass,
        tone: "text-muted-foreground",
        message: t("candidateResult.status.default"),
      };
  }
}

/**
 * Renders an answer value as text. Rich documents render through the static
 * content renderer.
 *
 * The frozen `answerMode` is the render authority: a payload that merely looks
 * like a ContentDocumentV1 envelope on a non-rich (or corrupt) answer keeps the
 * plain-text formatter.
 */
function AnswerText({
  answer,
  answerMode,
  t,
}: {
  answer: unknown;
  answerMode?: string | null;
  t: (key: string) => string;
}) {
  const richDocument = resolveRichAnswerDocument(answer, answerMode);
  if (richDocument) {
    return <ContentDocumentRenderer document={richDocument} />;
  }
  // A rich-mode value the read authority cannot interpret (corrupt or
  // unsupported version) shows the integrity notice — it must never fall
  // through to the plain formatter (§7 read contract). null/undefined keeps
  // the unanswered em-dash below.
  if (answerMode === "rich" && answer != null) {
    return (
      <span className="text-muted-foreground">
        {t("content.unsupportedAnswer")}
      </span>
    );
  }
  return <span>{formatAnswer(answer, t)}</span>;
}

/**
 * Collapsed-preview disclosure for long cell prose (R1-F2): the answer renders
 * at its full column width, visually clamped to a three-line preview; a
 * keyboard-operable toggle reveals the whole value in place. The full text
 * stays in the DOM (selectable, announced) in both states — a hover tooltip
 * is never the full-text entry. Expansion grows the row vertically only, so
 * the governed column widths and the page layout are untouched.
 */
function AnswerDisclosure({
  children,
  expandLabel,
  collapseLabel,
}: {
  children: ReactNode;
  expandLabel: string;
  collapseLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  // Facts-only measurement owner: overflowing compares the full content
  // height (scrollHeight) against the clamp budget (clientHeight) while the
  // container is clamped.
  const observation = useVerticalOverflowObservation(contentRef);
  // Latched while expanded: an unclamped container reports no overflow, but
  // the toggle must stay to allow collapsing again. A collapse re-measures.
  const expandable = expanded || observation.overflowing;

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        ref={contentRef}
        id={contentId}
        // 3-line preview at the governed cell leading (3 × 1.375rem).
        className={expanded ? undefined : "max-h-[4.125rem] overflow-hidden"}
      >
        {children}
      </div>
      {expandable && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1 text-xs"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          <AppIcon
            icon={expanded ? ChevronUp : ChevronDown}
            decorative
            size="inline"
          />
          {expanded ? collapseLabel : expandLabel}
        </Button>
      )}
    </div>
  );
}

/** Displays the scored result of a single exam attempt, including per-question breakdown or a pending-status message. */
export function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [result, setResult] = useState<CandidateAttemptResultResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  /** Fetches the attempt result from the scores API. */
  const loadResult = useCallback(async () => {
    if (!attemptId) return;
    setError(null);
    try {
      // Candidate-safe result contract (EXSEM-017): the DTO structurally
      // cannot carry standardAnswer/rubric/gradingRule.
      setResult(
        await api.get<CandidateAttemptResultResponse>(
          `/api/scores/attempts/${attemptId}`,
        ),
      );
    } catch {
      setError(t("candidateResult.error.loadFailed"));
    }
  }, [attemptId, t]);

  useEffect(() => {
    void loadResult();
  }, [loadResult]);

  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result) return <LoadingState />;

  // Hidden-result projection; null on the visible variant (see
  // hiddenResultPresentation for the status-vs-hiddenReason authority split).
  const hiddenView = result.showResultImmediately
    ? null
    : hiddenResultPresentation(result, t as (key: string) => string);

  return (
    <PageContainer role="candidate" className="flex flex-col gap-6">
      <h1 className="type-page-title">{result.examTitle}</h1>

      {result.showResultImmediately ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("candidateResult.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-center">
              <p className="type-metric-hero" data-testid="result-total-score">
                {result.totalScore}
              </p>
              <p className="type-secondary">
                {t("candidateResult.summary.passingScore", {
                  score: result.passingScore,
                })}
              </p>
              <p
                className={
                  result.passed
                    ? "font-medium text-success"
                    : "font-medium text-destructive"
                }
              >
                {result.passed
                  ? t("candidateResult.summary.passed")
                  : t("candidateResult.summary.failed")}
              </p>
            </CardContent>
          </Card>

          <DataTableShell
            archetype="detail-comparison"
            title={t("candidateResult.detail.title")}
            description={t("candidateResult.detail.answerNote")}
          >
            <DataTableSurface
              columns={[
                { role: "number" },
                { role: "long-text", key: "question" },
                { role: "type" },
                { role: "secondary-text", key: "candidate-answer" },
                { role: "score" },
              ]}
            >
              <TableHeader>
                <TableRow>
                  <DataTableHead role="number">
                    {t("candidateResult.table.questionNumber")}
                  </DataTableHead>
                  <DataTableHead role="long-text">
                    {t("candidateResult.table.questionContent")}
                  </DataTableHead>
                  <DataTableHead role="type">
                    {t("candidateResult.table.questionType")}
                  </DataTableHead>
                  <DataTableHead role="secondary-text">
                    {t("candidateResult.table.yourAnswer")}
                  </DataTableHead>
                  <DataTableHead role="score">
                    {t("candidateResult.table.score")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.questionResults.map((question) => {
                  // Candidate result contract (EXSEM-017): the DTO never
                  // carries standardAnswer, so the detail table has no
                  // correct-answer column — the shell states that reference
                  // answers are not published. manualGraded (computed
                  // server-side) travels with the candidate answer: it marks
                  // the human-graded provenance and is never silently dropped.
                  const isManual = question.manualGraded === true;
                  // Long-form content classes (essay and prose answers, rich
                  // documents) render below their metadata line through the
                  // disclosure; objective answers are short by construction
                  // and stay inline.
                  const isLongForm =
                    question.type === "text_response" ||
                    question.type === "fill_blank";
                  const verdictIcon = question.correct ? (
                    <AppIcon
                      icon={CircleCheck}
                      decorative={false}
                      label={t("candidateResult.aria.correct")}
                      size="inline"
                      className="text-success shrink-0"
                    />
                  ) : (
                    <AppIcon
                      icon={CircleX}
                      decorative={false}
                      label={t("candidateResult.aria.incorrect")}
                      size="inline"
                      className="text-muted-foreground shrink-0"
                    />
                  );
                  const manualMarker = isManual ? (
                    <span
                      className="type-secondary shrink-0"
                      data-testid={`result-question-manual-${question.questionId}`}
                    >
                      {t("candidateResult.answer.manual")}
                    </span>
                  ) : null;
                  const answer = (
                    <AnswerText
                      answer={question.candidateAnswer}
                      answerMode={question.answerMode}
                      t={t as (key: string) => string}
                    />
                  );
                  return (
                    <TableRow key={question.questionId}>
                      <DataTableCell role="number">
                        {question.order + 1}
                      </DataTableCell>
                      <DataTableCell role="long-text">
                        <ContentRenderer
                          content={question.content}
                          document={question.contentDocument}
                        />
                      </DataTableCell>
                      <DataTableCell role="type">
                        {/* Shared questionType dictionary (lib/constants) is
                            the single label authority for every legal type;
                            the raw-key fallback only covers contract drift. */}
                        {getTypeLabel(question.type, t) ?? question.type}
                      </DataTableCell>
                      <DataTableCell role="secondary-text">
                        {isLongForm ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              {verdictIcon}
                              {manualMarker}
                            </div>
                            <AnswerDisclosure
                              expandLabel={t("candidateResult.answer.expand")}
                              collapseLabel={t(
                                "candidateResult.answer.collapse",
                              )}
                            >
                              {answer}
                            </AnswerDisclosure>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {verdictIcon}
                            {manualMarker}
                            {answer}
                          </div>
                        )}
                      </DataTableCell>
                      <DataTableCell role="score">
                        {question.score}/{question.maxScore}
                      </DataTableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTableSurface>
          </DataTableShell>
        </>
      ) : (
        hiddenView && (
          <Card>
            <CardContent className="py-10 text-center">
              <AppIcon
                icon={hiddenView.icon}
                size="state"
                className={`mx-auto mb-3 ${hiddenView.tone}`}
              />
              <p
                className="text-lg font-medium"
                data-testid="result-status-message"
              >
                {hiddenView.message}
              </p>
            </CardContent>
          </Card>
        )
      )}

      <div className="flex justify-end">
        <Button onClick={() => navigate(routes.exam.list)}>
          {t("candidateResult.actions.backToList")}
        </Button>
      </div>
    </PageContainer>
  );
}
