import {
  CONTENT_DOC_VERSION,
  contentDocumentsEqual,
  isContentDocumentV1,
  preflightContentDocumentStructure,
  type ContentDocumentV1,
} from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "./contentDocument.js";

/**
 * FROZEN-SEMANTICS read authority for persisted answers
 * (rich-content-semantic-contract.md §7). Every consumer that interprets a
 * persisted candidate answer — candidate mount/restore/reload/STALE_VERSION
 * adoption, grading, result rendering, and API export — must classify through
 * `classifyPersistedRichAnswer` (or its binary projection
 * `resolveRichAnswerDocument`) and must not keep a private read oracle
 * (#669: the classifier lives in @exam/contracts so the web read
 * paths and the server export boundary consume one implementation).
 *
 * The classification needs CONTEXT, not only the value: the slot's frozen
 * `answerMode` decides whether a string is the legitimate representation
 * (`plain`) or an inconsistent stored shape (`corrupt`). PROVENANCE RULE: a
 * string where Rich is authoritative is `legacy_plain` only when the caller
 * supplies explicit evidence that the value was written by the legacy plain
 * protocol — `typeof value === "string"` never establishes it by itself. No
 * current persisted shape carries that evidence, so no production call site
 * sets `legacyPlainProvenance`; the state stays reachable for a future
 * migration that can prove provenance.
 *
 * Read classification never mutates or repairs persisted data: a
 * noncanonical document is returned as persisted (`rich_noncanonical`), and
 * both `unsupported_version` and `corrupt` carry the raw value so callers can
 * fail closed without losing track of the source truth.
 *
 * The classifier decides semantic interpretation ONLY. Representation choices
 * (e.g. which CSV column shows a plain projection, and what a corrupt row
 * renders as) belong to each consumer's own policy layer; do not add
 * export-specific formatting here.
 */

/** The seven §7 read states as a runtime vocabulary (export/DTO consumers). */
export const PERSISTED_RICH_ANSWER_STATES = [
  "empty",
  "plain",
  "legacy_plain",
  "rich_valid",
  "rich_noncanonical",
  "unsupported_version",
  "corrupt",
] as const;

/** One of the seven §7 read states, as a bare token. */
export type PersistedRichAnswerState =
  (typeof PERSISTED_RICH_ANSWER_STATES)[number];

export type RichAnswerReadState =
  | { kind: "empty" }
  | { kind: "plain"; text: string }
  | { kind: "legacy_plain"; text: string }
  | { kind: "rich_valid"; document: ContentDocumentV1 }
  | { kind: "rich_noncanonical"; document: ContentDocumentV1 }
  | { kind: "unsupported_version"; raw: unknown }
  | { kind: "corrupt"; raw: unknown };

/** Compile-time guard: the state vocabulary and the classified union agree. */
type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
const _stateVocabularyIdentity: AssertExact<
  RichAnswerReadState["kind"],
  PersistedRichAnswerState
> = true;
void _stateVocabularyIdentity;

export function classifyPersistedRichAnswer(input: {
  value: unknown;
  answerMode: string | null | undefined;
  /** Explicit legacy-plain provenance evidence; see the provenance rule above. */
  legacyPlainProvenance?: boolean;
}): RichAnswerReadState {
  const { value, answerMode } = input;
  if (value == null) return { kind: "empty" };
  if (answerMode !== "rich") {
    // Rich authority is not invoked on a plain slot: the string is the
    // legitimate representation; any other stored shape is inconsistent.
    if (typeof value === "string") return { kind: "plain", text: value };
    return { kind: "corrupt", raw: value };
  }
  if (typeof value === "string") {
    if (input.legacyPlainProvenance === true) {
      return { kind: "legacy_plain", text: value };
    }
    return { kind: "corrupt", raw: value };
  }
  // A numeric docVersion the system does not interpret is a forward-compat
  // signal and must win over any shape reasoning: never reinterpret a
  // future-version envelope as V1 content, empty, or plain.
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { docVersion?: unknown }).docVersion === "number" &&
    (value as { docVersion?: unknown }).docVersion !== CONTENT_DOC_VERSION
  ) {
    return { kind: "unsupported_version", raw: value };
  }
  if (!isContentDocumentV1(value)) return { kind: "corrupt", raw: value };
  if (preflightContentDocumentStructure(value).length > 0) {
    return { kind: "corrupt", raw: value };
  }
  const parsed = ContentDocumentV1Schema.safeParse(value);
  if (!parsed.success) return { kind: "corrupt", raw: value };
  // Canonical trust: a persisted value is rich_valid only when the same
  // canonicalization the write seam uses reproduces it (RC-03). Schema-valid
  // but non-canonical values (unnormalized marks, the PC-F01 closure class)
  // stay interpretable and are never silently normalized at read time.
  const canonical = canonicalizeContentDocument(parsed.data);
  if (!canonical.ok)
    return { kind: "rich_noncanonical", document: parsed.data };
  return contentDocumentsEqual(parsed.data, canonical.value)
    ? { kind: "rich_valid", document: parsed.data }
    : { kind: "rich_noncanonical", document: parsed.data };
}

/**
 * Binary projection of `classifyPersistedRichAnswer` for READ-ONLY
 * rendering: the canonical document when the value is interpretable Rich
 * (`rich_valid` or `rich_noncanonical`), null otherwise. Callers render
 * their controlled corrupt/unsupported fallback for null — a rich-mode
 * value must never fall through to the plain formatter, and a corrupt value
 * must never render as an empty document.
 *
 * This projection grants DISPLAY, never editability: the editable seam
 * (RichTextAnswerInput) classifies directly and fails closed on
 * `rich_noncanonical` too, because mounting it would expose the editor's
 * canonicalizing onUpdate as a silent repair write.
 */
export function resolveRichAnswerDocument(
  answer: unknown,
  answerMode: string | null | undefined,
): ContentDocumentV1 | null {
  const read = classifyPersistedRichAnswer({ value: answer, answerMode });
  return read.kind === "rich_valid" || read.kind === "rich_noncanonical"
    ? read.document
    : null;
}
