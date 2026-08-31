import {
  normalizeContentDocument,
  plainTextProjection,
  type ContentDocumentV1,
  type ContentMode,
  type QuestionType,
} from "@exam/domain";
import { ValidationError } from "@exam/domain";

/**
 * B′ server-side content write authority (#301 §2).
 *
 * Every question/option content write — create, update, and the merged
 * update re-validation — resolves through this seam. For a Rich write the
 * document is normalized into canonical form and `content` is DERIVED as its
 * plain-text projection; the client's `content`, if any, is never trusted.
 * For a Plain write `content_document` is persisted as NULL so legacy and
 * plain rows stay indistinguishable.
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
    const document = normalizeContentDocument(option.contentDocument);
    return {
      id: option.id,
      content: plainTextProjection(document),
      contentDocument: document,
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
    const document = normalizeContentDocument(input.contentDocument);
    return {
      content: plainTextProjection(document),
      contentDocument: document,
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
