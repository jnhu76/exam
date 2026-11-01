import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { ContentScrollFocusContext } from "@/components/shared/content/ContentScrollViewport";
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
  // True while the collapsed clamp is deliberately applied to MEASURE. It is
  // the initial state and is re-armed on every collapse; after the measurement
  // settles it becomes observation.overflowing.
  const [measureClamp, setMeasureClamp] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  // Facts-only measurement owner: overflowing compares the full content
  // height (scrollHeight) against the clamp budget (clientHeight) while the
  // container is clamped.
  const observation = useVerticalOverflowObservation(contentRef);
  // Latched while expanded: an unclamped container reports no overflow, but
  // the toggle must stay to allow collapsing again. A collapse re-measures.
  const expandable = expanded || observation.overflowing;
  // The clamp is a MEASUREMENT state until the first observation lands
  // (clientHeight is 0 before layout) and after every collapse. Afterwards it
  // is applied only when it actually hides content. A rich answer can fit
  // vertically while a formula, code block or table still overflows
  // horizontally: that answer has no disclosure toggle, and its local scroll
  // regions must remain reachable.
  const measured = observation.clientHeight > 0;
  const clipped =
    !expanded && (measureClamp || !measured || observation.overflowing);
  useLayoutEffect(() => {
    if (expanded) {
      setMeasureClamp(false);
      return;
    }
    if (measured) setMeasureClamp(observation.overflowing);
  }, [expanded, measured, observation.overflowing]);

  function toggleExpanded() {
    if (expanded) {
      // Re-apply the clamp for one measurement cycle before deciding whether
      // the preview actually hides content.
      setMeasureClamp(true);
    }
    setExpanded((value) => !value);
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-stretch gap-1">
      <div
        ref={contentRef}
        id={contentId}
        data-answer-disclosure={expanded ? "expanded" : "collapsed"}
        data-answer-clipped={clipped ? "true" : "false"}
        // 3-line preview at the governed cell leading (3 × 1.375rem).
        // `w-full min-w-0` gives rich content the actual cell width; without
        // it the fit-content flex item becomes as wide as its widest
        // formula/code/table and paints over the score column.
        className={
          clipped
            ? "w-full min-w-0 max-h-[4.125rem] overflow-hidden"
            : "w-full min-w-0"
        }
      >
        {/* Only a clipped preview suppresses focus into its nested scroll
            regions (WCAG 2.4.11); if the content fits vertically, the
            horizontally overflowing formula/code/table is fully visible and
            must stay keyboard reachable even without a toggle. */}
        <ContentScrollFocusContext.Provider value={!clipped}>
          {children}
        </ContentScrollFocusContext.Provider>
      </div>
      {expandable && (
        // size=sm is the smallest authorized Button geometry (h-9, DESIGN.md
        // "Standard desktop control: 36px") — no page-local height override.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggleExpanded}
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

/** The visible response variant's per-question rows (the hidden variant carries none). */
type VisibleQuestionResults = Extract<
  CandidateAttemptResultResponse,
  { showResultImmediately: true }
>["questionResults"];

/**
 * The per-question presentation pieces shared by BOTH representations of the
 * result detail (WS2 S2.4): the desktop table row cells and the mobile
 * per-question block render the same verdict icon, manual marker and answer
 * payload — one business-data source, one answer presentation.
 */
function questionPresentation(
  question: VisibleQuestionResults[number],
  t: (key: string) => string,
) {
  const isManual = question.manualGraded === true;
  // Long-form content classes (essay and prose answers, rich documents)
  // render below their metadata line through the disclosure; objective
  // answers are short by construction and stay inline.
  const isLongForm =
    question.type === "text_response" || question.type === "fill_blank";
  const verdict = question.correct ? (
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
      t={t}
    />
  );
  return { isLongForm, verdict, manualMarker, answer };
}

/**
 * Mobile per-question representation of the result detail (Plan B, R0-F2):
 * the SAME questionResults array the desktop table maps, restated as one
 * semantically grouped block per question (number + score header, content,
 * type + verdict + manual marker, your answer). Rendered by the shell's
 * CSS viewport switch below lg; the hidden desktop table is display:none in
 * that range, so screen readers never see a duplicate view.
 */
function CandidateQuestionBlocks({
  questions,
  expandLabel,
  collapseLabel,
}: {
  questions: VisibleQuestionResults;
  expandLabel: string;
  collapseLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <ol data-testid="result-mobile-questions" className="flex flex-col gap-3">
      {questions.map((question) => {
        const { isLongForm, verdict, manualMarker, answer } =
          questionPresentation(question, t as (key: string) => string);
        return (
          <li
            key={question.questionId}
            className="rounded-md border border-border-divider bg-surface p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="type-secondary">
                {t("candidateResult.mobile.question", {
                  number: question.order + 1,
                })}
              </span>
              <span className="font-medium">
                {question.score}/{question.maxScore}
              </span>
            </div>
            <div className="mt-2">
              <ContentRenderer
                content={question.content}
                document={question.contentDocument}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="type-secondary">
                {getTypeLabel(question.type, t) ?? question.type}
              </span>
              {verdict}
              {manualMarker}
            </div>
            <div className="mt-1 min-w-0">
              <span className="type-secondary">
                {t("candidateResult.table.yourAnswer")}
              </span>
              <div className="mt-1">
                {isLongForm ? (
                  <AnswerDisclosure
                    expandLabel={expandLabel}
                    collapseLabel={collapseLabel}
                  >
                    {answer}
                  </AnswerDisclosure>
                ) : (
                  <div className="flex items-center gap-2">{answer}</div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
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
            mobile={
              <CandidateQuestionBlocks
                questions={result.questionResults}
                expandLabel={t("candidateResult.answer.expand")}
                collapseLabel={t("candidateResult.answer.collapse")}
              />
            }
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
                  const { isLongForm, verdict, manualMarker, answer } =
                    questionPresentation(
                      question,
                      t as (key: string) => string,
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
                              {verdict}
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
                            {verdict}
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
