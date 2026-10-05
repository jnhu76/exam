import {
  plainTextProjection,
  type ContentDocumentV1,
  type ContentMode,
  type QuestionType,
} from "@exam/domain";
import { canonicalizeContentDocument } from "@exam/contracts";
import { ValidationError } from "@exam/domain";

/**
 * Server-side content write authority.
 *
 * Every question/option content write — create, update, and the merged
 * update re-validation — resolves through this seam. For a Rich write the
 * document is canonicalized (normalized AND re-validated on the canonical
 * form, so no write can persist a document outside schema/limits)
 * and `content` is DERIVED as its plain-text projection; the client's
 * `content`, if any, is never trusted. For a Plain write `content_document`
 * is persisted as NULL so legacy and plain rows stay indistinguishable.
 *
 * Hostile-depth protection is a schema-level closure: `ContentDocumentV1Schema`
 * — which types every rich slot in the create/update request schemas — runs
 * the bounded iterative preflight before its recursive grammar, so Fastify's
 * own body validation rejects a deep bomb before any handler code runs. No
 * route-level preflight duplicate exists.
 */

/** An option payload after request-schema parsing (content optional for rich). */
export interface OptionWriteInput {
  id: string;
  content?: string | undefined;
  contentDocument?: ContentDocumentV1 | null | undefined;
  isCorrect?: boolean | undefined;
}

/** Resolved, persistence-ready option content. */
export interface ResolvedOption {
  id: string;
  content: string;
  contentDocument: ContentDocumentV1 | null;
  isCorrect?: boolean | undefined;
}

/** Resolved, persistence-ready question content slots. */
export interface ResolvedQuestionContent {
  content: string;
  contentDocument: ContentDocumentV1 | null;
  answerMode: ContentMode | null;
  options: ResolvedOption[];
}

function resolveOption(option: OptionWriteInput): ResolvedOption {
  if (option.contentDocument != null) {
    const canonical = canonicalizeContentDocument(option.contentDocument);
    if (!canonical.ok) {
      throw new ValidationError(
        `option ${option.id} contentDocument violates canonical limits: ${canonical.reason}`,
      );
    }
    return {
      id: option.id,
      content: plainTextProjection(canonical.value),
      contentDocument: canonical.value,
      ...(option.isCorrect !== undefined
        ? { isCorrect: option.isCorrect }
        : {}),
    };
  }
  if (option.content === undefined) {
    // The request schema already rejects this; re-checked here so the seam
    // alone guarantees every resolved option carries authoritative content.
    throw new ValidationError(`option ${option.id} requires content`);
  }
  return {
    id: option.id,
    content: option.content,
    contentDocument: null,
    ...(option.isCorrect !== undefined ? { isCorrect: option.isCorrect } : {}),
  };
}

/**
 * Resolves the question content slots for persistence. Throws
 * ValidationError on the invariants the request schema cannot see (a rich
 * update that would strand a projected `content`).
 */
export function resolveQuestionContentWrite(input: {
  type: QuestionType;
  content?: string | undefined;
  contentDocument?: ContentDocumentV1 | null | undefined;
  answerMode?: ContentMode | null | undefined;
  options?: OptionWriteInput[] | undefined;
}): ResolvedQuestionContent {
  const options = (input.options ?? []).map(resolveOption);

  if (input.contentDocument != null) {
    const canonical = canonicalizeContentDocument(input.contentDocument);
    if (!canonical.ok) {
      throw new ValidationError(
        `contentDocument violates canonical limits: ${canonical.reason}`,
      );
    }
    return {
      content: plainTextProjection(canonical.value),
      contentDocument: canonical.value,
      answerMode: input.answerMode ?? null,
      options,
    };
  }

  if (input.content === undefined) {
    throw new ValidationError("content is required");
  }

  return {
    content: input.content,
    contentDocument: null,
    answerMode: input.answerMode ?? null,
    options,
  };
}

/**
 * Route-level guard for partial updates: a rich question whose `content`
 * would change without also replacing/clearing `contentDocument` is a
 * projection-authority violation — the client must send the new document or
 * explicitly clear it (contentDocument: null), never a bare content edit.
 */
export function assertRichContentUpdateAllowed(params: {
  storedDocument: ContentDocumentV1 | null;
  updateContent?: string | undefined;
  updateDocument: ContentDocumentV1 | null | undefined;
}): void {
  if (
    params.storedDocument != null &&
    params.updateContent !== undefined &&
    params.updateDocument === undefined
  ) {
    throw new ValidationError(
      "content is derived from contentDocument for rich questions; send contentDocument or clear it (null) instead",
    );
  }
}
