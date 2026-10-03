import {
  classifyPersistedRichAnswer,
  type PersistedRichAnswerState,
} from "@exam/contracts";
import { plainTextProjection, type QuestionType } from "@exam/domain";

/**
 * Export-side answer policy (rich-content-semantic-contract.md §14).
 *
 * The export boundary is a READER: it may choose a representation, but it may
 * never choose what a persisted Rich value means. Semantic interpretation is
 * delegated to the shared persisted-answer classifier
 * (`classifyPersistedRichAnswer`, @exam/contracts) and the frozen answer
 * context — never derived from the runtime shape. This module decides only
 * what each classified state is allowed to contribute to an export:
 *
 *   raw evidence != semantic projection
 *
 * - `raw` is the untouched stored value; the JSON export route carries it as
 *   the authoritative evidence (no projection replaces it);
 * - `projection` is the derived human-readable text. It is `null` whenever
 *   the state has no permitted semantic projection (`unsupported_version`,
 *   `corrupt`, `empty`) — a corrupt Rich value must never be silently
 *   exported as if it were a valid Plain answer (F-05).
 *
 * Export is read-only: nothing here normalizes, canonicalizes, repairs, or
 * writes back the persisted value.
 */

/** Per-question export view of one persisted candidate answer. */
export interface ExportAnswerView {
  /** Effective frozen mode of the slot (legacy/absent answerMode = plain). */
  mode: "plain" | "rich";
  /** Semantic integrity state of the stored value (`empty` when absent). */
  integrity: PersistedRichAnswerState;
  /** Derived human-readable text, or null when no projection is permitted. */
  projection: string | null;
}

/**
 * The display rule for NON-Rich-slot values: plain strings as-is, option-id
 * arrays joined, everything else JSON-serialized (the pre-existing CSV
 * convention for standard answers and typed objective answers).
 *
 * INTENTIONAL CONSTRAINT: never call this on a Rich-capable answer slot — a
 * rich `text_response` candidate answer must be classified through
 * `resolveExportAnswerView` so a corrupt/unsupported Rich value cannot reach
 * the CSV as normal answer text. The standard answer is the one legacy slot
 * this formatter still owns: it is authored plain text (or a typed objective
 * answer, or null), carries no Rich/Plain duality, and has no answerMode.
 */
export function formatPlainExportValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join("; ");
  return JSON.stringify(value);
}

/**
 * Classifies one persisted candidate answer and derives its export view.
 *
 * `answerMode` MUST come from the frozen question snapshot of the attempt —
 * never from the live question bank. The mode is what makes a string `plain`
 * on one slot and `corrupt` on another; the value's shape alone never does.
 */
export function resolveExportAnswerView(input: {
  questionType: QuestionType;
  answerMode: string | null | undefined;
  value: unknown;
}): ExportAnswerView {
  const mode = input.answerMode === "rich" ? "rich" : "plain";

  if (input.questionType !== "text_response") {
    // Objective / fill_blank slots carry typed protocol answers (option ids,
    // booleans, blank records); Rich/Plain duality does not exist there, so
    // the persisted-Rich classifier is not invoked and cannot mislabel a
    // legitimate array/boolean answer as corrupt.
    return {
      mode: "plain",
      integrity: input.value == null ? "empty" : "plain",
      projection:
        input.value == null ? null : formatPlainExportValue(input.value),
    };
  }

  const read = classifyPersistedRichAnswer({
    value: input.value,
    answerMode: input.answerMode,
  });
  switch (read.kind) {
    case "empty":
      return { mode, integrity: "empty", projection: null };
    case "plain":
      return { mode, integrity: "plain", projection: read.text };
    case "legacy_plain":
      // Provenance-backed legacy text stays distinguishable from ordinary
      // plain and is exportable as text (no production producer exists yet).
      return { mode, integrity: "legacy_plain", projection: read.text };
    case "rich_valid":
    case "rich_noncanonical":
      // Interpretable Rich content: a derived plain-text projection is
      // permitted (the same read-only display the admin/grading pages
      // render). Mode and integrity label it as derived; noncanonical values
      // are never relabeled canonical and never repaired.
      return {
        mode,
        integrity: read.kind,
        projection: plainTextProjection(read.document),
      };
    case "unsupported_version":
    case "corrupt":
      // F-05 trust boundary: raw evidence is preserved by the JSON export,
      // but no semantic Plain projection may be fabricated here.
      return { mode, integrity: read.kind, projection: null };
  }
}
