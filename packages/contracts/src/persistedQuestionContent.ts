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
 * FROZEN-SEMANTICS read authority for persisted QUESTION content
 * (rich-content-semantic-contract.md §7; #669 Phase D5-A, F-06). Every static
 * render path that interprets a question prompt / option `contentDocument` —
 * take-exam runtime, grading view, candidate result, authoring preview,
 * choice inputs — must classify through `classifyPersistedQuestionContent`
 * (or its binary projection `resolvePersistedQuestionDocument`) and must not
 * keep a private read oracle.
 *
 * PROMPT PROVENANCE (differs from the persisted-answer classifier): a
 * question is Rich exactly when its `contentDocument` slot is non-null
 * (ADR-019 B′ — `contentMode` is derived from slot nullness, never stored),
 * so no answer-mode context is needed and there is no `legacy_plain` state:
 * the document slot never carried a legacy plain-string population, so a
 * string in the slot is an inconsistent stored shape (`corrupt`). A null
 * slot is `plain`: the `content` column is the sole authority. `content` on
 * a Rich question is a server-derived projection (search/display text), NOT
 * a fallback authority — a corrupt document must never degrade into
 * rendering it as though the question were Plain.
 *
 * The Rich interpretation below is the same primitive sequence the
 * persisted-answer classifier uses (version gate → envelope gate → bounded
 * preflight → schema+limits → canonical identity), so prompt and answer reads
 * share one definition of valid Rich (§7). Read classification never mutates
 * or repairs persisted data: a noncanonical document is returned as persisted
 * (`rich_noncanonical`), and `unsupported_version` / `corrupt` carry the raw
 * value so callers can fail closed without losing track of the source truth.
 */

/** The §7 static read states as a runtime vocabulary (export/DTO consumers). */
export const PERSISTED_QUESTION_CONTENT_STATES = [
  "plain",
  "rich_valid",
  "rich_noncanonical",
  "unsupported_version",
  "corrupt",
] as const;

/** One of the §7 static read states, as a bare token. */
export type PersistedQuestionContentState =
  (typeof PERSISTED_QUESTION_CONTENT_STATES)[number];

export type PersistedQuestionContentReadState =
  | { kind: "plain" }
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
  PersistedQuestionContentReadState["kind"],
  PersistedQuestionContentState
> = true;
void _stateVocabularyIdentity;

export function classifyPersistedQuestionContent(
  value: unknown,
): PersistedQuestionContentReadState {
  if (value == null) return { kind: "plain" };
  // A numeric docVersion the system does not interpret is a forward-compat
  // signal and must win over any shape reasoning: never reinterpret a
  // future-version envelope as V1 content or plain.
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
  // but non-canonical values stay interpretable for read-only DISPLAY and
  // are never silently normalized at read time (read != repair).
  const canonical = canonicalizeContentDocument(parsed.data);
  if (!canonical.ok)
    return { kind: "rich_noncanonical", document: parsed.data };
  return contentDocumentsEqual(parsed.data, canonical.value)
    ? { kind: "rich_valid", document: parsed.data }
    : { kind: "rich_noncanonical", document: parsed.data };
}

/**
 * Binary projection of `classifyPersistedQuestionContent` for static
 * rendering: the canonical document when the value is interpretable Rich
 * (`rich_valid` or `rich_noncanonical`), null otherwise. Callers render
 * their controlled integrity fallback for null — a corrupt/unsupported
 * prompt must never fall through to the plain `content` projection and must
 * never reach `ContentDocumentRenderer` unvalidated.
 *
 * This projection grants DISPLAY, never canonicality, editability, or repair
 * authority: nothing in the static read path may normalize and persist a
 * `rich_noncanonical` document.
 */
export function resolvePersistedQuestionDocument(
  value: unknown,
): ContentDocumentV1 | null {
  const read = classifyPersistedQuestionContent(value);
  return read.kind === "rich_valid" || read.kind === "rich_noncanonical"
    ? read.document
    : null;
}
