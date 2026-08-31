import { ContentDocumentV1Schema } from "@exam/contracts";
import {
  isContentDocumentV1,
  preflightContentDocumentStructure,
  type ContentDocumentV1,
} from "@exam/domain";

/**
 * FROZEN-SEMANTICS render authority for persisted answers (issue 301 corrective
 * pass §10/§11). Historical saves accepted arbitrary JSON, so a payload that
 * merely LOOKS like a ContentDocumentV1 envelope must never activate the rich
 * renderer on its own:
 *
 *   1. the FROZEN question's `answerMode` must be "rich" — the envelope shape
 *      of the answer itself is only a cheap hint, never the authority;
 *   2. the value must pass the bounded iterative structural preflight (a
 *      hostile deep document must not enter the recursive parse — or the
 *      recursive React renderer — at all);
 *   3. the value must deep-validate against ContentDocumentV1Schema.
 *
 * On success the canonical document is returned for ContentDocumentRenderer;
 * any failure returns null and the caller renders its controlled
 * corrupt/unsupported fallback. Plain/legacy answers (answerMode !== "rich")
 * keep the safe legacy formatter even when they happen to look like a
 * document envelope.
 */
export function resolveRichAnswerDocument(
  answer: unknown,
  answerMode: string | null | undefined,
): ContentDocumentV1 | null {
  if (answerMode !== "rich") return null;
  if (!isContentDocumentV1(answer)) return null;
  if (preflightContentDocumentStructure(answer).length > 0) return null;
  const parsed = ContentDocumentV1Schema.safeParse(answer);
  return parsed.success ? parsed.data : null;
}
